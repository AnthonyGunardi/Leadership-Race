import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import cp from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi } from 'vitest';
import { createServerLifecycle } from '../services/serverLifecycle.js';
import { startServer, server as sharedServer } from '../server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverFilePath = path.resolve(__dirname, '../server.js');

describe('Server Lifecycle & Graceful Shutdown', () => {
  it('applies timeout tuning and tracks connections on http.Server', async () => {
    const server = http.createServer();
    const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const lifecycle = createServerLifecycle({
      server,
      logger: mockLogger,
      keepAliveTimeoutMs: 1234,
      headersTimeoutMs: 5678,
      requestTimeoutMs: 9101
    });

    expect(server.keepAliveTimeout).toBe(1234);
    expect(server.headersTimeout).toBe(5678);
    expect(server.requestTimeout).toBe(9101);

    // Test connection tracking
    const dummySocket = new net.Socket();
    server.emit('connection', dummySocket);
    expect(lifecycle.connections.has(dummySocket)).toBe(true);

    dummySocket.emit('close');
    expect(lifecycle.connections.has(dummySocket)).toBe(false);
  });

  it('sets Connection: close header on requests received after shutdown is initiated', async () => {
    const server = http.createServer();
    const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const exitMock = vi.fn();
    const lifecycle = createServerLifecycle({
      server,
      logger: mockLogger,
      exitFn: exitMock
    });

    const setHeaderMock = vi.fn();
    const req = {};
    const res = { setHeader: setHeaderMock };

    // Before shutdown
    server.emit('request', req, res);
    expect(setHeaderMock).not.toHaveBeenCalled();

    // Trigger shutdown
    server.close = vi.fn((cb) => cb());
    await lifecycle.gracefulShutdown('SIGTERM');

    // After shutdown
    server.emit('request', req, res);
    expect(setHeaderMock).toHaveBeenCalledWith('Connection', 'close');
  });

  it('gracefully drains and calls closeDatabase before exiting with 0', async () => {
    const server = http.createServer();
    const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const closeDbMock = vi.fn(async () => {});
    const exitMock = vi.fn();

    server.close = vi.fn((cb) => cb());

    const lifecycle = createServerLifecycle({
      server,
      logger: mockLogger,
      closeDatabase: closeDbMock,
      exitFn: exitMock
    });

    await lifecycle.gracefulShutdown('SIGINT');

    expect(lifecycle.isShuttingDown()).toBe(true);
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('SIGINT received'));
    expect(closeDbMock).toHaveBeenCalledTimes(1);
    expect(exitMock).toHaveBeenCalledWith(0);
  });

  it('handles server.close error by logging and exiting with 1', async () => {
    const server = http.createServer();
    const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const exitMock = vi.fn();
    const closeDbMock = vi.fn(async () => {});

    server.close = vi.fn((cb) => cb(new Error('Server close failure')));

    const lifecycle = createServerLifecycle({
      server,
      logger: mockLogger,
      closeDatabase: closeDbMock,
      exitFn: exitMock
    });

    await lifecycle.gracefulShutdown('SIGTERM');

    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Error closing server'), expect.any(Object));
    expect(closeDbMock).toHaveBeenCalledTimes(1);
    expect(exitMock).toHaveBeenCalledWith(1);
  });

  it('handles closeDatabase error during shutdown by logging and exiting with 1', async () => {
    const server = http.createServer();
    const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const exitMock = vi.fn();
    const closeDbMock = vi.fn(async () => {
      throw new Error('Database cleanup failed');
    });

    server.close = vi.fn((cb) => cb());

    const lifecycle = createServerLifecycle({
      server,
      logger: mockLogger,
      closeDatabase: closeDbMock,
      exitFn: exitMock
    });

    await lifecycle.gracefulShutdown('SIGTERM');

    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Error closing database:'));
    expect(exitMock).toHaveBeenCalledWith(1);
  });

  it('destroys hanging sockets and forces exit when shutdown deadline is exceeded', async () => {
    const server = http.createServer();
    const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const exitMock = vi.fn();

    // server.close never calls its callback, simulating hanging open requests
    server.close = vi.fn();

    const lifecycle = createServerLifecycle({
      server,
      logger: mockLogger,
      shutdownTimeoutMs: 20,
      forceTimeoutMs: 20,
      exitFn: exitMock
    });

    const hangingSocket = new net.Socket();
    hangingSocket.destroy = vi.fn();
    server.emit('connection', hangingSocket);

    lifecycle.gracefulShutdown('SIGTERM');

    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Graceful period expired'));
    expect(hangingSocket.destroy).toHaveBeenCalled();
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Forcing immediate shutdown'));
    expect(exitMock).toHaveBeenCalledWith(1);
  });

  it('attaches and detaches process listeners cleanly', () => {
    const server = http.createServer();
    const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const fakeProcess = {
      on: vi.fn(),
      removeListener: vi.fn(),
      exitCode: 0
    };

    const lifecycle = createServerLifecycle({
      server,
      logger: mockLogger
    });

    const cleanup = lifecycle.attachProcessHandlers(fakeProcess);
    expect(fakeProcess.on).toHaveBeenCalledWith('SIGINT', expect.any(Function));
    expect(fakeProcess.on).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
    expect(fakeProcess.on).toHaveBeenCalledWith('unhandledRejection', expect.any(Function));
    expect(fakeProcess.on).toHaveBeenCalledWith('uncaughtException', expect.any(Function));

    // Simulate unhandled rejection
    const unhandledHandler = fakeProcess.on.mock.calls.find((call) => call[0] === 'unhandledRejection')[1];
    unhandledHandler(new Error('Promise rejected'));
    expect(fakeProcess.exitCode).toBe(1);

    // Simulate string rejection
    unhandledHandler('plain rejection string');
    expect(fakeProcess.exitCode).toBe(1);

    cleanup();
    expect(fakeProcess.removeListener).toHaveBeenCalledWith('SIGINT', expect.any(Function));
  });

  it('triggers graceful shutdown from signal and message handlers', async () => {
    const server = http.createServer();
    const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const exitMock = vi.fn();
    const fakeProcess = {
      on: vi.fn(),
      removeListener: vi.fn(),
      exitCode: 0
    };

    server.close = vi.fn((cb) => cb());

    const lifecycle = createServerLifecycle({
      server,
      logger: mockLogger,
      exitFn: exitMock
    });

    lifecycle.attachProcessHandlers(fakeProcess);

    const sigintHandler = fakeProcess.on.mock.calls.find((call) => call[0] === 'SIGINT')[1];
    const messageHandler = fakeProcess.on.mock.calls.find((call) => call[0] === 'message')[1];

    // Non-shutdown message should be ignored
    messageHandler({ type: 'other' });

    // Valid SIGINT
    await sigintHandler();
    expect(exitMock).toHaveBeenCalledWith(0);

    // Test SIGTERM handler
    const sigtermServer = http.createServer();
    sigtermServer.close = vi.fn((cb) => cb());
    const sigtermLifecycle = createServerLifecycle({
      server: sigtermServer,
      logger: mockLogger,
      exitFn: exitMock
    });
    sigtermLifecycle.attachProcessHandlers(fakeProcess);
    const sigtermHandler = fakeProcess.on.mock.calls.find((call) => call[0] === 'SIGTERM')[1];
    await sigtermHandler();

    // Test uncaughtException handler
    const uncaughtServer = http.createServer();
    uncaughtServer.close = vi.fn((cb) => cb());
    const uncaughtLifecycle = createServerLifecycle({
      server: uncaughtServer,
      logger: mockLogger,
      exitFn: exitMock
    });
    uncaughtLifecycle.attachProcessHandlers(fakeProcess);
    const uncaughtHandler = fakeProcess.on.mock.calls.find((call) => call[0] === 'uncaughtException')[1];
    uncaughtHandler(new Error('fatal error'));

    // Test server close error with database cleanup error
    const brokenCloseServer = http.createServer();
    brokenCloseServer.close = vi.fn((cb) => cb(new Error('close failed')));
    const brokenDbLifecycle = createServerLifecycle({
      server: brokenCloseServer,
      logger: mockLogger,
      closeDatabase: async () => {
        throw new Error('db close failed');
      },
      exitFn: exitMock
    });
    await brokenDbLifecycle.gracefulShutdown('TEST_FAILURE');
  });

  it('starts and closes shared server directly via startServer export', async () => {
    const started = await startServer(0);
    const port = started.address().port;
    expect(port).toBeGreaterThan(0);

    const res = await fetch(`http://127.0.0.1:${port}/health/live`);
    expect(res.status).toBe(200);

    await new Promise((resolve) => sharedServer.close(resolve));
  });

  describe('Child-process Real Lifecycle Verification', () => {
    it('starts real server.js in child process and drains on IPC shutdown message', async () => {
      // Find an available port
      const testPort = await new Promise((resolve) => {
        const s = net.createServer();
        s.listen(0, '127.0.0.1', () => {
          const port = s.address().port;
          s.close(() => resolve(port));
        });
      });

      const child = cp.spawn(process.execPath, [serverFilePath], {
        env: {
          ...process.env,
          NODE_ENV: 'test',
          PORT: String(testPort),
          DB_NAME: 'lr_test'
        },
        stdio: ['pipe', 'pipe', 'pipe', 'ipc']
      });

      let stderrOutput = '';
      child.stderr.on('data', (d) => {
        stderrOutput += d.toString();
      });

      let serverStarted = false;

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          child.kill();
          reject(new Error('Timed out waiting for child server startup'));
        }, 8000);

        child.on('message', (msg) => {
          if (msg && msg.type === 'server-started') {
            serverStarted = true;
            clearTimeout(timeout);
            resolve();
          }
        });

        child.on('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });

        child.on('exit', (code) => {
          if (!serverStarted) {
            clearTimeout(timeout);
            reject(new Error(`Child exited prematurely with code ${code}. Stderr: ${stderrOutput}`));
          }
        });
      });

      expect(serverStarted).toBe(true);

      // Verify server is alive and responding via HTTP
      const res = await fetch(`http://127.0.0.1:${testPort}/health/live`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);

      // Request graceful shutdown via IPC message
      child.send({ type: 'shutdown' });

      const exitCode = await new Promise((resolve) => {
        child.on('exit', (code) => resolve(code));
      });

      expect(exitCode).toBe(0);
    });

    it('fails to start child process and exits with code 1 when port is already bound', async () => {
      // Bind a dummy server to hold a port
      const blockingServer = net.createServer((socket) => socket.end());
      const busyPort = await new Promise((resolve) => {
        blockingServer.listen(0, () => {
          resolve(blockingServer.address().port);
        });
      });

      try {
        const child = cp.spawn(process.execPath, [serverFilePath], {
          env: {
            ...process.env,
            NODE_ENV: 'test',
            PORT: String(busyPort),
            DB_NAME: 'lr_test'
          },
          stdio: ['pipe', 'pipe', 'pipe']
        });

        const exitCode = await new Promise((resolve) => {
          child.on('exit', (code) => resolve(code));
        });

        expect(exitCode).toBe(1);
      } finally {
        await new Promise((resolve) => blockingServer.close(resolve));
      }
    });
  });
});
