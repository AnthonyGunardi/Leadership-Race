import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../app.js';
import { checkReadiness, checkLiveness } from '../services/health.js';
import { getLiveness, getReadiness } from '../controllers/health.js';
import { setupIsolatedTestDatabase } from './helpers/testDatabase.js';

describe('Health Endpoints & App Security HTTP', () => {
  let app;
  let server;
  let baseUrl;
  let testDb;

  beforeAll(async () => {
    testDb = await setupIsolatedTestDatabase();
    app = createApp({ sequelize: testDb.sequelize });

    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (testDb && testDb.cleanup) {
      await testDb.cleanup();
    }
  });

  it('GET /health/live returns 200 with process liveness data and X-Request-Id header', async () => {
    const res = await fetch(`${baseUrl}/health/live`);
    expect(res.status).toBe(200);

    const requestId = res.headers.get('x-request-id');
    expect(requestId).toBeDefined();

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('ok');
    expect(body.data.uptime).toBeGreaterThanOrEqual(0);
    expect(body.data.timestamp).toBeDefined();
  });

  it('GET /health/ready returns 200 when database is healthy', async () => {
    const res = await fetch(`${baseUrl}/health/ready`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('ready');
    expect(body.data.database.status).toBe('connected');
    expect(body.data.timestamp).toBeDefined();
  });

  it('reports not ready while the configured outbox publisher cannot scan committed events', async () => {
    app.locals.isRealtimeReady = () => false;
    try {
      const response = await fetch(`${baseUrl}/health/ready`);
      expect(response.status).toBe(503);
      expect((await response.json()).data).toMatchObject({
        status: 'not_ready', database: { status: 'connected' }, publisher: { status: 'not_ready' }
      });
      app.locals.isRealtimeReady = () => true;
      expect((await fetch(`${baseUrl}/health/ready`)).status).toBe(200);
    } finally {
      delete app.locals.isRealtimeReady;
    }
  });

  it('reports not ready while the movement worker is not ready', async () => {
    app.locals.isWorkerReady = () => false;
    try {
      const response = await fetch(`${baseUrl}/health/ready`);
      expect(response.status).toBe(503);
      expect((await response.json()).data).toMatchObject({
        status: 'not_ready', database: { status: 'connected' }, worker: { status: 'not_ready' }
      });
      app.locals.isWorkerReady = () => true;
      expect((await fetch(`${baseUrl}/health/ready`)).status).toBe(200);
    } finally {
      delete app.locals.isWorkerReady;
    }
  });

  it('GET /health/metrics returns process memory telemetry and uptime', async () => {
    const res = await fetch(`${baseUrl}/health/metrics`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(json.data.memory.heapUsedBytes).toBeGreaterThan(0);
    expect(json.data.database.status).toBe('connected');
  });

  it('GET /health/ready returns 503 when database is disconnected without exposing secrets', async () => {
    // Create an app instance with a failing database mock
    const failingSequelize = {
      authenticate: async () => {
        throw new Error('Connection refused to mysql://root:super_secret_db_pass@127.0.0.1:3306/db');
      }
    };
    const brokenApp = createApp({ sequelize: failingSequelize });

    let brokenServer;
    let brokenUrl;
    await new Promise((resolve) => {
      brokenServer = brokenApp.listen(0, '127.0.0.1', () => {
        brokenUrl = `http://127.0.0.1:${brokenServer.address().port}`;
        resolve();
      });
    });

    try {
      const res = await fetch(`${brokenUrl}/health/ready`);
      expect(res.status).toBe(503);

      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
      expect(body.data.status).toBe('not_ready');
      expect(body.data.database.status).toBe('disconnected');
      expect(JSON.stringify(body)).not.toContain('super_secret_db_pass');
    } finally {
      await new Promise((resolve) => brokenServer.close(resolve));
    }
  });

  it('returns 404 with standard envelope for unknown route', async () => {
    const res = await fetch(`${baseUrl}/non-existent-route`);
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toContain('Route not found');
  });

  it('includes security headers from Helmet', async () => {
    const res = await fetch(`${baseUrl}/health/live`);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-dns-prefetch-control')).toBe('off');
  });

  it('allows requests from localhost Origin and sets CORS headers', async () => {
    const res = await fetch(`${baseUrl}/health/live`, {
      headers: { Origin: 'http://localhost:5173' }
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
  });

  it('blocks disallowed Origin with 403 via CORS middleware', async () => {
    const res = await fetch(`${baseUrl}/health/live`, {
      headers: { Origin: 'https://malicious-site.example.com' }
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('CORS_ERROR');
  });

  it('runs service checkLiveness and checkReadiness directly', async () => {
    const liveness = checkLiveness();
    expect(liveness.status).toBe('ok');

    const readiness = await checkReadiness(testDb.sequelize);
    expect(readiness.status).toBe('ready');

    const failedReadiness = await checkReadiness({
      authenticate: async () => {
        throw new Error('db err');
      }
    });
    expect(failedReadiness.status).toBe('not_ready');
    expect(failedReadiness.database.status).toBe('disconnected');

    const failedNoMessage = await checkReadiness({
      authenticate: async () => {
        throw {};
      }
    });
    expect(failedNoMessage.database.error).toBe('Database connection error');
  });

  it('GET /health/ready returns 503 when server is shutting down', async () => {
    const shuttingDownApp = createApp({
      sequelize: testDb.sequelize,
      isShuttingDown: () => true
    });

    let shutdownServer;
    let shutdownUrl;
    await new Promise((resolve) => {
      shutdownServer = shuttingDownApp.listen(0, '127.0.0.1', () => {
        shutdownUrl = `http://127.0.0.1:${shutdownServer.address().port}`;
        resolve();
      });
    });

    try {
      const res = await fetch(`${shutdownUrl}/health/ready`);
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
      expect(body.error.message).toBe('Server is shutting down');
    } finally {
      await new Promise((resolve) => shutdownServer.close(resolve));
    }
  });

  it('forwards error to next middleware in controller when unhandled exception occurs', async () => {
    let passedError;
    const mockNext = (err) => {
      passedError = err;
    };

    // getLiveness exception
    const badRes = {
      status: () => {
        throw new Error('res error');
      }
    };
    getLiveness({}, badRes, mockNext);
    expect(passedError).toBeDefined();
    expect(passedError.message).toBe('res error');

    // getReadiness exception
    passedError = null;
    const badReq = {
      app: {
        get locals() {
          throw new Error('req error');
        }
      }
    };
    await getReadiness(badReq, {}, mockNext);
    expect(passedError).toBeDefined();
    expect(passedError.message).toBe('req error');

    // getMetrics exception
    const { getMetrics } = await import('../controllers/health.js');
    passedError = null;
    const badMetricsReq = {
      app: {
        get locals() {
          throw new Error('metrics error');
        }
      }
    };
    await getMetrics(badMetricsReq, {}, mockNext);
    expect(passedError).toBeDefined();
    expect(passedError.message).toBe('metrics error');
  });

  it('serves static frontend files and SPA fallback when staticPath is provided', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const os = await import('node:os');

    const tempStaticDir = path.join(os.tmpdir(), `lr_static_test_${Date.now()}`);
    fs.mkdirSync(tempStaticDir, { recursive: true });
    fs.writeFileSync(path.join(tempStaticDir, 'index.html'), '<html><body>SPA Root</body></html>');

    const staticApp = createApp({
      sequelize: testDb.sequelize,
      staticPath: tempStaticDir
    });

    let testServer;
    let baseUrl;
    await new Promise((resolve) => {
      testServer = staticApp.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${testServer.address().port}`;
        resolve();
      });
    });

    try {
      // SPA fallback
      const spaRes = await fetch(`${baseUrl}/admin/games`);
      expect(spaRes.status).toBe(200);
      const text = await spaRes.text();
      expect(text).toContain('SPA Root');

      // API route falls through to 404 JSON
      const apiRes = await fetch(`${baseUrl}/api/v1/unknown`);
      expect(apiRes.status).toBe(404);
      const body = await apiRes.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');

      // HTTPS localhost CORS check
      const corsRes = await fetch(`${baseUrl}/health/live`, {
        headers: { Origin: 'https://127.0.0.1:8443' }
      });
      expect(corsRes.headers.get('access-control-allow-origin')).toBe('https://127.0.0.1:8443');
    } finally {
      await new Promise((resolve) => testServer.close(resolve));
      fs.rmSync(tempStaticDir, { recursive: true, force: true });
    }
  });
});

