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
import { defineScoring } from '../../models/scoring.js';
import { defineAuthAudit } from '../../models/authAudit.js';
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

  for (const email of ['void-admin-a@example.test', 'void-admin-b@example.test']) {
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

it('proves G18: void roll terakhir, kompensasi skor, rekonsiliasi, dan guard anti-double-void (R-05–R-07, R-12)', async () => {
  const Turn = defineTurn(database.sequelize);
  const { Game, Team, GameEvent, OutboxEvent } = defineGameSetup(database.sequelize);
  const { ScoreLedger, ChallengeResult } = defineScoring(database.sequelize);
  const { AuditLog } = defineAuthAudit(database.sequelize);

  // 1. Setup game: create -> template -> setup teams -> validate -> start
  const createRes = await prepareTestSession(api, 'G18 Void Grand Prix');
  expect(createRes.status).toBe(200);
  const gameId = createRes.body.data.game.id;

  const tplRes = await api(`/${gameId}/board-template`, {
    body: { templateId: 'prd-appendix-a-v1', expectedStateVersion: createRes.body.meta.stateVersion }
  });
  expect(tplRes.status).toBe(200);

  const setupRes = await api(`/${gameId}/setup`, {
    method: 'PUT',
    body: {
      name: 'G18 Void Grand Prix',
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
  expect(startRes.body.data.game.status).toBe('RUNNING');
  const team1Id = startRes.body.data.game.currentTeamId;

  // 2. Acquire controller
  const acqRes = await api(`/${gameId}/controller/acquire`, {
    body: { expectedStateVersion: startRes.body.meta.stateVersion }
  });
  expect(acqRes.status).toBe(200);
  const leaseToken = acqRes.body.data.controllerLeaseToken;

  // 3. Roll Turn #1: rolls 3 (moves 0 -> 3)
  let currentVersion = acqRes.body.meta.stateVersion;
  const roll1Res = await api(`/${gameId}/turns/roll`, {
    body: {
      diceValue: 3,
      expectedTurnNumber: 1,
      expectedStateVersion: currentVersion,
      controllerLeaseToken: leaseToken
    }
  });
  expect(roll1Res.status).toBe(200);
  const turn1Id = roll1Res.body.data.turnId;
  currentVersion = roll1Res.body.meta.stateVersion;

  // R-07 check: Attempting void while ANIMATING rejects 409 TURN_NOT_READY
  const voidWhileAnimating = await api(`/${gameId}/turns/${turn1Id}/void`, {
    body: {
      expectedStateVersion: currentVersion,
      reason: 'Harus ditolak saat animating',
      confirmed: true
    }
  });
  expect(voidWhileAnimating.status).toBe(409);
  expect(voidWhileAnimating.body.error.code).toBe('TURN_NOT_READY');

  // Fast-forward movement settlement for turn 1
  const turn1Record = await Turn.findByPk(turn1Id);
  turn1Record.movementEndsAt = new Date(Date.now() - 5000);
  await turn1Record.save();
  await settleExpiredMovementIfDue({ sequelize: database.sequelize, gameId, requestId: randomUUID() });

  const snapAwaiting = await api(`/${gameId}/snapshot`);
  expect(snapAwaiting.body.data.turnStatus).toBe('AWAITING_RESULT');
  expect(snapAwaiting.body.data.lastTurn).toMatchObject({
    id: turn1Id,
    turnNumber: 1,
    status: 'AWAITING_RESULT',
    diceValue: 3,
    from: 0,
    finalPosition: 3
  });
  currentVersion = snapAwaiting.body.meta.stateVersion;

  // Stale state version check
  const staleVoid = await api(`/${gameId}/turns/${turn1Id}/void`, {
    body: {
      expectedStateVersion: currentVersion + 99,
      reason: 'Versi salah',
      confirmed: true
    }
  });
  expect(staleVoid.status).toBe(409);
  expect(staleVoid.body.error.code).toBe('STALE_STATE');

  // --- R-05: Void Turn #1 (Awaiting Result, non-penalti) ---
  const void1Key = randomUUID();
  const void1Res = await api(`/${gameId}/turns/${turn1Id}/void`, {
    key: void1Key,
    body: {
      expectedStateVersion: currentVersion,
      reason: 'Salah input dadu, harusnya 2',
      confirmed: true
    }
  });

  expect(void1Res.status).toBe(200);
  expect(void1Res.body.data).toMatchObject({
    voidedTurnId: turn1Id,
    teamId: team1Id,
    restoredPosition: 0,
    compensatedPoints: 0,
    newTotalScore: 0
  });
  currentVersion = void1Res.body.meta.stateVersion;

  // Verify DB state after voiding Turn #1
  const team1Db = await Team.findByPk(team1Id);
  expect(team1Db.position).toBe(0);
  expect(team1Db.totalScore).toBe(0);

  const gameDb = await Game.findByPk(gameId);
  expect(gameDb.currentTeamId).toBe(team1Id);
  expect(gameDb.activeTurnId).toBeNull();
  expect(Number(gameDb.turnNumber)).toBe(1); // turnNumber did NOT decrement

  const turn1Db = await Turn.findByPk(turn1Id);
  expect(turn1Db.status).toBe('VOIDED');
  expect(turn1Db.voidReason).toBe('Salah input dadu, harusnya 2');
  expect(turn1Db.voidedAt).toBeTruthy();
  expect(turn1Db.voidedBy).toBe(admins[0].userId);

  // Verify AuditLog and Events
  const auditTurn1 = await AuditLog.findOne({ where: { gameId, action: 'TURN_VOIDED' } });
  expect(auditTurn1).toBeTruthy();
  expect(auditTurn1.afterJson).toMatchObject({
    turnId: turn1Id,
    status: 'VOIDED',
    restoredPosition: 0,
    compensatedPoints: 0
  });

  const correctionEvent = await GameEvent.findOne({
    where: { gameId, type: 'game:correction_applied' }
  });
  expect(correctionEvent).toBeTruthy();
  expect(correctionEvent.payloadJson).toMatchObject({
    correctionType: 'TURN_VOID',
    voidedTurnId: turn1Id,
    teamId: team1Id,
    restoredPosition: 0,
    compensatedPoints: 0
  });

  const outboxEntry = await OutboxEvent.findOne({
    where: { gameId, gameEventId: correctionEvent.id }
  });
  expect(outboxEntry).toBeTruthy();

  // Verify Snapshot after void
  const snapAfterVoid1 = await api(`/${gameId}/snapshot`);
  expect(snapAfterVoid1.body.data.turnStatus).toBe('READY_FOR_ROLL');
  expect(snapAfterVoid1.body.data.activeMovement).toBeNull();
  expect(snapAfterVoid1.body.data.game.currentTeamId).toBe(team1Id);
  expect(snapAfterVoid1.body.data.lastTurn).toMatchObject({
    id: turn1Id,
    status: 'VOIDED',
    voidReason: 'Salah input dadu, harusnya 2'
  });

  // --- R-06 Scenario: Roll replacement Turn #2, score points > 0, and void with compensation ---
  const roll2Res = await api(`/${gameId}/turns/roll`, {
    body: {
      diceValue: 2,
      expectedTurnNumber: 2,
      expectedStateVersion: currentVersion,
      controllerLeaseToken: leaseToken
    }
  });
  expect(roll2Res.status).toBe(200);
  const turn2Id = roll2Res.body.data.turnId;
  expect(turn2Id).not.toBe(turn1Id); // Roll pengganti gets new UUID

  // Settle turn 2
  const turn2Record = await Turn.findByPk(turn2Id);
  turn2Record.movementEndsAt = new Date(Date.now() - 5000);
  await turn2Record.save();
  await settleExpiredMovementIfDue({ sequelize: database.sequelize, gameId, requestId: randomUUID() });

  const snap2 = await api(`/${gameId}/snapshot`);
  currentVersion = snap2.body.meta.stateVersion;

  // Submit scoring MANUAL 25 points on turn 2
  const resultRes = await api(`/${gameId}/turns/${turn2Id}/result`, {
    body: {
      scoringMethod: 'MANUAL',
      points: 25,
      note: 'Origami challenge completed',
      expectedStateVersion: currentVersion
    }
  });
  expect(resultRes.status).toBe(200);
  expect(resultRes.body.data.awardedPoints).toBe(25);
  currentVersion = resultRes.body.meta.stateVersion;

  const challengeDb = await ChallengeResult.findOne({ where: { turnId: turn2Id } });
  expect(challengeDb.awardedPoints).toBe(25);

  // Check team score is now 25 and 1 score_ledger entry exists
  const ledgersBefore = await ScoreLedger.findAll({ where: { gameId, teamId: team1Id } });
  expect(ledgersBefore).toHaveLength(1);
  expect(ledgersBefore[0].deltaPoints).toBe(25);
  expect(ledgersBefore[0].source).toBe('CHALLENGE_MANUAL');

  // Now void Turn #2 (which was COMPLETED with 25 points)
  const void2Version = currentVersion;
  const void2Key = randomUUID();
  const void2Res = await api(`/${gameId}/turns/${turn2Id}/void`, {
    key: void2Key,
    body: {
      expectedStateVersion: void2Version,
      reason: 'Origami salah kriteria, batalkan poin',
      confirmed: true
    }
  });

  expect(void2Res.status).toBe(200);
  expect(void2Res.body.data).toMatchObject({
    voidedTurnId: turn2Id,
    teamId: team1Id,
    restoredPosition: 0,
    compensatedPoints: 25,
    newTotalScore: 0
  });
  currentVersion = void2Res.body.meta.stateVersion;

  // Check score_ledger: exactly ONE new negative CORRECTION row with compensates_entry_id
  const ledgersAfter = await ScoreLedger.findAll({
    where: { gameId, teamId: team1Id },
    order: [['createdAt', 'ASC']]
  });
  expect(ledgersAfter).toHaveLength(2);
  expect(ledgersAfter[1].deltaPoints).toBe(-25);
  expect(ledgersAfter[1].source).toBe('CORRECTION');
  expect(ledgersAfter[1].compensatesEntryId).toBe(ledgersBefore[0].id);
  expect(ledgersAfter[1].turnId).toBe(turn2Id);

  // Invariant: team totalScore === SUM(ledger.deltaPoints)
  const team1AfterVoid2 = await Team.findByPk(team1Id);
  expect(team1AfterVoid2.totalScore).toBe(0);

  // Idempotent retry with same key and identical body returns cached 200 without creating another ledger row
  const retryVoid2 = await api(`/${gameId}/turns/${turn2Id}/void`, {
    key: void2Key,
    body: {
      expectedStateVersion: void2Version,
      reason: 'Origami salah kriteria, batalkan poin',
      confirmed: true
    }
  });
  expect(retryVoid2.status).toBe(200);
  expect(retryVoid2.body.data.voidedTurnId).toBe(turn2Id);

  const ledgersAfterRetry = await ScoreLedger.findAll({ where: { gameId, teamId: team1Id } });
  expect(ledgersAfterRetry).toHaveLength(2); // No new ledger created!

  // --- R-12: Void roll 10 / roll 11 rules ---
  // Attempt to void Turn #1 again: rejected because Turn #2 was committed after Turn #1!
  const voidTurn1AfterTurn2 = await api(`/${gameId}/turns/${turn1Id}/void`, {
    body: {
      expectedStateVersion: currentVersion,
      reason: 'Mencoba batalkan turn 1',
      confirmed: true
    }
  });
  expect(voidTurn1AfterTurn2.status).toBe(409);
  expect(voidTurn1AfterTurn2.body.error.code).toBe('TURN_NOT_READY');

  // Attempt to void Turn #2 with a new key: rejected because Turn #2 is already VOIDED!
  const doubleVoidTurn2 = await api(`/${gameId}/turns/${turn2Id}/void`, {
    body: {
      expectedStateVersion: currentVersion,
      reason: 'Double void attempt',
      confirmed: true
    }
  });
  expect(doubleVoidTurn2.status).toBe(409);
  expect(doubleVoidTurn2.body.error.code).toBe('TURN_NOT_READY');

  // --- R-05 PAUSED state: Void while game is PAUSED ---
  // Roll replacement Turn #3
  const roll3Res = await api(`/${gameId}/turns/roll`, {
    body: {
      diceValue: 1,
      expectedTurnNumber: 3,
      expectedStateVersion: currentVersion,
      controllerLeaseToken: leaseToken
    }
  });
  expect(roll3Res.status).toBe(200);
  const turn3Id = roll3Res.body.data.turnId;

  // Settle turn 3
  const turn3Record = await Turn.findByPk(turn3Id);
  turn3Record.movementEndsAt = new Date(Date.now() - 5000);
  await turn3Record.save();
  await settleExpiredMovementIfDue({ sequelize: database.sequelize, gameId, requestId: randomUUID() });

  const snap3 = await api(`/${gameId}/snapshot`);
  currentVersion = snap3.body.meta.stateVersion;

  // Pause the game
  const pauseRes = await api(`/${gameId}/pause`, {
    body: { expectedStateVersion: currentVersion }
  });
  expect(pauseRes.status).toBe(200);
  expect(pauseRes.body.data.game.status).toBe('PAUSED');
  currentVersion = pauseRes.body.meta.stateVersion;

  // Void Turn #3 while PAUSED
  const void3Res = await api(`/${gameId}/turns/${turn3Id}/void`, {
    body: {
      expectedStateVersion: currentVersion,
      reason: 'Batalkan roll saat game di-pause',
      confirmed: true
    }
  });
  expect(void3Res.status).toBe(200);
  currentVersion = void3Res.body.meta.stateVersion;

  const snapPaused = await api(`/${gameId}/snapshot`);
  expect(snapPaused.body.data.game.status).toBe('PAUSED');
  expect(snapPaused.body.data.turnStatus).toBe('READY_FOR_ROLL');

  // Resume game
  const resumeRes = await api(`/${gameId}/resume`, {
    body: { expectedStateVersion: currentVersion }
  });
  expect(resumeRes.status).toBe(200);
  expect(resumeRes.body.data.game.status).toBe('RUNNING');
  currentVersion = resumeRes.body.meta.stateVersion;

  // Finish game
  const finishRes = await api(`/${gameId}/finish`, {
    body: { expectedStateVersion: currentVersion, confirmed: true }
  });
  expect(finishRes.status).toBe(200);
  expect(finishRes.body.data.game.status).toBe('FINISHED');
  currentVersion = finishRes.body.meta.stateVersion;

  // Attempting to void when game is FINISHED rejects 409 GAME_FINISHED
  const voidOnFinished = await api(`/${gameId}/turns/${turn3Id}/void`, {
    body: {
      expectedStateVersion: currentVersion,
      reason: 'Mencoba void setelah game selesai',
      confirmed: true
    }
  });
  expect(voidOnFinished.status).toBe(409);
  expect(voidOnFinished.body.error.code).toBe('GAME_FINISHED');
}, 45000);
