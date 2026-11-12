import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../app.js';
import { setupIsolatedTestDatabase } from '../helpers/testDatabase.js';
import { bootstrapAdminUser } from '../../services/adminBootstrap.js';
import { resetCachedEnv, getEnv } from '../../config/environment.js';
import { prepareTestSession } from '../helpers/gameSession.js';
import { defineTurn } from '../../models/turn.js';
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

  const email = 'async-admin@example.test';
  const password = randomUUID();
  const user = await bootstrapAdminUser({ sequelize: database.sequelize, email, password });
  const login = await fetch(baseUrl.replace('/games', '/auth/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const { data } = await login.json();
  admins.push({ userId: user.id, token: data.accessToken });
}, 60000);

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

describe('Asynchronous Multi-Team Turns and Out-of-Order Scoring', () => {
  it('proves multi-team independent rolls, rule 1A enforcement, and out-of-order scoring', async () => {
    // 1. Setup game with 2 teams
    const createRes = await prepareTestSession(api, 'Async Grand Prix');
    expect(createRes.status).toBe(200);
    const gameId = createRes.body.data.game.id;

    const tplRes = await api(`/${gameId}/board-template`, {
      body: { templateId: 'prd-appendix-a-v1', expectedStateVersion: createRes.body.meta.stateVersion }
    });
    expect(tplRes.status).toBe(200);

    const setupRes = await api(`/${gameId}/setup`, {
      method: 'PUT',
      body: {
        name: 'Async Grand Prix',
        expectedStateVersion: tplRes.body.meta.stateVersion,
        boardCells: tplRes.body.data.boardCells,
        teams: [
          { name: 'Red Bull', color: '#0000ff', sortOrder: 1 },
          { name: 'Ferrari', color: '#ff0000', sortOrder: 2 }
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

    const teams = setupRes.body.data.teams;
    const teamRedBull = teams[0];
    const teamFerrari = teams[1];

    // 2. Acquire controller lease
    const acquireRes = await api(`/${gameId}/controller/acquire`, {
      body: { expectedStateVersion: startRes.body.meta.stateVersion }
    });
    expect(acquireRes.status).toBe(200);
    const leaseToken = acquireRes.body.data.controllerLeaseToken;

    // 3. Roll for Red Bull (team 1) with dice 3
    const roll1Res = await api(`/${gameId}/turns/roll`, {
      body: {
        teamId: teamRedBull.id,
        diceValue: 3,
        expectedStateVersion: acquireRes.body.meta.stateVersion,
        controllerLeaseToken: leaseToken
      }
    });
    expect(roll1Res.status).toBe(200);
    expect(roll1Res.body.data.teamId).toBe(teamRedBull.id);
    expect(roll1Res.body.data.landingCell).toBe(3);
    const turn1Id = roll1Res.body.data.turnId;

    // 4. Immediately roll for Ferrari (team 2) with dice 4 without waiting for Red Bull
    const roll2Res = await api(`/${gameId}/turns/roll`, {
      body: {
        teamId: teamFerrari.id,
        diceValue: 4,
        expectedStateVersion: roll1Res.body.meta.stateVersion,
        controllerLeaseToken: leaseToken
      }
    });
    expect(roll2Res.status).toBe(200);
    expect(roll2Res.body.data.teamId).toBe(teamFerrari.id);
    expect(roll2Res.body.data.landingCell).toBe(4);
    const turn2Id = roll2Res.body.data.turnId;

    // 5. Rule 1A check: Red Bull tries to roll AGAIN before Turn 1 is resolved -> rejected with 409 TURN_NOT_READY
    const roll1AgainRes = await api(`/${gameId}/turns/roll`, {
      body: {
        teamId: teamRedBull.id,
        diceValue: 2,
        expectedStateVersion: roll2Res.body.meta.stateVersion,
        controllerLeaseToken: leaseToken
      }
    });
    expect(roll1AgainRes.status).toBe(409);
    expect(roll1AgainRes.body.error.code).toBe('TURN_NOT_READY');

    // 6. Fast-forward movement deadlines in DB and settle expired movements
    const Turn = defineTurn(database.sequelize);
    await Turn.update(
      { movementEndsAt: new Date(Date.now() - 5000) },
      { where: { gameId } }
    );
    // Settle both turns to AWAITING_RESULT
    await settleExpiredMovementIfDue({ sequelize: database.sequelize, gameId });
    await settleExpiredMovementIfDue({ sequelize: database.sequelize, gameId });

    // 7. Verify snapshot has both pending results
    const snapRes = await api(`/${gameId}/snapshot`);
    expect(snapRes.status).toBe(200);
    expect(snapRes.body.data.pendingResults).toHaveLength(2);
    const pendingTurnIds = snapRes.body.data.pendingResults.map((p) => p.turnId);
    expect(pendingTurnIds).toContain(turn1Id);
    expect(pendingTurnIds).toContain(turn2Id);

    // 8. OUT-OF-ORDER RESOLUTION: Resolve Ferrari (Turn 2) FIRST!
    const resolve2Res = await api(`/${gameId}/turns/${turn2Id}/result`, {
      body: {
        scoringMethod: 'BUTTON',
        outcome: 'SUCCESS',
        expectedStateVersion: snapRes.body.meta.stateVersion
      }
    });
    expect(resolve2Res.status).toBe(200);
    expect(resolve2Res.body.data.turnId).toBe(turn2Id);
    expect(resolve2Res.body.data.teamId).toBe(teamFerrari.id);
    expect(resolve2Res.body.data.awardedPoints).toBeGreaterThan(0);

    // 9. Snapshot after Ferrari resolved: Red Bull is STILL pending!
    const snap2Res = await api(`/${gameId}/snapshot`);
    expect(snap2Res.status).toBe(200);
    expect(snap2Res.body.data.pendingResults).toHaveLength(1);
    expect(snap2Res.body.data.pendingResults[0].turnId).toBe(turn1Id);

    // Ferrari can now roll again since Ferrari's challenge is resolved!
    // (Red Bull still cannot roll because Red Bull's challenge is not resolved)
    const rollFerrariAgainRes = await api(`/${gameId}/turns/roll`, {
      body: {
        teamId: teamFerrari.id,
        diceValue: 2,
        expectedStateVersion: snap2Res.body.meta.stateVersion,
        controllerLeaseToken: leaseToken
      }
    });
    expect(rollFerrariAgainRes.status).toBe(200);
    expect(rollFerrariAgainRes.body.data.teamId).toBe(teamFerrari.id);

    // 10. Now resolve Red Bull (Turn 1)
    const resolve1Res = await api(`/${gameId}/turns/${turn1Id}/result`, {
      body: {
        scoringMethod: 'MANUAL',
        points: 35,
        expectedStateVersion: rollFerrariAgainRes.body.meta.stateVersion
      }
    });
    expect(resolve1Res.status).toBe(200);
    expect(resolve1Res.body.data.turnId).toBe(turn1Id);
    expect(resolve1Res.body.data.awardedPoints).toBe(35);
  });
});

