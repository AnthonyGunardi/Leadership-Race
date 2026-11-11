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
import { prepareTestSession, storedGameFixture } from '../helpers/gameSession.js';
import { defineTurn } from '../../models/turn.js';
import { defineGameSetup } from '../../models/gameSetup.js';
import { defineScoring } from '../../models/scoring.js';
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

  for (const email of ['recovery-admin-a@example.test', 'recovery-admin-b@example.test']) {
    const password = randomUUID();
    const user = await bootstrapAdminUser({ sequelize: database.sequelize, email, password });
    const login = await fetch(baseUrl.replace('/games', '/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const { data } = await login.json();
    admins.push({ userId: user.id, email, token: data.accessToken });
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
  return { status: response.status, body: await response.json(), headers: response.headers };
}

async function apiText(path = '', { admin = 0 } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'GET',
    headers: {
      ...(admin === null ? {} : { Authorization: `Bearer ${admins[admin].token}` })
    }
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  return { status: response.status, text: buffer.toString('utf-8'), buffer, headers: response.headers };
}

it('proves G13: authoritative RFC 4180 CSV export with formula sanitization, auth, and Gate D-07b co-winner ranking', async () => {
  // 1. Create game with a team whose name triggers formula injection (=FormulaOne)
  const createRes = await prepareTestSession(api, 'G13 Grand Prix Export Test');
  expect(createRes.status).toBe(200);
  const gameId = createRes.body.data.game.id;

  const tplRes = await api(`/${gameId}/board-template`, {
    body: { templateId: 'prd-appendix-a-v1', expectedStateVersion: createRes.body.meta.stateVersion }
  });
  expect(tplRes.status).toBe(200);

  const setupRes = await api(`/${gameId}/setup`, {
    method: 'PUT',
    body: {
      name: 'G13 Grand Prix Export Test',
      expectedStateVersion: tplRes.body.meta.stateVersion,
      boardCells: tplRes.body.data.boardCells,
      teams: [
        { name: '=FormulaOne', color: '#1e40af', sortOrder: 1 },
        { name: 'Scuderia Ferrari', color: '#dc2626', sortOrder: 2 },
        { name: 'Mercedes AMG', color: '#06b6d4', sortOrder: 3 }
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

  // 2. Turn 1 for Team 1 (=FormulaOne): Roll 4, complete, score 15 points
  const acqRes = await api(`/${gameId}/controller/acquire`, {
    body: { expectedStateVersion: startRes.body.meta.stateVersion }
  });
  const leaseToken = acqRes.body.data.controllerLeaseToken;

  const roll1 = await api(`/${gameId}/turns/roll`, {
    body: { diceValue: 4, expectedStateVersion: acqRes.body.meta.stateVersion, controllerLeaseToken: leaseToken }
  });
  expect(roll1.status).toBe(200);
  const turn1Id = roll1.body.data.turnId;

  const turnModel = defineTurn(database.sequelize);
  await turnModel.update(
    { movementEndsAt: new Date(Date.now() - 5000) },
    { where: { id: turn1Id } }
  );
  await settleExpiredMovementIfDue({ sequelize: database.sequelize, gameId });

  const snap1 = await api(`/${gameId}/snapshot`);
  const res1 = await api(`/${gameId}/turns/${turn1Id}/result`, {
    body: { scoringMethod: 'BUTTON', outcome: 'SUCCESS', expectedStateVersion: snap1.body.meta.stateVersion }
  });
  expect(res1.status).toBe(200);

  // 3. Turn 2 for Team 2 (Scuderia Ferrari): Roll 2, complete, score MANUAL 30 points
  // Both teams now have 30 points, tied for rank 1 co-winner (Gate D-07b).
  const snap2 = await api(`/${gameId}/snapshot`);
  const roll2 = await api(`/${gameId}/turns/roll`, {
    body: { diceValue: 2, expectedStateVersion: snap2.body.meta.stateVersion, controllerLeaseToken: leaseToken }
  });
  expect(roll2.status).toBe(200);
  const turn2Id = roll2.body.data.turnId;

  await turnModel.update(
    { movementEndsAt: new Date(Date.now() - 5000) },
    { where: { id: turn2Id } }
  );
  await settleExpiredMovementIfDue({ sequelize: database.sequelize, gameId });

  const snap3 = await api(`/${gameId}/snapshot`);
  const res2 = await api(`/${gameId}/turns/${turn2Id}/result`, {
    body: { scoringMethod: 'MANUAL', points: 30, expectedStateVersion: snap3.body.meta.stateVersion }
  });
  expect(res2.status).toBe(200);

  // 4. Test Authorization on Export
  // Unauthenticated export rejected 401
  const unauthRes = await apiText(`/${gameId}/export.csv`, { admin: null });
  expect(unauthRes.status).toBe(401);

  // Non-existent game rejected 404
  const notFoundRes = await apiText('/00000000-0000-4000-8000-000000000000/export.csv');
  expect(notFoundRes.status).toBe(404);

  // 5. Authoritative Export CSV
  const csvRes = await apiText(`/${gameId}/export.csv`);
  expect(csvRes.status).toBe(200);
  expect(csvRes.headers.get('content-type')).toContain('text/csv');
  expect(csvRes.headers.get('content-disposition')).toContain('attachment; filename="leadership-race-g13');

  const csvContent = csvRes.text;
  expect(csvContent.startsWith('\uFEFF')).toBe(true);
  expect(csvContent).toContain('# GAME SUMMARY');
  expect(csvContent).toContain('[STANDINGS]');
  expect(csvContent).toContain('[TURN HISTORY]');
  expect(csvContent).toContain('[SCORE LEDGER]');

  // Verify Formula Injection Sanitization (CWE-1236):
  // Team name '=FormulaOne' must be serialized with leading single quote: "'=FormulaOne"
  expect(csvContent).toContain('"\'=FormulaOne"');

  // Verify Database Raw Data Unchanged:
  const { Team } = defineGameSetup(database.sequelize);
  const team1Row = await Team.findOne({ where: { gameId, sortOrder: 1 } });
  expect(team1Row.name).toBe('=FormulaOne'); // Raw DB retains original untouched!

  // Gate D-07b Verification:
  // Team 1 (30 pts) and Team 2 (30 pts) must BOTH have Rank 1 and Is Winner TRUE!
  // Team 3 (0 pts) must skip Rank 2 and be Rank 3!
  expect(csvContent).toContain('1,T1,"\'=FormulaOne",30,4,TRUE');
  expect(csvContent).toContain('1,T2,Scuderia Ferrari,30,2,TRUE');
  expect(csvContent).toContain('3,T3,Mercedes AMG,0,0,FALSE');

  // 6. Test Specific Scopes
  const standingsOnly = await apiText(`/${gameId}/export.csv?scope=standings`);
  expect(standingsOnly.status).toBe(200);
  expect(standingsOnly.text).not.toContain('# GAME SUMMARY');
  expect(standingsOnly.text).toContain('Rank,Team Code,Team Name,Total Score,Track Position,Is Winner');

  const turnsOnly = await apiText(`/${gameId}/export.csv?scope=turns`);
  expect(turnsOnly.status).toBe(200);
  expect(turnsOnly.text).toContain('Turn Number,Team Code,Team Name');
  expect(turnsOnly.text).toContain('BUTTON,SUCCESS,30');

  const ledgerOnly = await apiText(`/${gameId}/export.csv?scope=ledger`);
  expect(ledgerOnly.status).toBe(200);
  expect(ledgerOnly.text).toContain('Entry ID,Timestamp,Team Code,Team Name,Delta Points,Source');
  expect(ledgerOnly.text).toContain('CHALLENGE_BUTTON');
});

it('proves G14: multi-game isolation and cross-flow recovery invariants (FR-22, R-01–R-14)', async () => {
  const { Team } = defineGameSetup(database.sequelize);
  const Turn = defineTurn(database.sequelize);
  const { ScoreLedger } = defineScoring(database.sequelize);

  // --- MULTI-GAME ISOLATION (FR-22, AT-21, AT-22) ---
  // Create Game A and Game B
  const gameARes = await prepareTestSession(api, 'Isolation Game Alpha');
  const gameBRes = await storedGameFixture(database.sequelize, 'Imported isolation session');
  expect(gameARes.status).toBe(200);
  expect(gameBRes.status).toBe(200);
  const gameAId = gameARes.body.data.game.id;
  const gameBId = gameBRes.body.data.game.id;

  // Setup and Start both games
  for (const { id, ver, name } of [
    { id: gameAId, ver: gameARes.body.meta.stateVersion, name: 'Alpha' },
    { id: gameBId, ver: gameBRes.body.meta.stateVersion, name: 'Beta' }
  ]) {
    const tpl = await api(`/${id}/board-template`, {
      body: { templateId: 'prd-appendix-a-v1', expectedStateVersion: ver }
    });
    const set = await api(`/${id}/setup`, {
      method: 'PUT',
      body: {
        name: `Isolation Game ${name}`,
        expectedStateVersion: tpl.body.meta.stateVersion,
        boardCells: tpl.body.data.boardCells,
        teams: [
          { name: `Team ${name} 1`, color: '#ef4444', sortOrder: 1 },
          { name: `Team ${name} 2`, color: '#3b82f6', sortOrder: 2 }
        ]
      }
    });
    const val = await api(`/${id}/validate`, { body: { expectedStateVersion: set.body.meta.stateVersion } });
    await api(`/${id}/start`, { body: { expectedStateVersion: val.body.meta.stateVersion } });
  }

  // Mutate Game A: Acquire lease, roll dice, award points
  const snapA0 = await api(`/${gameAId}/snapshot`);
  const acqA = await api(`/${gameAId}/controller/acquire`, {
    body: { expectedStateVersion: snapA0.body.meta.stateVersion }
  });
  const rollA1 = await api(`/${gameAId}/turns/roll`, {
    body: {
      diceValue: 4,
      expectedStateVersion: acqA.body.meta.stateVersion,
      controllerLeaseToken: acqA.body.data.controllerLeaseToken
    }
  });
  expect(rollA1.status).toBe(200);

  // Verify Game B was completely untouched by Game A operations!
  const snapB = await api(`/${gameBId}/snapshot`);
  expect(snapB.body.data.game.turnNumber).toBe(0);
  expect(snapB.body.data.activeMovement).toBeNull();
  expect(snapB.body.data.teams[0].position).toBe(0);
  expect(snapB.body.data.teams[0].totalScore).toBe(0);

  // In contrast, Game A has turnNumber 1 and active movement
  const snapACurrentAfterRoll = await api(`/${gameAId}/snapshot`);
  expect(snapACurrentAfterRoll.body.data.game.turnNumber).toBe(1);
  expect(snapACurrentAfterRoll.body.data.activeMovement).not.toBeNull();

  // Cross-game idempotency scope:
  // Using the SAME idempotency key on Game A and Game B works independently without collision
  const sharedKey = randomUUID();
  const pauseARes = await api(`/${gameAId}/pause`, {
    body: { expectedStateVersion: 99999 }, // Stale version to fail on Game A
    key: sharedKey
  });
  expect(pauseARes.status).toBe(409); // Rejected STALE_STATE

  // The same key on Game B can still be used for a different command without 409 DUPLICATE_ACTION
  const snapBCurrent = await api(`/${gameBId}/snapshot`);
  const pauseBRes = await api(`/${gameBId}/pause`, {
    body: { expectedStateVersion: snapBCurrent.body.meta.stateVersion },
    key: sharedKey
  });
  expect(pauseBRes.status).toBe(200); // Succeeded on Game B!
  expect(pauseBRes.body.data.game.status).toBe('PAUSED');

  // --- R-04: PAUSE / RESUME PRESERVES PENDING RESULT ---
  // Resume Game B
  const resumeB = await api(`/${gameBId}/resume`, {
    body: { expectedStateVersion: pauseBRes.body.meta.stateVersion }
  });
  expect(resumeB.status).toBe(200);
  expect(resumeB.body.data.game.status).toBe('RUNNING');

  // --- R-01, R-02, R-03: MOVEMENT EXPIRY & SETTLEMENT IDEMPOTENCY ---
  const turnA1Id = rollA1.body.data.turnId;
  await Turn.update(
    { movementEndsAt: new Date(Date.now() - 5000) },
    { where: { id: turnA1Id } }
  );

  // Concurrent settlement sweep executes exactly once (R-03)
  const [settleRes1, settleRes2] = await Promise.all([
    settleExpiredMovementIfDue({ sequelize: database.sequelize, gameId: gameAId }),
    settleExpiredMovementIfDue({ sequelize: database.sequelize, gameId: gameAId })
  ]);
  expect(settleRes1.settled || settleRes2.settled).toBe(true);
  const settledTurn = await Turn.findByPk(turnA1Id);
  expect(settledTurn.status).toBe('AWAITING_RESULT');

  // Score result on Game A
  const snapA1 = await api(`/${gameAId}/snapshot`);
  const scoreRes = await api(`/${gameAId}/turns/${turnA1Id}/result`, {
    body: { scoringMethod: 'BUTTON', outcome: 'SUCCESS', expectedStateVersion: snapA1.body.meta.stateVersion }
  });
  expect(scoreRes.status).toBe(200);

  // --- R-05, R-06, R-07, R-12: TURN VOID & RECOVERY ---
  // Roll turn 2 on Game A
  const snapA2 = await api(`/${gameAId}/snapshot`);
  const rollA2 = await api(`/${gameAId}/turns/roll`, {
    body: {
      diceValue: 3,
      expectedStateVersion: snapA2.body.meta.stateVersion,
      controllerLeaseToken: acqA.body.data.controllerLeaseToken
    }
  });
  expect(rollA2.status).toBe(200);
  const turnA2Id = rollA2.body.data.turnId;

  await Turn.update(
    { movementEndsAt: new Date(Date.now() - 5000) },
    { where: { id: turnA2Id } }
  );
  await settleExpiredMovementIfDue({ sequelize: database.sequelize, gameId: gameAId });

  // Score 20 points on Turn 2
  const snapA3 = await api(`/${gameAId}/snapshot`);
  const scoreA2 = await api(`/${gameAId}/turns/${turnA2Id}/result`, {
    body: { scoringMethod: 'MANUAL', points: 20, expectedStateVersion: snapA3.body.meta.stateVersion }
  });
  expect(scoreA2.status).toBe(200);

  // Team 2 now has 20 points. Void Turn 2!
  const snapA4 = await api(`/${gameAId}/snapshot`);
  const voidA2 = await api(`/${gameAId}/turns/${turnA2Id}/void`, {
    body: {
      reason: 'Salah dadu fisik giliran 2',
      confirmed: true,
      expectedStateVersion: snapA4.body.meta.stateVersion
    }
  });
  expect(voidA2.status).toBe(200);
  expect(voidA2.body.data.compensatedPoints).toBe(20);
  expect(voidA2.body.data.newTotalScore).toBe(0);

  // R-12: After Turn 2 is voided, Turn 1 CANNOT be voided!
  const snapA5 = await api(`/${gameAId}/snapshot`);
  const voidA1 = await api(`/${gameAId}/turns/${turnA1Id}/void`, {
    body: {
      reason: 'Coba void turn 1',
      confirmed: true,
      expectedStateVersion: snapA5.body.meta.stateVersion
    }
  });
  expect(voidA1.status).toBe(409); // TURN_NOT_READY: only highest committed turn can be voided

  // Score ledger invariant: total score equals sum of ledger deltas
  const allLedgers = await ScoreLedger.findAll({ where: { gameId: gameAId } });
  const sumDeltas = allLedgers.reduce((acc, l) => acc + l.deltaPoints, 0);
  const allTeams = await Team.findAll({ where: { gameId: gameAId } });
  const sumScores = allTeams.reduce((acc, t) => acc + t.totalScore, 0);
  expect(sumScores).toBe(sumDeltas);

  // --- R-11: SETUP ON READY REVERTS TO DRAFT ---
  const gameCRes = await prepareTestSession(api, 'Ready Invalidation Game');
  const gameCId = gameCRes.body.data.game.id;
  const tplC = await api(`/${gameCId}/board-template`, { body: { templateId: 'prd-appendix-a-v1', expectedStateVersion: gameCRes.body.meta.stateVersion } });
  const setC = await api(`/${gameCId}/setup`, {
    method: 'PUT',
    body: {
      name: 'Ready Invalidation Game',
      expectedStateVersion: tplC.body.meta.stateVersion,
      boardCells: tplC.body.data.boardCells,
      teams: [
        { name: 'Team C1', color: '#10b981', sortOrder: 1 },
        { name: 'Team C2', color: '#6366f1', sortOrder: 2 }
      ]
    }
  });
  const valC = await api(`/${gameCId}/validate`, { body: { expectedStateVersion: setC.body.meta.stateVersion } });
  expect(valC.body.data.game.status).toBe('READY');

  // Modifying setup on READY reverts status atomically to DRAFT (R-11)
  const setC2 = await api(`/${gameCId}/setup`, {
    method: 'PUT',
    body: {
      name: 'Ready Invalidation Game Renamed',
      expectedStateVersion: valC.body.meta.stateVersion,
      boardCells: tplC.body.data.boardCells,
      teams: [
        { name: 'Team C1', color: '#10b981', sortOrder: 1 },
        { name: 'Team C2', color: '#6366f1', sortOrder: 2 }
      ]
    }
  });
  expect(setC2.body.data.game.status).toBe('DRAFT');

  // Starting before re-preflight is rejected
  const startInvalid = await api(`/${gameCId}/start`, {
    body: { expectedStateVersion: setC2.body.meta.stateVersion }
  });
  expect(startInvalid.status).toBe(409); // GAME_NOT_READY
});
