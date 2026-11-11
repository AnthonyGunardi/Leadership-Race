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
import { defineTurn } from '../../models/turn.js';
import { defineGameSetup } from '../../models/gameSetup.js';
import { createMovementWorker } from '../../services/movementWorker.js';
import { settleExpiredMovementIfDue } from '../../services/turnSettlement.js';

const require = createRequire(import.meta.url);
let database;
let server;
let baseUrl;
const admins = [];
const previousKeys = process.env.CONTROLLER_RECEIPT_KEYS;

beforeAll(async () => {
  process.env.CONTROLLER_RECEIPT_KEYS = JSON.stringify({ v1: randomBytes(32).toString('hex') });
  resetCachedEnv();
  database = await setupIsolatedTestDatabase();
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
      DB_NAME: database.schemaName,
      DB_HOST: env.DB_HOST,
      DB_PORT: String(env.DB_PORT),
      DB_USER: env.DB_USER,
      DB_PASSWORD: env.DB_PASSWORD
    }
  });

  server = await new Promise((resolve) => {
    const instance = createApp({ sequelize: database.sequelize }).listen(0, '127.0.0.1', () => resolve(instance));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1/games`;

  for (const email of ['roll-admin-a@example.test', 'roll-admin-b@example.test']) {
    const password = randomUUID();
    const user = await bootstrapAdminUser({ sequelize: database.sequelize, email, password });
    const login = await fetch(baseUrl.replace('/games', '/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const { data } = await login.json();
    admins.push({ userId: user.id, token: data.accessToken });
  }
}, 30000);

afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await database?.cleanup();
  if (previousKeys === undefined) delete process.env.CONTROLLER_RECEIPT_KEYS;
  else process.env.CONTROLLER_RECEIPT_KEYS = previousKeys;
  resetCachedEnv();
});

async function api(path = '', { body, key = randomUUID(), admin = 0, method = body ? 'POST' : 'GET' } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
      ...(admin === null ? {} : { Authorization: `Bearer ${admins[admin].token}` })
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  return { status: response.status, body: await response.json() };
}

it('proves G7: atomic roll, idempotent replay, 409 when animating, controller guard, and settlement', async () => {
  // 1. Setup game: create -> template -> setup teams -> validate -> start
  const createRes = await prepareTestSession(api, 'G7 Roll Grand Prix');
  expect(createRes.status).toBe(200);
  const gameId = createRes.body.data.game.id;

  const tplRes = await api(`/${gameId}/board-template`, {
    body: { templateId: 'prd-appendix-a-v1', expectedStateVersion: createRes.body.meta.stateVersion }
  });
  expect(tplRes.status).toBe(200);

  const setupRes = await api(`/${gameId}/setup`, {
    method: 'PUT',
    body: {
      name: 'G7 Roll Grand Prix',
      expectedStateVersion: tplRes.body.meta.stateVersion,
      boardCells: tplRes.body.data.boardCells,
      teams: [
        { name: 'Ferrari', color: '#ff0000', sortOrder: 1 },
        { name: 'Mercedes', color: '#00ffff', sortOrder: 2 }
      ]
    }
  });
  expect(setupRes.status).toBe(200);

  const valRes = await api(`/${gameId}/validate`, {
    body: { expectedStateVersion: setupRes.body.meta.stateVersion }
  });
  expect(valRes.status).toBe(200);

  const startRes = await api(`/${gameId}/start`, {
    body: { expectedStateVersion: valRes.body.meta.stateVersion }
  });
  expect(startRes.status).toBe(200);
  expect(startRes.body.data.game.status).toBe('RUNNING');
  const firstTeamId = startRes.body.data.game.currentTeamId;
  expect(firstTeamId).toBeTruthy();

  // 2. Acquire controller lease
  const acquireRes = await api(`/${gameId}/controller/acquire`, {
    body: { expectedStateVersion: startRes.body.meta.stateVersion }
  });
  expect(acquireRes.status).toBe(200);
  const leaseToken = acquireRes.body.data.controllerLeaseToken;
  expect(leaseToken).toMatch(/^[a-f0-9]{64}$/);

  // 3. Roll AT-04: roll 3 from position 0
  const rollKey = randomUUID();
  const rollRes = await api(`/${gameId}/turns/roll`, {
    key: rollKey,
    body: {
      diceValue: 3,
      expectedTurnNumber: 1,
      expectedStateVersion: acquireRes.body.meta.stateVersion,
      controllerLeaseToken: leaseToken
    }
  });

  expect(rollRes.status).toBe(200);
  expect(rollRes.body.data).toMatchObject({
    diceValue: 3,
    from: 0,
    dicePath: [1, 2, 3],
    penaltyPath: [],
    fullPath: [1, 2, 3],
    landingCell: 3,
    finalPosition: 3,
    requiresChallenge: true,
    stepDurationMs: 450
  });
  const turnId = rollRes.body.data.turnId;
  expect(turnId).toBeTruthy();

  // Verify database persistence
  const Turn = defineTurn(database.sequelize);
  const { Game, Team } = defineGameSetup(database.sequelize);
  const dbTurn = await Turn.findByPk(turnId);
  expect(dbTurn.status).toBe('ANIMATING');
  expect(dbTurn.finalPosition).toBe(3);

  const dbTeam = await Team.findByPk(firstTeamId);
  expect(dbTeam.position).toBe(3);

  const dbGame = await Game.findByPk(gameId);
  expect(dbGame.activeTurnId).toBe(turnId);
  expect(Number(dbGame.turnNumber)).toBe(1);

  // 4. AT-13: Idempotent replay returns identical 200 response
  const animatingSnapshot = await api(`/${gameId}/snapshot`);
  expect(animatingSnapshot.status).toBe(200);
  expect(animatingSnapshot.body.data.turnStatus).toBe('ANIMATING');
  expect(animatingSnapshot.body.data.activeMovement).toMatchObject({
    turnId,
    diceValue: 3,
    from: 0,
    landingCell: 3,
    finalPosition: 3,
    stepDurationMs: 450
  });
  expect(animatingSnapshot.body.data.activeMovement.movementStartsAt).toBeTruthy();
  expect(animatingSnapshot.body.data.activeMovement.movementEndsAt).toBeTruthy();

  const replayRes = await api(`/${gameId}/turns/roll`, {
    key: rollKey,
    body: {
      diceValue: 3,
      expectedTurnNumber: 1,
      expectedStateVersion: acquireRes.body.meta.stateVersion,
      controllerLeaseToken: leaseToken
    }
  });
  expect(replayRes.status).toBe(200);
  expect(replayRes.body.data.turnId).toBe(turnId);

  // 5. AT-16: Admin clicks roll while animating -> 409 TURN_NOT_READY
  const concurrentRes = await api(`/${gameId}/turns/roll`, {
    body: {
      diceValue: 2,
      expectedTurnNumber: 2,
      expectedStateVersion: rollRes.body.meta.stateVersion,
      controllerLeaseToken: leaseToken
    }
  });
  expect(concurrentRes.status).toBe(409);
  expect(concurrentRes.body.error.code).toBe('TURN_NOT_READY');

  // 6. AT-22: Roll without valid controller lease -> 409 CONTROLLER_NOT_HELD
  const invalidLeaseRes = await api(`/${gameId}/turns/roll`, {
    body: {
      diceValue: 2,
      expectedTurnNumber: 2,
      expectedStateVersion: rollRes.body.meta.stateVersion,
      controllerLeaseToken: 'e'.repeat(64)
    }
  });
  expect(invalidLeaseRes.status).toBe(409);
  expect(invalidLeaseRes.body.error.code).toBe('CONTROLLER_NOT_HELD');

  // 7. Settlement: Fast-forward movement_ends_at to the past and query snapshot
  await dbTurn.update({ movementEndsAt: new Date(Date.now() - 1000) });

  const snapshotRes = await api(`/${gameId}/snapshot`);
  expect(snapshotRes.status).toBe(200);
  expect(snapshotRes.body.data.turnStatus).toBe('AWAITING_RESULT');
  expect(snapshotRes.body.data.activeMovement).toBeNull();
  expect(snapshotRes.body.data.pendingResult).toMatchObject({
    turnId,
    cellNumber: 3,
    category: 'RACE_STRENGTH',
    allowedMethods: ['BUTTON', 'MANUAL']
  });

  // 8. AT-07 & Indisipliner Penalty Auto-Settlement:
  // Simulate setting up a team at position 14 and rolling 3 to land on cell 17 (-5 penalty)
  // First, complete turn 1 so turn 2 can start
  await dbTurn.update({ status: 'COMPLETED', resolvedAt: new Date() });
  await dbGame.update({ activeTurnId: null });

  // Update team position to 14
  await dbTeam.update({ position: 14 });

  // Snapshot before roll 2
  const snap2 = await api(`/${gameId}/snapshot`);
  const roll2Res = await api(`/${gameId}/turns/roll`, {
    body: {
      diceValue: 3,
      expectedTurnNumber: 2,
      expectedStateVersion: snap2.body.meta.stateVersion,
      controllerLeaseToken: leaseToken
    }
  });

  expect(roll2Res.status).toBe(200);
  expect(roll2Res.body.data).toMatchObject({
    from: 14,
    diceValue: 3,
    dicePath: [15, 16, 17],
    penaltyPath: [16, 15, 14, 13, 12],
    fullPath: [15, 16, 17, 16, 15, 14, 13, 12],
    landingCell: 17,
    finalPosition: 12,
    requiresChallenge: false
  });

  const penaltyTurn = await Turn.findByPk(roll2Res.body.data.turnId);
  expect(penaltyTurn.status).toBe('ANIMATING');

  // Fast-forward movement_ends_at to the past
  await penaltyTurn.update({ movementEndsAt: new Date(Date.now() - 1000) });

  // R-01: MovementWorker startup scan automatically settles overdue movement
  const worker = createMovementWorker({ sequelize: database.sequelize, scanIntervalMs: 200 });
  await worker.tick();
  await worker.stop();

  // Verify turn completed automatically and next team is active!
  const settledPenaltyTurn = await Turn.findByPk(roll2Res.body.data.turnId);
  expect(settledPenaltyTurn.status).toBe('COMPLETED');
  expect(settledPenaltyTurn.resolvedAt).toBeTruthy();

  const refreshedGame = await Game.findByPk(gameId);
  expect(refreshedGame.activeTurnId).toBeNull();
  expect(refreshedGame.currentTeamId).not.toBe(firstTeamId);

  const finalSnapshot = await api(`/${gameId}/snapshot`);
  expect(finalSnapshot.body.data.turnStatus).toBe('READY_FOR_ROLL');
  expect(finalSnapshot.body.data.pendingResult).toBeNull();
  expect(finalSnapshot.body.data.activeMovement).toBeNull();

  // 9. R-02 & R-03: Settlement timing and survival through STALE_STATE
  const roll3Res = await api(`/${gameId}/turns/roll`, {
    body: {
      diceValue: 1,
      expectedTurnNumber: 3,
      expectedStateVersion: finalSnapshot.body.meta.stateVersion,
      controllerLeaseToken: leaseToken
    }
  });
  expect(roll3Res.status).toBe(200);
  const turn3Id = roll3Res.body.data.turnId;
  const turn3 = await Turn.findByPk(turn3Id);
  expect(turn3.status).toBe('ANIMATING');

  // Verify not settled before deadline
  const notDue = await settleExpiredMovementIfDue({ sequelize: database.sequelize, gameId });
  expect(notDue).toEqual({ settled: false, reason: 'NOT_DUE' });
  expect((await Turn.findByPk(turn3Id)).status).toBe('ANIMATING');

  // Fast-forward movement_ends_at to the past
  await turn3.update({ movementEndsAt: new Date(Date.now() - 1000) });

  // In-band settlement executes and commits before STALE_STATE rejection
  const staleRoll = await api(`/${gameId}/turns/roll`, {
    body: {
      diceValue: 2,
      expectedTurnNumber: 4,
      expectedStateVersion: 999999,
      controllerLeaseToken: leaseToken
    }
  });
  expect(staleRoll.status).toBe(409);
  expect(staleRoll.body.error.code).toBe('STALE_STATE');

  // Turn was settled to AWAITING_RESULT in its independent system transaction!
  const settledTurn3 = await Turn.findByPk(turn3Id);
  expect(settledTurn3.status).toBe('AWAITING_RESULT');

  // Subsequent call is an idempotent no-op
  const noop = await settleExpiredMovementIfDue({ sequelize: database.sequelize, gameId });
  expect(noop).toEqual({ settled: false, reason: 'NOT_ANIMATING' });
});
