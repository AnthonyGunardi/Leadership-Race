import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { setupIsolatedTestDatabase } from '../helpers/testDatabase.js';
import { getEnv, resetCachedEnv } from '../../config/environment.js';
import { bootstrapAdminUser } from '../../services/adminBootstrap.js';
import { createApp } from '../../app.js';
import { prepareTestSession } from '../helpers/gameSession.js';
import { defineScoring } from '../../models/scoring.js';
import { defineTurn } from '../../models/turn.js';
import { settleExpiredMovementIfDue } from '../../services/turnSettlement.js';

const require = createRequire(import.meta.url);
let database;
let server;
let baseUrl;
let accessToken;
const previousKeys = process.env.CONTROLLER_RECEIPT_KEYS;

beforeAll(async () => {
  process.env.CONTROLLER_RECEIPT_KEYS = JSON.stringify({ v1: randomBytes(32).toString('hex') });
  resetCachedEnv();
  database = await setupIsolatedTestDatabase();
  const env = getEnv();
  await promisify(execFile)(process.execPath, [
    require.resolve('sequelize-cli/lib/sequelize'), 'db:migrate', '--env', 'test',
    '--config', fileURLToPath(new URL('../../../sequelize.config.cjs', import.meta.url)),
    '--migrations-path', fileURLToPath(new URL('../../../migrations/', import.meta.url))
  ], {
    env: {
      ...process.env, NODE_ENV: 'test', DB_NAME: database.schemaName,
      DB_HOST: env.DB_HOST, DB_PORT: String(env.DB_PORT), DB_USER: env.DB_USER, DB_PASSWORD: env.DB_PASSWORD
    }
  });

  const email = 'lifecycle-test@example.test';
  const password = randomUUID();
  await bootstrapAdminUser({ sequelize: database.sequelize, email, password });

  server = await new Promise((resolve) => {
    const instance = createApp({ sequelize: database.sequelize }).listen(0, '127.0.0.1', () => resolve(instance));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1/games`;

  const response = await fetch(baseUrl.replace('/games', '/auth/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  accessToken = (await response.json()).data.accessToken;
}, 30000);

afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await database?.cleanup();
  if (previousKeys === undefined) delete process.env.CONTROLLER_RECEIPT_KEYS;
  else process.env.CONTROLLER_RECEIPT_KEYS = previousKeys;
  resetCachedEnv();
});

async function api(path = '', { method = 'GET', body, key = randomUUID() } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
      Authorization: `Bearer ${accessToken}`
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  return { status: response.status, body: await response.json() };
}

async function createAndStartTestGame(name = 'Lifecycle Test Game') {
  const created = await prepareTestSession(api, name);
  expect(created.status).toBe(200);
  const gameId = created.body.data.game.id;
  let version = created.body.meta.stateVersion;

  const templateApplied = await api(`/${gameId}/board-template`, {
    method: 'POST',
    body: { expectedStateVersion: version, templateId: 'prd-appendix-a-v1' }
  });
  expect(templateApplied.status).toBe(200);
  version = templateApplied.body.meta.stateVersion;

  const setupUpdated = await api(`/${gameId}/setup`, {
    method: 'PUT',
    body: {
      name,
      expectedStateVersion: version,
      teams: [
        { name: 'Scuderia Red', color: '#ff1801', sortOrder: 1 },
        { name: 'Mercedes Blue', color: '#00d2be', sortOrder: 2 }
      ],
      boardCells: templateApplied.body.data.boardCells
    }
  });
  expect(setupUpdated.status).toBe(200);
  version = setupUpdated.body.meta.stateVersion;

  const validated = await api(`/${gameId}/validate`, {
    method: 'POST',
    body: { expectedStateVersion: version }
  });
  expect(validated.status).toBe(200);
  version = validated.body.meta.stateVersion;

  const started = await api(`/${gameId}/start`, {
    method: 'POST',
    body: { expectedStateVersion: version }
  });
  expect(started.status).toBe(200);
  expect(started.body.data.game.status).toBe('RUNNING');

  return {
    gameId,
    version: started.body.meta.stateVersion,
    teams: started.body.data.teams
  };
}

it('G11 full lifecycle: pause -> 423 roll/scoring -> resume -> AT-17 finish pending -> score -> finish -> 409 frozen -> results', async () => {
  const { gameId, version: startVersion } = await createAndStartTestGame('G11 Main Test Game');
  let currentVersion = startVersion;

  // 1. Pause game
  const pauseKey = randomUUID();
  const prePauseVersion = currentVersion;
  const pauseRes = await api(`/${gameId}/pause`, {
    method: 'POST',
    body: { expectedStateVersion: prePauseVersion },
    key: pauseKey
  });
  expect(pauseRes.status).toBe(200);
  expect(pauseRes.body.data.game.status).toBe('PAUSED');
  currentVersion = pauseRes.body.meta.stateVersion;

  // 2. Replay pause with same Idempotency-Key and body returns stored receipt
  const pauseReplay = await api(`/${gameId}/pause`, {
    method: 'POST',
    body: { expectedStateVersion: prePauseVersion },
    key: pauseKey
  });
  expect(pauseReplay.status).toBe(200);
  expect(pauseReplay.body.data.game.status).toBe('PAUSED');

  // 3. Acquire controller while PAUSED
  const acquireRes = await api(`/${gameId}/controller/acquire`, {
    method: 'POST',
    body: { expectedStateVersion: currentVersion }
  });
  expect(acquireRes.status).toBe(200);
  const leaseToken = acquireRes.body.data.controllerLeaseToken;
  currentVersion = acquireRes.body.meta.stateVersion;

  // 4. Attempt roll while PAUSED -> 423 GAME_PAUSED
  const rollPausedRes = await api(`/${gameId}/turns/roll`, {
    method: 'POST',
    body: {
      diceValue: 1,
      expectedTurnNumber: 1,
      expectedStateVersion: currentVersion,
      controllerLeaseToken: leaseToken
    }
  });
  expect(rollPausedRes.status).toBe(423);
  expect(rollPausedRes.body.error.code).toBe('GAME_PAUSED');

  // 5. Resume game
  const resumeRes = await api(`/${gameId}/resume`, {
    method: 'POST',
    body: { expectedStateVersion: currentVersion }
  });
  expect(resumeRes.status).toBe(200);
  expect(resumeRes.body.data.game.status).toBe('RUNNING');
  currentVersion = resumeRes.body.meta.stateVersion;

  // 6. Roll dice while RUNNING -> land on cell 1 (Action)
  const rollRes = await api(`/${gameId}/turns/roll`, {
    method: 'POST',
    body: {
      diceValue: 1,
      expectedTurnNumber: 1,
      expectedStateVersion: currentVersion,
      controllerLeaseToken: leaseToken
    }
  });
  expect(rollRes.status).toBe(200);
  const turnId = rollRes.body.data.turnId;

  // Settle movement animation so turn reaches AWAITING_RESULT
  const Turn = defineTurn(database.sequelize);
  await Turn.update({ movementEndsAt: new Date(Date.now() - 5000) }, { where: { id: turnId } });
  const settlement = await settleExpiredMovementIfDue({ sequelize: database.sequelize, gameId });
  expect(settlement.settled).toBe(true);

  const snapshotRes = await api(`/${gameId}/snapshot`);
  expect(snapshotRes.body.data.turnStatus).toBe('AWAITING_RESULT');
  currentVersion = snapshotRes.body.meta.stateVersion;

  // 7. AT-17: Attempt Finish while turn is pending (AWAITING_RESULT) -> 409 PENDING_RESULT
  const finishPendingRes = await api(`/${gameId}/finish`, {
    method: 'POST',
    body: { expectedStateVersion: currentVersion, confirmed: true }
  });
  expect(finishPendingRes.status).toBe(409);
  expect(finishPendingRes.body.error.code).toBe('PENDING_RESULT');

  // 8. Submit challenge scoring result (BUTTON SUCCESS)
  const resultRes = await api(`/${gameId}/turns/${turnId}/result`, {
    method: 'POST',
    body: {
      scoringMethod: 'BUTTON',
      outcome: 'SUCCESS',
      expectedStateVersion: currentVersion
    }
  });
  expect(resultRes.status).toBe(200);
  expect(resultRes.body.data.awardedPoints).toBeGreaterThan(0);
  currentVersion = resultRes.body.meta.stateVersion;

  // 9. Finish game with confirmed: true
  const finishKey = randomUUID();
  const preFinishVersion = currentVersion;
  const finishRes = await api(`/${gameId}/finish`, {
    method: 'POST',
    body: { expectedStateVersion: preFinishVersion, confirmed: true },
    key: finishKey
  });
  expect(finishRes.status).toBe(200);
  expect(finishRes.body.data.game.status).toBe('FINISHED');
  expect(finishRes.body.data.game.finishedAt).toBeTruthy();
  expect(finishRes.body.data.finalResults).toBeTruthy();
  expect(finishRes.body.data.finalResults.winners).toHaveLength(1);
  expect(finishRes.body.data.finalResults.winners[0].rank).toBe(1);
  currentVersion = finishRes.body.meta.stateVersion;

  // 10. Replay finish with same key and body succeeds
  const finishReplay = await api(`/${gameId}/finish`, {
    method: 'POST',
    body: { expectedStateVersion: preFinishVersion, confirmed: true },
    key: finishKey
  });
  expect(finishReplay.status).toBe(200);
  expect(finishReplay.body.data.game.status).toBe('FINISHED');

  // 11. Invariant: FINISHED cannot be reopened, paused, or resumed
  const pauseOnFinished = await api(`/${gameId}/pause`, {
    method: 'POST',
    body: { expectedStateVersion: currentVersion }
  });
  expect(pauseOnFinished.status).toBe(409);

  const resumeOnFinished = await api(`/${gameId}/resume`, {
    method: 'POST',
    body: { expectedStateVersion: currentVersion }
  });
  expect(resumeOnFinished.status).toBe(409);

  // 12. Invariant: FINISHED rejects roll
  const rollOnFinished = await api(`/${gameId}/turns/roll`, {
    method: 'POST',
    body: {
      diceValue: 2,
      expectedTurnNumber: 2,
      expectedStateVersion: currentVersion,
      controllerLeaseToken: leaseToken
    }
  });
  expect(rollOnFinished.status).toBe(409);

  // 13. Verify final_results persisted in MySQL
  const { FinalResult } = defineScoring(database.sequelize);
  const persistedResults = await FinalResult.findAll({
    where: { gameId }
  });
  expect(persistedResults).toHaveLength(2);
  const winnerRecord = persistedResults.find((r) => r.isWinner);
  expect(winnerRecord).toBeTruthy();
  expect(winnerRecord.rank).toBe(1);

  // 14. Query GET /api/v1/games/:id/results
  const resultsRes = await api(`/${gameId}/results`);
  expect(resultsRes.status).toBe(200);
  expect(resultsRes.body.data.status).toBe('FINISHED');
  expect(resultsRes.body.data.winners).toHaveLength(1);
  expect(resultsRes.body.data.results).toHaveLength(2);

  // 15. Query GET /api/v1/games/:id/leaderboard
  const leaderboardRes = await api(`/${gameId}/leaderboard`);
  expect(leaderboardRes.status).toBe(200);
  expect(leaderboardRes.body.data.leaderboard).toHaveLength(2);
});

it('G11 AT-20: Top score tie gives both teams shared rank 1 (co-winners)', async () => {
  const { gameId, version } = await createAndStartTestGame('G11 Tie Game');

  // Both teams have 0 points initially (tied at 0)
  const finishRes = await api(`/${gameId}/finish`, {
    method: 'POST',
    body: { expectedStateVersion: version, confirmed: true }
  });
  expect(finishRes.status).toBe(200);
  expect(finishRes.body.data.game.status).toBe('FINISHED');

  const { winners, results } = finishRes.body.data.finalResults;
  // Both teams should be winners (rank 1)
  expect(winners).toHaveLength(2);
  expect(results.every((r) => r.rank === 1 && r.isWinner)).toBe(true);

  // Also verify via GET /results
  const resultsRes = await api(`/${gameId}/results`);
  expect(resultsRes.status).toBe(200);
  expect(resultsRes.body.data.winners).toHaveLength(2);
});
