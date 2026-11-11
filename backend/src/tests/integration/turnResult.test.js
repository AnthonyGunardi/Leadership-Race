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

  for (const email of ['score-admin-a@example.test', 'score-admin-b@example.test']) {
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

it('manages BUTTON scoring results, ledger invariants, and leaderboard rankings', async () => {
  const { Team, BoardCell, GameEvent } = defineGameSetup(database.sequelize);
  const Turn = defineTurn(database.sequelize);
  const { ChallengeResult, ScoreLedger } = defineScoring(database.sequelize);

  // 1. Create and Start Game
  const createRes = await prepareTestSession(api, 'G9 Scoring Race');
  expect(createRes.status).toBe(200);
  const gameId = createRes.body.data.game.id;

  const tplRes = await api(`/${gameId}/board-template`, {
    body: { templateId: 'prd-appendix-a-v1', expectedStateVersion: createRes.body.meta.stateVersion }
  });
  expect(tplRes.status).toBe(200);

  const setupRes = await api(`/${gameId}/setup`, {
    method: 'PUT',
    body: {
      name: 'G9 Scoring Race',
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

  const start = await api(`/${gameId}/start`, {
    body: { expectedStateVersion: valRes.body.meta.stateVersion }
  });
  expect(start.status).toBe(200);
  expect(start.body.data.game.status).toBe('RUNNING');

  // 2. Admin A acquires controller lease
  const acquire = await api(`/${gameId}/controller/acquire`, {
    body: { expectedStateVersion: start.body.meta.stateVersion }
  });
  expect(acquire.status).toBe(200);
  const leaseToken = acquire.body.data.controllerLeaseToken;

  // 3. Roll dice 3 (Cell 3 is Action, requiresChallenge = true)
  const roll1 = await api(`/${gameId}/turns/roll`, {
    body: {
      diceValue: 3,
      expectedStateVersion: acquire.body.meta.stateVersion,
      controllerLeaseToken: leaseToken
    }
  });
  expect(roll1.status).toBe(200);
  const turn1Id = roll1.body.data.turnId;
  const team1Id = roll1.body.data.teamId;

  // Simulate movement completion by setting movementEndsAt to past and settling
  await Turn.update(
    { movementEndsAt: new Date(Date.now() - 5000) },
    { where: { id: turn1Id } }
  );
  await settleExpiredMovementIfDue({ sequelize: database.sequelize, gameId });

  const turnRecord = await Turn.findByPk(turn1Id);
  expect(turnRecord.status).toBe('AWAITING_RESULT');

  const snapshotRes = await api(`/${gameId}/snapshot`);
  const cell3 = await BoardCell.findOne({ where: { gameId, number: 3 } });
  expect(cell3.successPoints).toBeGreaterThan(0);

  // 4. Admin B (who does NOT have controller lease) submits BUTTON SUCCESS
  const idempotencyKey1 = randomUUID();
  const result1 = await api(`/${gameId}/turns/${turn1Id}/result`, {
    admin: 1, // Admin B
    key: idempotencyKey1,
    body: {
      scoringMethod: 'BUTTON',
      outcome: 'SUCCESS',
      expectedStateVersion: snapshotRes.body.meta.stateVersion
    }
  });
  expect(result1.status).toBe(200);
  expect(result1.body.data.awardedPoints).toBe(cell3.successPoints);
  expect(result1.body.data.newTotalScore).toBe(cell3.successPoints);

  // 5. Verify challenge_results and score_ledger in database
  const savedResult1 = await ChallengeResult.findOne({ where: { turnId: turn1Id } });
  expect(savedResult1).not.toBeNull();
  expect(savedResult1.scoringMethod).toBe('BUTTON');
  expect(savedResult1.outcome).toBe('SUCCESS');
  expect(savedResult1.manualPoints).toBeNull();
  expect(savedResult1.awardedPoints).toBe(cell3.successPoints);

  const ledgers1 = await ScoreLedger.findAll({ where: { gameId, teamId: team1Id } });
  expect(ledgers1.length).toBe(1);
  expect(ledgers1[0].deltaPoints).toBe(cell3.successPoints);
  expect(ledgers1[0].source).toBe('CHALLENGE_BUTTON');
  expect(ledgers1[0].challengeResultId).toBe(savedResult1.id);

  // Invariant: total_score == SUM(delta_points)
  const team1 = await Team.findByPk(team1Id);
  const ledgerSum1 = ledgers1.reduce((acc, l) => acc + l.deltaPoints, 0);
  expect(team1.totalScore).toBe(ledgerSum1);

  // 6. Idempotent replay with identical key returns cached 200 without duplicate score
  const replay1 = await api(`/${gameId}/turns/${turn1Id}/result`, {
    admin: 1,
    key: idempotencyKey1,
    body: {
      scoringMethod: 'BUTTON',
      outcome: 'SUCCESS',
      expectedStateVersion: snapshotRes.body.meta.stateVersion
    }
  });
  expect(replay1.status).toBe(200);
  expect(replay1.body.data.awardedPoints).toBe(cell3.successPoints);

  const ledgersCheck = await ScoreLedger.findAll({ where: { gameId, teamId: team1Id } });
  expect(ledgersCheck.length).toBe(1); // Still exactly 1 row!

  // 7. Duplicate submit with NEW idempotency key on completed turn returns 409 ALREADY_RESOLVED
  const duplicateSubmit = await api(`/${gameId}/turns/${turn1Id}/result`, {
    admin: 0,
    key: randomUUID(),
    body: {
      scoringMethod: 'BUTTON',
      outcome: 'FAIL',
      expectedStateVersion: result1.body.meta.stateVersion
    }
  });
  expect(duplicateSubmit.status).toBe(409);
  expect(duplicateSubmit.body.error.code).toBe('ALREADY_RESOLVED');

  // 8. Turn 2 for next team: roll and submit BUTTON FAIL
  const snap2 = await api(`/${gameId}/snapshot`);
  const nextTeamId = snap2.body.data.game.currentTeamId;
  expect(nextTeamId).not.toBe(team1Id);

  const roll2 = await api(`/${gameId}/turns/roll`, {
    body: {
      diceValue: 2,
      expectedStateVersion: snap2.body.meta.stateVersion,
      controllerLeaseToken: leaseToken
    }
  });
  expect(roll2.status).toBe(200);
  const turn2Id = roll2.body.data.turnId;

  await Turn.update(
    { movementEndsAt: new Date(Date.now() - 5000) },
    { where: { id: turn2Id } }
  );
  await settleExpiredMovementIfDue({ sequelize: database.sequelize, gameId });

  const snap3 = await api(`/${gameId}/snapshot`);
  const result2 = await api(`/${gameId}/turns/${turn2Id}/result`, {
    admin: 0,
    body: {
      scoringMethod: 'BUTTON',
      outcome: 'FAIL',
      expectedStateVersion: snap3.body.meta.stateVersion
    }
  });
  expect(result2.status).toBe(200);
  expect(result2.body.data.awardedPoints).toBe(0);
  expect(result2.body.data.newTotalScore).toBe(0);

  // Invariant: BUTTON/FAIL 0 creates challenge_result but NO score_ledger row
  const savedResult2 = await ChallengeResult.findOne({ where: { turnId: turn2Id } });
  expect(savedResult2).not.toBeNull();
  expect(savedResult2.outcome).toBe('FAIL');
  expect(savedResult2.awardedPoints).toBe(0);

  const ledgers2 = await ScoreLedger.findAll({ where: { gameId, teamId: nextTeamId } });
  expect(ledgers2.length).toBe(0); // Zero ledger entry!

  const team2 = await Team.findByPk(nextTeamId);
  expect(team2.totalScore).toBe(0);

  // 9. Verify Leaderboard API endpoint GET /api/v1/games/:id/leaderboard
  const lbRes = await api(`/${gameId}/leaderboard`);
  expect(lbRes.status).toBe(200);
  expect(lbRes.body.data.leaderboard.length).toBeGreaterThan(1);

  const topTeam = lbRes.body.data.leaderboard[0];
  expect(topTeam.teamId).toBe(team1Id);
  expect(topTeam.rank).toBe(1);
  expect(topTeam.totalScore).toBe(cell3.successPoints);

  const secondTeam = lbRes.body.data.leaderboard[1];
  expect(secondTeam.rank).toBe(2);
  expect(secondTeam.totalScore).toBe(0);

  // 10. Verify published events in GameEvents
  const events = await GameEvent.findAll({ where: { gameId }, order: [['sequence', 'ASC']] });
  const eventTypes = events.map((e) => e.type);
  expect(eventTypes).toContain('game:challenge_resolved');
  expect(eventTypes).toContain('game:leaderboard_updated');
  expect(eventTypes).toContain('game:state_changed');
});

it('handles MANUAL scoring, Origami cell 26 total points, zero points invariant, and concurrent conflict (G10 / D-03)', async () => {
  const { Team, BoardCell } = defineGameSetup(database.sequelize);
  const Turn = defineTurn(database.sequelize);
  const { ChallengeResult, ScoreLedger } = defineScoring(database.sequelize);

  // 1. Create and Start Game
  const createRes = await prepareTestSession(api, 'G10 Manual Scoring Game');
  expect(createRes.status).toBe(200);
  const gameId = createRes.body.data.game.id;

  const tplRes = await api(`/${gameId}/board-template`, {
    body: { templateId: 'prd-appendix-a-v1', expectedStateVersion: createRes.body.meta.stateVersion }
  });
  expect(tplRes.status).toBe(200);

  const setupRes = await api(`/${gameId}/setup`, {
    method: 'PUT',
    body: {
      name: 'G10 Manual Scoring Game',
      expectedStateVersion: tplRes.body.meta.stateVersion,
      boardCells: tplRes.body.data.boardCells,
      teams: [
        { name: 'Red Bull', color: '#1e3d59', sortOrder: 1 },
        { name: 'McLaren', color: '#ff8000', sortOrder: 2 }
      ]
    }
  });
  expect(setupRes.status).toBe(200);

  const valRes = await api(`/${gameId}/validate`, {
    body: { expectedStateVersion: setupRes.body.meta.stateVersion }
  });
  expect(valRes.status).toBe(200);

  const start = await api(`/${gameId}/start`, {
    body: { expectedStateVersion: valRes.body.meta.stateVersion }
  });
  expect(start.status).toBe(200);

  // 2. Acquire controller
  const acquire = await api(`/${gameId}/controller/acquire`, {
    body: { expectedStateVersion: start.body.meta.stateVersion }
  });
  const leaseToken = acquire.body.data.controllerLeaseToken;

  // 3. Roll to an Action cell (dice = 1, landingCell = 1)
  const roll1 = await api(`/${gameId}/turns/roll`, {
    body: { diceValue: 1, expectedStateVersion: acquire.body.meta.stateVersion, controllerLeaseToken: leaseToken }
  });
  expect(roll1.status).toBe(200);
  const turn1Id = roll1.body.data.turnId;
  const team1Id = roll1.body.data.teamId;

  await Turn.update({ movementEndsAt: new Date(Date.now() - 5000) }, { where: { id: turn1Id } });
  await settleExpiredMovementIfDue({ sequelize: database.sequelize, gameId });

  const snap1 = await api(`/${gameId}/snapshot`);
  expect(snap1.body.data.turnStatus).toBe('AWAITING_RESULT');

  // Cell 1 has successPoints = 20. Admin inputs MANUAL 35 points (AT-26 / AT-57)
  const cell1 = await BoardCell.findOne({ where: { gameId, number: 1 } });
  expect(cell1.successPoints).toBe(20);

  const manualResult1 = await api(`/${gameId}/turns/${turn1Id}/result`, {
    admin: 0,
    body: {
      scoringMethod: 'MANUAL',
      points: 35,
      note: 'Offline special challenge bonus 35',
      expectedStateVersion: snap1.body.meta.stateVersion
    }
  });
  expect(manualResult1.status).toBe(200);
  expect(manualResult1.body.data.scoringMethod).toBe('MANUAL');
  expect(manualResult1.body.data.outcome).toBeNull();
  expect(manualResult1.body.data.awardedPoints).toBe(35); // Exactly 35, NOT 35+20!
  expect(manualResult1.body.data.newTotalScore).toBe(35);

  // Verify challenge_results and score_ledger
  const cr1 = await ChallengeResult.findOne({ where: { turnId: turn1Id } });
  expect(cr1.scoringMethod).toBe('MANUAL');
  expect(cr1.outcome).toBeNull();
  expect(cr1.manualPoints).toBe(35);
  expect(cr1.awardedPoints).toBe(35);
  expect(cr1.note).toBe('Offline special challenge bonus 35');

  const ledgers1 = await ScoreLedger.findAll({ where: { gameId, teamId: team1Id } });
  expect(ledgers1.length).toBe(1);
  expect(ledgers1[0].deltaPoints).toBe(35);
  expect(ledgers1[0].source).toBe('CHALLENGE_MANUAL');
  expect(ledgers1[0].reason).toBe('Offline special challenge bonus 35');

  const team1 = await Team.findByPk(team1Id);
  expect(team1.totalScore).toBe(35);

  // 4. Duplicate submit with BUTTON on already resolved turn gives 409 ALREADY_RESOLVED (AT-29)
  const conflictRes = await api(`/${gameId}/turns/${turn1Id}/result`, {
    admin: 1,
    body: {
      scoringMethod: 'BUTTON',
      outcome: 'SUCCESS',
      expectedStateVersion: manualResult1.body.meta.stateVersion
    }
  });
  expect(conflictRes.status).toBe(409);
  expect(conflictRes.body.error.code).toBe('ALREADY_RESOLVED');

  // 5. Turn 2 for Team 2: Origami Kotak 26 simulation
  // Update Team 2 position to 25 so rolling 1 lands on cell 26
  const snap2 = await api(`/${gameId}/snapshot`);
  const team2Id = snap2.body.data.game.currentTeamId;
  await Team.update({ position: 25 }, { where: { id: team2Id } });

  const roll2 = await api(`/${gameId}/turns/roll`, {
    body: { diceValue: 1, expectedStateVersion: snap2.body.meta.stateVersion, controllerLeaseToken: leaseToken }
  });
  expect(roll2.status).toBe(200);
  const turn2Id = roll2.body.data.turnId;
  expect(roll2.body.data.landingCell).toBe(26);

  await Turn.update({ movementEndsAt: new Date(Date.now() - 5000) }, { where: { id: turn2Id } });
  await settleExpiredMovementIfDue({ sequelize: database.sequelize, gameId });

  const snap3 = await api(`/${gameId}/snapshot`);
  expect(snap3.body.data.pendingResult.cellNumber).toBe(26);
  expect(snap3.body.data.pendingResult.defaultMethod).toBe('MANUAL');
  expect(snap3.body.data.pendingResult.pointsPerUnit).toBe(5);

  // Admin inputs 20 points for 4 origami (AT-24)
  const origamiKey = randomUUID();
  const origamiRes = await api(`/${gameId}/turns/${turn2Id}/result`, {
    admin: 1,
    key: origamiKey,
    body: {
      scoringMethod: 'MANUAL',
      points: 20,
      note: '4 origami berhasil x 5 poin',
      expectedStateVersion: snap3.body.meta.stateVersion
    }
  });
  expect(origamiRes.status).toBe(200);
  expect(origamiRes.body.data.awardedPoints).toBe(20);
  expect(origamiRes.body.data.newTotalScore).toBe(20);

  const cr2 = await ChallengeResult.findOne({ where: { turnId: turn2Id } });
  expect(cr2.scoringMethod).toBe('MANUAL');
  expect(cr2.manualPoints).toBe(20);
  expect(cr2.awardedPoints).toBe(20);

  const ledgers2 = await ScoreLedger.findAll({ where: { gameId, teamId: team2Id } });
  expect(ledgers2.length).toBe(1);
  expect(ledgers2[0].deltaPoints).toBe(20);
  expect(ledgers2[0].source).toBe('CHALLENGE_MANUAL');

  // Idempotent replay of MANUAL result with identical key and payload (AT-31)
  const replayOrigami = await api(`/${gameId}/turns/${turn2Id}/result`, {
    admin: 1,
    key: origamiKey,
    body: {
      scoringMethod: 'MANUAL',
      points: 20,
      note: '4 origami berhasil x 5 poin',
      expectedStateVersion: snap3.body.meta.stateVersion
    }
  });
  expect(replayOrigami.status).toBe(200);
  expect(replayOrigami.body.data.awardedPoints).toBe(20);

  const ledgers2Check = await ScoreLedger.findAll({ where: { gameId, teamId: team2Id } });
  expect(ledgers2Check.length).toBe(1); // No duplicate ledger row!

  // 6. Turn 3: MANUAL with 0 points (AT-30)
  const snap4 = await api(`/${gameId}/snapshot`);
  const roll3 = await api(`/${gameId}/turns/roll`, {
    body: { diceValue: 2, expectedStateVersion: snap4.body.meta.stateVersion, controllerLeaseToken: leaseToken }
  });
  const turn3Id = roll3.body.data.turnId;

  await Turn.update({ movementEndsAt: new Date(Date.now() - 5000) }, { where: { id: turn3Id } });
  await settleExpiredMovementIfDue({ sequelize: database.sequelize, gameId });

  const snap5 = await api(`/${gameId}/snapshot`);
  const manualZeroRes = await api(`/${gameId}/turns/${turn3Id}/result`, {
    admin: 0,
    body: {
      scoringMethod: 'MANUAL',
      points: 0,
      note: 'Tidak berhasil menyelesaikan aktivitas',
      expectedStateVersion: snap5.body.meta.stateVersion
    }
  });
  expect(manualZeroRes.status).toBe(200);
  expect(manualZeroRes.body.data.awardedPoints).toBe(0);
  expect(manualZeroRes.body.data.outcome).toBeNull();

  // Invariant: MANUAL 0 creates ChallengeResult with 0 awarded, but NO ScoreLedger entry!
  const cr3 = await ChallengeResult.findOne({ where: { turnId: turn3Id } });
  expect(cr3.scoringMethod).toBe('MANUAL');
  expect(cr3.awardedPoints).toBe(0);
  expect(cr3.manualPoints).toBe(0);

  const ledgersTeam1AfterZero = await ScoreLedger.findAll({ where: { gameId, teamId: team1Id } });
  // Still exactly 1 ledger from turn 1!
  expect(ledgersTeam1AfterZero.length).toBe(1);

  const team1AfterZero = await Team.findByPk(team1Id);
  expect(team1AfterZero.totalScore).toBe(35); // Total score unchanged!
});
