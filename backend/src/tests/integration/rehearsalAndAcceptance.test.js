import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createApp } from '../../app.js';
import { setupIsolatedTestDatabase } from '../helpers/testDatabase.js';
import { runRehearsalSimulation } from '../../../../scripts/rehearsalSimulation.js';
import { resetCachedEnv } from '../../config/environment.js';
import { createGameGateway } from '../../realtime/gameGateway.js';

describe('G17 — Acceptance, Rehearsal Simulation & Venue Performance Verification', () => {
  let app;
  let server;
  let baseUrl;
  let testDb;
  let gateway;
  const previousKeys = process.env.CONTROLLER_RECEIPT_KEYS;

  beforeAll(async () => {
    process.env.CONTROLLER_RECEIPT_KEYS = JSON.stringify({ v1: randomBytes(32).toString('hex') });
    resetCachedEnv();

    testDb = await setupIsolatedTestDatabase();

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

    app.locals.isRealtimeReady = () => true;
    app.locals.isWorkerReady = () => true;

    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}/api/v1/games`;
        resolve();
      });
    });
    gateway = createGameGateway({ server, sequelize: testDb.sequelize });
  }, 35000);

  afterAll(async () => {
    await gateway?.stop();
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (testDb && testDb.cleanup) {
      await testDb.cleanup();
    }
    if (previousKeys === undefined) delete process.env.CONTROLLER_RECEIPT_KEYS;
    else process.env.CONTROLLER_RECEIPT_KEYS = previousKeys;
    resetCachedEnv();
  });

  it('runs accelerated 10-team, 5-admin, 3-display rehearsal meeting P95 write latency and score invariant targets', async () => {
    const silentLogger = {
      log: () => {},
      error: (...args) => console.error(...args),
      warn: () => {}
    };

    const results = await runRehearsalSimulation({
      sequelize: testDb.sequelize,
      baseUrl,
      teamCount: 10,
      adminCount: 5,
      displayCount: 3,
      rounds: 1, // 10 team turns + void test + manual finish
      logger: silentLogger
    });

    expect(results.success).toBe(true);
    expect(results.teamsCount).toBe(10);
    expect(results.adminsCount).toBe(5);
    expect(results.displaysCount).toBe(3);
    expect(results.totalTransactions).toBeGreaterThanOrEqual(12);

    // SPEC §10 / PRD §2.3 target: P95 write API < 1,000 ms
    expect(results.performanceMetrics.p95WriteMs).toBeLessThan(1000);
    expect(results.performanceMetrics.p95WithinTarget).toBe(true);

    expect(results.performanceMetrics.avgEventReceiptAgeMs).toBeGreaterThanOrEqual(0);
    expect(results.invariants.publicDisplaysConfirmed).toBe(true);
    expect(results.invariants.publicPayloadsSafe).toBe(true);
    expect(results.invariants.zeroDoubleTransactions).toBe(true);

    // Mathematical integrity invariant: total_score = SUM(ledger) for all teams
    expect(results.invariants.mathScoreConsistency).toBe(true);

    // Turn void recovery executed and verified
    expect(results.invariants.turnVoidRecovered).toBe(true);

    // Co-winner ranking structure evaluated
    expect(results.invariants.coWinnerRankingEvaluated).toBe(true);
    expect(results.finalStandings.length).toBeGreaterThan(0);
    expect(results.finalStandings[0].rank).toBe(1);
  }, 30000);
});
