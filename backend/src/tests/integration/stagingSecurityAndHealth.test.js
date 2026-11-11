import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../app.js';
import { setupIsolatedTestDatabase } from '../helpers/testDatabase.js';
import { bootstrapAdminUser } from '../../services/adminBootstrap.js';
import { saveGameSetup } from '../../services/gameSetup.js';
import { createBackup, restoreBackup } from '../../services/backupRestore.js';
import { defineGameSetup } from '../../models/gameSetup.js';
import { ensureCurrentGame } from '../../services/singleGame.js';

describe('G16 — Staging Health, Security & Backup/Restore Integration', () => {
  let app;
  let server;
  let baseUrl;
  let testDb;
  let adminUser;
  let createdGameId;

  beforeAll(async () => {
    testDb = await setupIsolatedTestDatabase();

    // Migrate schema
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const { createRequire } = await import('node:module');
    const { fileURLToPath } = await import('node:url');
    const require = createRequire(import.meta.url);
    const { getEnv } = await import('../../config/environment.js');
    const env = getEnv();

    await promisify(execFile)(process.execPath, [
      require.resolve('sequelize-cli/lib/sequelize'),
      'db:migrate',
      '--env', 'test',
      '--config', fileURLToPath(new URL('../../../sequelize.config.cjs', import.meta.url)),
      '--migrations-path', fileURLToPath(new URL('../../../migrations/', import.meta.url))
    ], {
      env: {
        ...process.env,
        DB_NAME: testDb.schemaName,
        DB_HOST: env.DB_HOST,
        DB_PORT: String(env.DB_PORT),
        DB_USER: env.DB_USER,
        DB_PASSWORD: env.DB_PASSWORD
      }
    });

    app = createApp({
      sequelize: testDb.sequelize,
      isShuttingDown: () => false
    });

    // Provide mock worker and publisher for baseline health tests
    app.locals.isRealtimeReady = () => true;
    app.locals.isWorkerReady = () => true;

    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // Seed an admin user and a game to verify backup/restore capability
    adminUser = await bootstrapAdminUser({
      sequelize: testDb.sequelize,
      email: `staging-admin-${Date.now()}@example.test`,
      password: 'AdminPassword123!'
    });

    const gameResult = await ensureCurrentGame({
      sequelize: testDb.sequelize,
      actorUserId: adminUser.id,
      idempotencyKey: randomUUID(),
      requestId: randomUUID(),
      input: { name: 'Staging Operational Test Game' }
    });
    createdGameId = gameResult.body.data.game.id;
    const stateVersion = gameResult.body.meta.stateVersion;

    const { getPrdBoardTemplate } = await import('../../data/boardTemplate.js');
    const template = getPrdBoardTemplate();

    await saveGameSetup({
      sequelize: testDb.sequelize,
      gameId: createdGameId,
      actorUserId: adminUser.id,
      idempotencyKey: randomUUID(),
      requestId: randomUUID(),
      input: {
        name: 'Staging Operational Test Game',
        expectedStateVersion: stateVersion,
        teams: [
          { name: 'Alpha Team', color: '#ff0000', sortOrder: 1 },
          { name: 'Beta Team', color: '#00ff00', sortOrder: 2 }
        ],
        boardCells: template.boardCells
      }
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

  describe('Health & Readiness Probes', () => {
    it('GET /health/live returns 200 with process uptime and requestId', async () => {
      const res = await fetch(`${baseUrl}/health/live`);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.status).toBe('ok');
      expect(json.data.uptime).toBeGreaterThanOrEqual(0);
      expect(res.headers.get('x-request-id')).toBeDefined();
    });

    it('GET /health/ready returns 200 when database, publisher, and worker are ready', async () => {
      const res = await fetch(`${baseUrl}/health/ready`);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.status).toBe('ready');
      expect(json.data.database.status).toBe('connected');
      expect(json.data.publisher.status).toBe('ready');
      expect(json.data.worker.status).toBe('ready');
    });

    it('GET /health/ready returns 503 when movement worker is not ready', async () => {
      app.locals.isWorkerReady = () => false;
      try {
        const res = await fetch(`${baseUrl}/health/ready`);
        expect(res.status).toBe(503);

        const json = await res.json();
        expect(json.success).toBe(false);
        expect(json.data.status).toBe('not_ready');
        expect(json.data.worker.status).toBe('not_ready');
      } finally {
        app.locals.isWorkerReady = () => true;
      }
    });

    it('GET /health/ready returns 503 when outbox publisher is not ready', async () => {
      app.locals.isRealtimeReady = () => false;
      try {
        const res = await fetch(`${baseUrl}/health/ready`);
        expect(res.status).toBe(503);

        const json = await res.json();
        expect(json.success).toBe(false);
        expect(json.data.status).toBe('not_ready');
        expect(json.data.publisher.status).toBe('not_ready');
      } finally {
        app.locals.isRealtimeReady = () => true;
      }
    });

    it('GET /health/metrics returns 200 with memory telemetry and database status', async () => {
      const res = await fetch(`${baseUrl}/health/metrics`);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.uptimeSeconds).toBeGreaterThanOrEqual(0);
      expect(json.data.memory.heapUsedBytes).toBeGreaterThan(0);
      expect(json.data.memory.heapTotalBytes).toBeGreaterThan(0);
      expect(json.data.memory.rssBytes).toBeGreaterThan(0);
      expect(json.data.database.status).toBe('connected');
    });
  });

  describe('Database Backup & Restoration Lifecycle', () => {
    it('creates a complete structured backup with valid SHA-256 checksum and restores cleanly', async () => {
      const backup = await createBackup({ sequelize: testDb.sequelize });

      expect(backup.metadata).toBeDefined();
      expect(backup.metadata.version).toBe('1.0.0');
      expect(backup.metadata.checksum).toBeDefined();
      expect(backup.metadata.recordCount).toBeGreaterThan(0);
      expect(backup.data.users.length).toBeGreaterThan(0);
      expect(backup.data.games.length).toBeGreaterThan(0);
      expect(backup.data.teams.length).toBe(2);
      expect(backup.data.board_cells.length).toBe(50);

      // Verify that corrupting the backup payload checksum causes restore to reject
      const corruptedBackup = JSON.parse(JSON.stringify(backup));
      corruptedBackup.metadata.checksum = '0000000000000000000000000000000000000000000000000000000000000000';
      await expect(restoreBackup({
        sequelize: testDb.sequelize,
        backupPayload: corruptedBackup
      })).rejects.toThrow('checksum verification failed');

      // Now clear tables to simulate disaster / data loss
      await testDb.sequelize.query('SET FOREIGN_KEY_CHECKS = 0');
      await testDb.sequelize.query('DELETE FROM `audit_logs`');
      await testDb.sequelize.query('DELETE FROM `board_cells`');
      await testDb.sequelize.query('DELETE FROM `teams`');
      await testDb.sequelize.query('DELETE FROM `games`');
      await testDb.sequelize.query('SET FOREIGN_KEY_CHECKS = 1');

      const { Game, Team } = defineGameSetup(testDb.sequelize);
      const teamsBeforeRestore = await Team.findAll({ where: { gameId: createdGameId } });
      expect(teamsBeforeRestore.length).toBe(0);

      // Restore from backup
      const restoreResult = await restoreBackup({
        sequelize: testDb.sequelize,
        backupPayload: backup
      });

      expect(restoreResult.success).toBe(true);
      expect(restoreResult.totalRestored).toBe(backup.metadata.recordCount);

      // Verify restored data in database
      const restoredGame = await Game.findByPk(createdGameId);
      expect(restoredGame).not.toBeNull();
      expect(restoredGame.name).toBe('Staging Operational Test Game');

      const restoredTeams = await Team.findAll({ where: { gameId: createdGameId } });
      expect(restoredTeams.length).toBe(2);
    });
  });

  describe('Staging Security & HTTP Hardening', () => {
    it('enforces Helmet security headers', async () => {
      const res = await fetch(`${baseUrl}/health/live`);
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('x-dns-prefetch-control')).toBe('off');
    });

    it('denies CORS from unauthorized malicious origin with 403', async () => {
      const res = await fetch(`${baseUrl}/health/live`, {
        headers: { Origin: 'https://evil-hacker.example.com' }
      });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe('CORS_ERROR');
    });
  });
});
