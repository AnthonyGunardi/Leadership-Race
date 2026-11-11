import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { io } from 'socket.io-client';
import { assertSafeTestSchema } from '../backend/src/config/database.js';
import { bootstrapAdminUser } from '../backend/src/services/adminBootstrap.js';
import { defineGameSetup } from '../backend/src/models/gameSetup.js';
import { defineTurn } from '../backend/src/models/turn.js';
import { defineScoring } from '../backend/src/models/scoring.js';
import { settleExpiredMovementIfDue } from '../backend/src/services/turnSettlement.js';
import { getPrdBoardTemplate } from '../backend/src/data/boardTemplate.js';

/**
 * Executes an accelerated full rehearsal simulation of an event:
 * - 10 teams on official PRD 50-cell board
 * - 5 concurrent admin operators
 * - 3 public Socket.IO observers, with final snapshot confirmation
 * - Complete lifecycle: Setup -> Start -> Movement -> Autonomous Settlement -> Scoring -> Void -> Finish
 * - Measures P95 write latency (< 1000ms target)
 * - Records server event age at socket receipt; this is not browser render or venue latency
 * - Verifies mathematical invariants: total_score = SUM(ledger), zero duplicate transactions, co-winner ranking
 *
 * @param {object} options
 * @param {import('sequelize').Sequelize} options.sequelize Database connection.
 * @param {string} options.baseUrl Base URL of API (e.g. http://127.0.0.1:3000/api/v1/games).
 * @param {number} [options.teamCount=10] Number of competing teams.
 * @param {number} [options.adminCount=5] Number of admin users.
 * @param {number} [options.displayCount=3] Number of display screens.
 * @param {number} [options.rounds=1] Number of full race rounds across all teams.
 * @param {object} [options.logger=console] Logger instance.
 * @returns {Promise<object>} Complete simulation benchmark results.
 */
export async function runRehearsalSimulation({
  sequelize,
  baseUrl,
  teamCount = 10,
  adminCount = 5,
  displayCount = 3,
  rounds = 1,
  logger = console
}) {
  assertSafeTestSchema(sequelize.config.database);
  const startTime = performance.now();
  const writeLatencies = [];
  const realtimeDelays = [];
  let transactionsCount = 0;

  const { Team } = defineGameSetup(sequelize);
  const Turn = defineTurn(sequelize);
  const { ScoreLedger } = defineScoring(sequelize);

  // Helper for authenticated API calls with latency tracking
  async function measuredApi(path, { method = 'GET', body, token, key = randomUUID() } = {}) {
    const isWrite = method === 'POST' || method === 'PUT' || method === 'DELETE' || method === 'PATCH';
    const reqStart = performance.now();

    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': key,
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });

    const elapsed = performance.now() - reqStart;
    if (isWrite && response.ok) {
      writeLatencies.push(elapsed);
      transactionsCount++;
    }

    const data = await response.json();
    return { status: response.status, body: data, latencyMs: elapsed };
  }

  logger.log(`Starting Event Rehearsal Simulation: ${teamCount} teams, ${adminCount} admins, ${displayCount} displays...`);

  // 1. Bootstrap Admin Operators
  const admins = [];
  for (let i = 0; i < adminCount; i++) {
    const email = `rehearsal-admin-${i + 1}-${Date.now()}@example.test`;
    const password = 'RehearsalPass123!';
    const user = await bootstrapAdminUser({ sequelize, email, password });

    const loginRes = await fetch(baseUrl.replace('/games', '/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const loginData = await loginRes.json();
    admins.push({
      id: user.id,
      email,
      token: loginData.data.accessToken
    });
  }

  // 2. Initialize Game with 10 Teams and PRD 50-cell board
  const primaryAdmin = admins[0];
  const template = getPrdBoardTemplate();
  const officialTeams = [
    { name: 'Red Bull Racing', color: '#1e41ff', sortOrder: 1 },
    { name: 'Scuderia Ferrari', color: '#e10600', sortOrder: 2 },
    { name: 'Mercedes-AMG F1', color: '#00d2be', sortOrder: 3 },
    { name: 'McLaren F1 Team', color: '#ff8700', sortOrder: 4 },
    { name: 'Aston Martin F1', color: '#006f62', sortOrder: 5 },
    { name: 'Alpine F1 Team', color: '#0090ff', sortOrder: 6 },
    { name: 'Williams Racing', color: '#005aff', sortOrder: 7 },
    { name: 'Visa Cash App RB', color: '#6692ff', sortOrder: 8 },
    { name: 'Stake F1 Team', color: '#52e252', sortOrder: 9 },
    { name: 'Haas F1 Team', color: '#b6babd', sortOrder: 10 }
  ].slice(0, teamCount);

  const createRes = await measuredApi('/current', {
    method: 'POST',
    token: primaryAdmin.token,
    body: { name: 'F1 Leadership Race Grand Prix Rehearsal' }
  });
  if (createRes.status !== 200) throw new Error(`Create game failed: ${JSON.stringify(createRes.body)}`);
  if (createRes.body.data.game.status !== 'DRAFT' || createRes.body.data.teams.length) {
    throw new Error('Rehearsal requires a fresh disposable schema with no configured operational game.');
  }
  const gameId = createRes.body.data.game.id;
  let stateVersion = createRes.body.meta.stateVersion;

  const tplRes = await measuredApi(`/${gameId}/board-template`, {
    method: 'POST',
    token: primaryAdmin.token,
    body: { templateId: 'prd-appendix-a-v1', expectedStateVersion: stateVersion }
  });
  stateVersion = tplRes.body.meta.stateVersion;

  const setupRes = await measuredApi(`/${gameId}/setup`, {
    method: 'PUT',
    token: primaryAdmin.token,
    body: {
      name: 'F1 Leadership Race Grand Prix Rehearsal',
      expectedStateVersion: stateVersion,
      boardCells: template.boardCells,
      teams: officialTeams
    }
  });
  stateVersion = setupRes.body.meta.stateVersion;

  // 3. Preflight & Start Game
  const validateRes = await measuredApi(`/${gameId}/validate`, {
    method: 'POST',
    token: primaryAdmin.token,
    body: { expectedStateVersion: stateVersion }
  });
  stateVersion = validateRes.body.meta.stateVersion;

  const startRes = await measuredApi(`/${gameId}/start`, {
    method: 'POST',
    token: primaryAdmin.token,
    body: { expectedStateVersion: stateVersion }
  });
  stateVersion = startRes.body.meta.stateVersion;
  logger.log(`Game started successfully. ID: ${gameId}, Initial StateVersion: ${stateVersion}`);

  // Public sockets replace pairing credentials; all connections are closed even when rehearsal fails.
  const displays = [];
  let invalidPublicPayloads = 0;
  try {
    for (let i = 0; i < displayCount; i++) {
      const socket = io(baseUrl.replace('/api/v1/games', ''), {
        autoConnect: false, reconnection: false, auth: { gameId, public: true }
      });
      displays.push(socket);
      socket.onAny((type, event) => {
        if (!type.startsWith('game:')) return;
        if (event.gameId !== gameId || Object.keys(event.payload || {}).length !== 0) invalidPublicPayloads++;
        realtimeDelays.push(Math.max(0, Date.now() - Date.parse(event.occurredAt)));
      });
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Public socket connection timed out')), 5000);
        socket.once('connect', () => { clearTimeout(timer); resolve(); });
        socket.once('connect_error', (error) => { clearTimeout(timer); reject(error); });
        socket.connect();
      });
      const joined = await socket.timeout(5000).emitWithAck('game:join', { gameId });
      if (!joined.success) throw new Error('Public subscription denied');
    }
    logger.log(`Connected ${displays.length} public displays without pairing.`);

    // 5. Simulate Multi-Turn Racing Progression
    let activeAdminIndex = 0;
    let leaseToken;

    // Initial lease acquisition
    const acqRes = await measuredApi(`/${gameId}/controller/acquire`, {
      method: 'POST',
      token: admins[activeAdminIndex].token,
      body: { expectedStateVersion: stateVersion }
    });
    leaseToken = acqRes.body.data.controllerLeaseToken;
    stateVersion = acqRes.body.meta.stateVersion;

    const totalTurnsToSimulate = rounds * teamCount;
    let voidExecuted = false;

    for (let turnIdx = 1; turnIdx <= totalTurnsToSimulate; turnIdx++) {
      // Periodically take over / rotate controller lease among admins
      if (turnIdx % 4 === 0) {
        activeAdminIndex = (activeAdminIndex + 1) % adminCount;
        const handover = await measuredApi(`/${gameId}/controller/take-over`, {
          method: 'POST',
          token: admins[activeAdminIndex].token,
          body: { expectedStateVersion: stateVersion, confirmed: true }
        });
        if (handover.status === 200) {
          leaseToken = handover.body.data.controllerLeaseToken;
          stateVersion = handover.body.meta.stateVersion;
        }
      }

      // Roll physical dice (simulating 1-6)
      const diceVal = ((turnIdx * 3 + 1) % 6) + 1;

      const rollRes = await measuredApi(`/${gameId}/turns/roll`, {
        method: 'POST',
        token: admins[activeAdminIndex].token,
        body: {
          diceValue: diceVal,
          expectedStateVersion: stateVersion,
          controllerLeaseToken: leaseToken
        }
      });

      if (rollRes.status !== 200) {
        throw new Error(`Roll failed on turn ${turnIdx}: ${JSON.stringify(rollRes.body)}`);
      }

      let currentTurnId = rollRes.body.data.turnId;
      let landingCellNum = rollRes.body.data.landingCell;

      // Fast-forward animation and trigger autonomous background settlement
      await Turn.update(
        { movementEndsAt: new Date(Date.now() - 1000) },
        { where: { id: currentTurnId } }
      );
      await settleExpiredMovementIfDue({ sequelize, gameId });

      const postSettlementSnap1 = await measuredApi(`/${gameId}/snapshot`, {
        token: admins[activeAdminIndex].token
      });
      stateVersion = postSettlementSnap1.body.meta.stateVersion;

      // Exercise Turn Void on turn 5 (R-05, R-06, R-07)
      if (turnIdx === 5 && !voidExecuted) {
        const voidRes = await measuredApi(`/${gameId}/turns/${currentTurnId}/void`, {
          method: 'POST',
          token: admins[activeAdminIndex].token,
          body: {
            expectedStateVersion: stateVersion,
            reason: 'Koreksi salah baca dadu fisik pengawas',
            confirmed: true
          }
        });

        if (voidRes.status === 200) {
          voidExecuted = true;
          stateVersion = voidRes.body.meta.stateVersion;

          // Re-roll replacement turn for the same team
          const reRollRes = await measuredApi(`/${gameId}/turns/roll`, {
            method: 'POST',
            token: admins[activeAdminIndex].token,
            body: {
              diceValue: 2,
              expectedStateVersion: stateVersion,
              controllerLeaseToken: leaseToken
            }
          });
          if (reRollRes.status === 200) {
            currentTurnId = reRollRes.body.data.turnId;
            landingCellNum = reRollRes.body.data.landingCell;
            await Turn.update(
              { movementEndsAt: new Date(Date.now() - 1000) },
              { where: { id: currentTurnId } }
            );
            await settleExpiredMovementIfDue({ sequelize, gameId });
          }
        }
      }

      // Resolve scoring if cell requires challenge/scoring
      const postSettlementSnap = await measuredApi(`/${gameId}/snapshot`, {
        token: admins[activeAdminIndex].token
      });
      stateVersion = postSettlementSnap.body.meta.stateVersion;

      if (postSettlementSnap.body.data.turnStatus === 'AWAITING_RESULT') {
        const activeTurnId = postSettlementSnap.body.data.turn?.id || currentTurnId;

        // Check if square is Origami (cell 26) -> 20 MANUAL pts, or square 44 -> 35 MANUAL pts
        let scoringPayload;
        if (landingCellNum === 26) {
          scoringPayload = { scoringMethod: 'MANUAL', points: 20, expectedStateVersion: stateVersion };
        } else if (landingCellNum === 44) {
          scoringPayload = { scoringMethod: 'MANUAL', points: 35, expectedStateVersion: stateVersion };
        } else if (turnIdx % 3 === 0) {
          scoringPayload = { scoringMethod: 'BUTTON', outcome: 'FAIL', expectedStateVersion: stateVersion };
        } else {
          scoringPayload = { scoringMethod: 'BUTTON', outcome: 'SUCCESS', expectedStateVersion: stateVersion };
        }

        const scoreRes = await measuredApi(`/${gameId}/turns/${activeTurnId}/result`, {
          method: 'POST',
          token: admins[(activeAdminIndex + 1) % adminCount].token,
          body: scoringPayload
        });

        if (scoreRes.status === 200) {
          stateVersion = scoreRes.body.meta.stateVersion;
        }
      }
    }

    // 6. Manual Finish & Final Evaluation
    const finishNotifications = displays.map((socket) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Public finish event timed out')), 5000);
      socket.once('game:finished', (event) => { clearTimeout(timer); resolve(event); });
    }));
    const finishRes = await measuredApi(`/${gameId}/finish`, {
      method: 'POST',
      token: primaryAdmin.token,
      body: { expectedStateVersion: stateVersion, confirmed: true }
    });
    if (finishRes.status !== 200) {
      throw new Error(`Finish failed: ${JSON.stringify(finishRes.body)}`);
    }
    const finalResults = finishRes.body.data.finalResults;
    const finishedEvents = await Promise.all(finishNotifications);
    const confirmedDisplays = await Promise.all(finishedEvents.map(async (event) => {
      const response = await fetch(baseUrl.replace('/games', '/public/game'));
      const snapshot = await response.json();
      return response.ok && snapshot.data.game.id === gameId && snapshot.data.game.status === 'FINISHED'
        && snapshot.meta.eventSequence >= event.sequence;
    }));

    // 7. Rigorous Invariant Assertions
    const teams = await Team.findAll({ where: { gameId } });
    let mathConsistencyPass = true;
    for (const team of teams) {
      const totalLedger = (await ScoreLedger.sum('deltaPoints', { where: { gameId, teamId: team.id } })) || 0;
      if (team.totalScore !== totalLedger) {
        mathConsistencyPass = false;
        logger.error(`Score invariant violated for team ${team.name}: score=${team.totalScore}, ledgerSum=${totalLedger}`);
      }
    }

    // Latency Metrics Calculation
    writeLatencies.sort((a, b) => a - b);
    const p50 = writeLatencies[Math.floor(writeLatencies.length * 0.5)] || 0;
    const p90 = writeLatencies[Math.floor(writeLatencies.length * 0.9)] || 0;
    const p95 = writeLatencies[Math.floor(writeLatencies.length * 0.95)] || 0;
    const maxLatency = writeLatencies[writeLatencies.length - 1] || 0;
    const avgPropagation = realtimeDelays.reduce((sum, d) => sum + d, 0) / (realtimeDelays.length || 1);

    const simulationSummary = {
      success: true,
      gameId,
      teamsCount: teams.length,
      adminsCount: adminCount,
      displaysCount: displays.length,
      totalTransactions: transactionsCount,
      durationMs: performance.now() - startTime,
      invariants: {
        mathScoreConsistency: mathConsistencyPass,
        zeroDoubleTransactions: (await Turn.count({ where: { gameId } }))
          === totalTurnsToSimulate + Number(voidExecuted),
        publicDisplaysConfirmed: confirmedDisplays.every(Boolean),
        publicPayloadsSafe: invalidPublicPayloads === 0,
        turnVoidRecovered: voidExecuted,
        coWinnerRankingEvaluated: finalResults && Array.isArray(finalResults.winners)
      },
      performanceMetrics: {
        p50WriteMs: Math.round(p50 * 100) / 100,
        p90WriteMs: Math.round(p90 * 100) / 100,
        p95WriteMs: Math.round(p95 * 100) / 100,
        maxWriteMs: Math.round(maxLatency * 100) / 100,
        avgEventReceiptAgeMs: Math.round(avgPropagation * 100) / 100,
        p95WithinTarget: p95 < 1000
      },
      finalStandings: finalResults?.winners || []
    };

    logger.log('Rehearsal Simulation Complete:');
    logger.log(`- Transactions Committed: ${transactionsCount}`);
    logger.log(`- P95 Write Latency: ${simulationSummary.performanceMetrics.p95WriteMs} ms (Target < 1000ms: ${simulationSummary.performanceMetrics.p95WithinTarget})`);
    logger.log(`- Server event age at socket receipt: ${simulationSummary.performanceMetrics.avgEventReceiptAgeMs} ms`);
    logger.log(`- Mathematical Score Invariant: ${mathConsistencyPass ? 'VERIFIED' : 'FAILED'}`);
    logger.log(`- Void Turn Recovery: ${voidExecuted ? 'VERIFIED' : 'SKIPPED'}`);

    return simulationSummary;
  } finally {
    for (const socket of displays) socket.disconnect();
  }
}

// Standalone CLI execution support
/* istanbul ignore next -- CLI auto-runner */
const isMain = process.argv[1] && (
  process.argv[1].endsWith('rehearsalSimulation.js') ||
  process.argv[1].endsWith('rehearsalSimulation')
);

if (isMain) {
  import('../backend/src/config/environment.js').then(({ validateEnvironment, getEnv }) => {
    validateEnvironment();
    const env = getEnv();
    import('../backend/src/config/database.js').then(async ({ getSequelize, closeSequelize }) => {
      const sequelize = getSequelize();
      await sequelize.authenticate();
      const port = env.PORT || 3000;
      const baseUrl = `http://127.0.0.1:${port}/api/v1/games`;

      try {
        await runRehearsalSimulation({ sequelize, baseUrl });
      } catch (err) {
        console.error('Rehearsal simulation failed:', err);
      } finally {
        await closeSequelize().catch(() => {});
      }
    });
  });
}
