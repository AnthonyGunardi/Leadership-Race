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

  for (const email of ['history-admin-a@example.test', 'history-admin-b@example.test']) {
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
  return { status: response.status, body: await response.json() };
}

it('proves game history retrieval, filtering, and authoritative score corrections (G12)', async () => {
  const { Team, BoardCell, GameEvent } = defineGameSetup(database.sequelize);
  const Turn = defineTurn(database.sequelize);
  const { ScoreLedger } = defineScoring(database.sequelize);
  const { AuditLog } = defineAuthAudit(database.sequelize);

  // 1. Create and setup game
  const createRes = await prepareTestSession(api, 'G12 History & Corrections Race');
  expect(createRes.status).toBe(200);
  const gameId = createRes.body.data.game.id;

  const tplRes = await api(`/${gameId}/board-template`, {
    body: { templateId: 'prd-appendix-a-v1', expectedStateVersion: createRes.body.meta.stateVersion }
  });
  expect(tplRes.status).toBe(200);

  const setupRes = await api(`/${gameId}/setup`, {
    method: 'PUT',
    body: {
      name: 'G12 History & Corrections Race',
      expectedStateVersion: tplRes.body.meta.stateVersion,
      boardCells: tplRes.body.data.boardCells,
      teams: [
        { name: 'Red Bull Racing', color: '#1e40af', sortOrder: 1 },
        { name: 'McLaren F1', color: '#f97316', sortOrder: 2 }
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

  // 2. Turn 1: Roll dice 3, complete movement, score BUTTON SUCCESS (+15 points)
  const acqRes = await api(`/${gameId}/controller/acquire`, {
    body: { expectedStateVersion: startRes.body.meta.stateVersion }
  });
  expect(acqRes.status).toBe(200);
  const leaseToken = acqRes.body.data.controllerLeaseToken;

  const roll1 = await api(`/${gameId}/turns/roll`, {
    body: {
      diceValue: 3,
      expectedStateVersion: acqRes.body.meta.stateVersion,
      controllerLeaseToken: leaseToken
    }
  });
  expect(roll1.status).toBe(200);
  const turn1Id = roll1.body.data.turnId;
  const team1Id = roll1.body.data.teamId;

  await Turn.update(
    { movementEndsAt: new Date(Date.now() - 5000) },
    { where: { id: turn1Id } }
  );
  await settleExpiredMovementIfDue({ sequelize: database.sequelize, gameId });

  const cell3 = await BoardCell.findOne({ where: { gameId, number: 3 } });
  expect(cell3.successPoints).toBeGreaterThan(0);

  const result1 = await api(`/${gameId}/turns/${turn1Id}/result`, {
    body: {
      scoringMethod: 'BUTTON',
      outcome: 'SUCCESS',
      expectedStateVersion: roll1.body.meta.stateVersion + 1
    }
  });
  expect(result1.status).toBe(200);
  expect(result1.body.data.awardedPoints).toBe(cell3.successPoints);

  // Fetch team 1 initial ledger
  const initialLedger = await ScoreLedger.findOne({ where: { gameId, teamId: team1Id } });
  expect(initialLedger).toBeTruthy();
  expect(initialLedger.deltaPoints).toBe(cell3.successPoints);

  // 3. Test GET /:id/history
  const historyRes = await api(`/${gameId}/history`);
  expect(historyRes.status).toBe(200);
  expect(historyRes.body.success).toBe(true);
  expect(historyRes.body.data.game.name).toBe('G12 History & Corrections Race');
  expect(historyRes.body.data.teams).toHaveLength(2);
  expect(historyRes.body.data.turns).toHaveLength(1);
  expect(historyRes.body.data.turns[0].turnNumber).toBe(1);
  expect(historyRes.body.data.turns[0].status).toBe('COMPLETED');
  expect(historyRes.body.data.turns[0].challengeResult.awardedPoints).toBe(cell3.successPoints);
  expect(historyRes.body.data.scoreLedger).toHaveLength(1);
  expect(historyRes.body.data.scoreLedger[0].deltaPoints).toBe(cell3.successPoints);
  expect(historyRes.body.data.auditLogs.length).toBeGreaterThan(0);

  // Test history category filtering
  const turnsOnly = await api(`/${gameId}/history?type=turns`);
  expect(turnsOnly.body.data.turns).toHaveLength(1);
  expect(turnsOnly.body.data.scoreLedger).toHaveLength(0);
  expect(turnsOnly.body.data.auditLogs).toHaveLength(0);

  const ledgerOnly = await api(`/${gameId}/history?type=ledger`);
  expect(ledgerOnly.body.data.turns).toHaveLength(0);
  expect(ledgerOnly.body.data.scoreLedger).toHaveLength(1);
  expect(ledgerOnly.body.data.auditLogs).toHaveLength(0);

  const auditOnly = await api(`/${gameId}/history?type=audit`);
  expect(auditOnly.body.data.turns).toHaveLength(0);
  expect(auditOnly.body.data.scoreLedger).toHaveLength(0);
  expect(auditOnly.body.data.auditLogs.length).toBeGreaterThan(0);

  // 4. Test Positive Score Correction (+25 points)
  let currentVersion = result1.body.meta.stateVersion;
  const correctionKey1 = randomUUID();
  const correction1 = await api(`/${gameId}/corrections`, {
    key: correctionKey1,
    body: {
      teamId: team1Id,
      deltaPoints: 25,
      reason: 'Bonus fair play dari juri event',
      confirmed: true,
      expectedStateVersion: currentVersion
    }
  });
  expect(correction1.status).toBe(200);
  expect(correction1.body.success).toBe(true);
  expect(correction1.body.data.deltaPoints).toBe(25);
  const expectedTotalScore1 = cell3.successPoints + 25;
  expect(correction1.body.data.newTotalScore).toBe(expectedTotalScore1);

  // DB verification for correction 1
  const team1AfterCorr1 = await Team.findByPk(team1Id);
  expect(Number(team1AfterCorr1.totalScore)).toBe(expectedTotalScore1);

  const correctionLedger1 = await ScoreLedger.findByPk(correction1.body.data.correctionId);
  expect(correctionLedger1.source).toBe('CORRECTION');
  expect(correctionLedger1.deltaPoints).toBe(25);
  expect(correctionLedger1.reason).toBe('Bonus fair play dari juri event');

  const auditCorrection1 = await AuditLog.findOne({
    where: { gameId, action: 'SCORE_CORRECTION', reason: 'Bonus fair play dari juri event' }
  });
  expect(auditCorrection1).toBeTruthy();
  expect(auditCorrection1.beforeJson.totalScore).toBe(cell3.successPoints);
  expect(auditCorrection1.afterJson.totalScore).toBe(expectedTotalScore1);

  // Event verification in game_events
  const corrEvent = await GameEvent.findOne({
    where: { gameId, type: 'game:correction_applied' }
  });
  expect(corrEvent).toBeTruthy();
  expect(corrEvent.payloadJson.deltaPoints).toBe(25);
  expect(corrEvent.payloadJson.affectedTeamId).toBe(team1Id);

  // 5. Test Negative Score Correction (-10 points) compensating initial ledger
  currentVersion = correction1.body.meta.stateVersion;
  const correctionKey2 = randomUUID();
  const correction2 = await api(`/${gameId}/corrections`, {
    key: correctionKey2,
    body: {
      teamId: team1Id,
      deltaPoints: -10,
      reason: 'Koreksi kelebihan poin tantangan awal',
      confirmed: true,
      expectedStateVersion: currentVersion,
      compensatesEntryId: initialLedger.id
    }
  });
  expect(correction2.status).toBe(200);
  expect(correction2.body.data.deltaPoints).toBe(-10);
  const expectedTotalScore2 = expectedTotalScore1 - 10;
  expect(correction2.body.data.newTotalScore).toBe(expectedTotalScore2);

  const correctionLedger2 = await ScoreLedger.findByPk(correction2.body.data.correctionId);
  expect(correctionLedger2.compensatesEntryId).toBe(initialLedger.id);
  expect(correctionLedger2.deltaPoints).toBe(-10);

  // 6. Mathematical Invariant Verification: team.total_score === SUM(delta_points)
  const allLedgersTeam1 = await ScoreLedger.findAll({ where: { gameId, teamId: team1Id } });
  const sumDeltas = allLedgersTeam1.reduce((acc, curr) => acc + curr.deltaPoints, 0);
  const team1Final = await Team.findByPk(team1Id);
  expect(Number(team1Final.totalScore)).toBe(sumDeltas);
  expect(sumDeltas).toBe(expectedTotalScore2);

  // 7. Test Idempotency Replay
  const replayRes = await api(`/${gameId}/corrections`, {
    key: correctionKey2,
    body: {
      teamId: team1Id,
      deltaPoints: -10,
      reason: 'Koreksi kelebihan poin tantangan awal',
      confirmed: true,
      expectedStateVersion: currentVersion,
      compensatesEntryId: initialLedger.id
    }
  });
  expect(replayRes.status).toBe(200);
  expect(replayRes.body.data.newTotalScore).toBe(expectedTotalScore2);

  // Ensure no duplicate ledger entry was added on idempotent replay
  const ledgersAfterReplay = await ScoreLedger.findAll({ where: { gameId, teamId: team1Id } });
  expect(ledgersAfterReplay).toHaveLength(allLedgersTeam1.length);

  // 8. Test Validation & Guard Errors
  // Zero delta
  const zeroDeltaRes = await api(`/${gameId}/corrections`, {
    body: {
      teamId: team1Id,
      deltaPoints: 0,
      reason: 'Zero point correction test',
      confirmed: true,
      expectedStateVersion: correction2.body.meta.stateVersion
    }
  });
  expect(zeroDeltaRes.status).toBe(400);
  expect(zeroDeltaRes.body.error.code).toBe('VALIDATION_ERROR');

  // Short/empty reason
  const shortReasonRes = await api(`/${gameId}/corrections`, {
    body: {
      teamId: team1Id,
      deltaPoints: 5,
      reason: 'ab',
      confirmed: true,
      expectedStateVersion: correction2.body.meta.stateVersion
    }
  });
  expect(shortReasonRes.status).toBe(400);
  expect(shortReasonRes.body.error.code).toBe('VALIDATION_ERROR');

  // Unconfirmed
  const unconfirmedRes = await api(`/${gameId}/corrections`, {
    body: {
      teamId: team1Id,
      deltaPoints: 5,
      reason: 'Koreksi valid',
      confirmed: false,
      expectedStateVersion: correction2.body.meta.stateVersion
    }
  });
  expect(unconfirmedRes.status).toBe(400);
  expect(unconfirmedRes.body.error.code).toBe('VALIDATION_ERROR');

  // Stale state version
  const staleRes = await api(`/${gameId}/corrections`, {
    body: {
      teamId: team1Id,
      deltaPoints: 5,
      reason: 'Koreksi valid',
      confirmed: true,
      expectedStateVersion: 1
    }
  });
  expect(staleRes.status).toBe(409);
  expect(staleRes.body.error.code).toBe('STALE_STATE');

  // Negative total score rejection
  const negativeScoreRes = await api(`/${gameId}/corrections`, {
    body: {
      teamId: team1Id,
      deltaPoints: -999, // Current score is around 30, so this would produce negative score
      reason: 'Koreksi poin terlalu besar',
      confirmed: true,
      expectedStateVersion: correction2.body.meta.stateVersion
    }
  });
  expect(negativeScoreRes.status).toBe(400);
  expect(negativeScoreRes.body.error.code).toBe('SCORE_BELOW_ZERO');

  // Invalid compensatesEntryId
  const invalidCompensateRes = await api(`/${gameId}/corrections`, {
    body: {
      teamId: team1Id,
      deltaPoints: 5,
      reason: 'Koreksi dengan entri acak',
      confirmed: true,
      expectedStateVersion: correction2.body.meta.stateVersion,
      compensatesEntryId: randomUUID()
    }
  });
  expect(invalidCompensateRes.status).toBe(404);
  expect(invalidCompensateRes.body.error.code).toBe('NOT_FOUND');

  // 9. Zero-result reference: referencing turn1 in correction
  const zeroRefCorrection = await api(`/${gameId}/corrections`, {
    body: {
      teamId: team1Id,
      deltaPoints: 5,
      reason: 'Koreksi merujuk turn 1 tanpa compensatesEntryId',
      confirmed: true,
      expectedStateVersion: correction2.body.meta.stateVersion,
      turnId: turn1Id
    }
  });
  expect(zeroRefCorrection.status).toBe(200);
  const zeroRefLedger = await ScoreLedger.findByPk(zeroRefCorrection.body.data.correctionId);
  expect(zeroRefLedger.turnId).toBe(turn1Id);
  expect(zeroRefLedger.compensatesEntryId).toBeNull();

  // 10. FINISHED Game Guard
  const finishRes = await api(`/${gameId}/finish`, {
    body: {
      expectedStateVersion: zeroRefCorrection.body.meta.stateVersion,
      confirmed: true
    }
  });
  expect(finishRes.status).toBe(200);

  const finishedCorrRes = await api(`/${gameId}/corrections`, {
    body: {
      teamId: team1Id,
      deltaPoints: 5,
      reason: 'Koreksi setelah game selesai',
      confirmed: true,
      expectedStateVersion: finishRes.body.meta.stateVersion
    }
  });
  expect(finishedCorrRes.status).toBe(409);
  expect(finishedCorrRes.body.error.code).toBe('GAME_FINISHED');
}, 45000);
