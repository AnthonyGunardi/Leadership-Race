import { randomUUID } from 'node:crypto';
import { Op } from 'sequelize';
import { defineGameSetup } from '../models/gameSetup.js';
import { defineTurn } from '../models/turn.js';
import { defineAuthAudit } from '../models/authAudit.js';
import { defineScoring } from '../models/scoring.js';
import { calculateLeaderboard } from '../domain/scoring.js';
import { databaseNow, executeGameCommand, GameError, safeInteger } from './gameCommands.js';
import { assertControllerLease } from './controllerLeases.js';
import { calculateMovement } from '../domain/movement.js';
import { settleExpiredMovementIfDue } from './turnSettlement.js';

const STEP_DURATION_MS = 450;
const START_DELAY_MS = 400;

/**
 * Executes a dice roll mutation with atomic movement calculation, durable turn persistence, and outbox publication.
 *
 * Requirements:
 * - Prior in-band settlement commits in a separate system transaction before roll validation.
 * - Enforces game RUNNING state, optimistic concurrency, and zero active turns (ANIMATING/AWAITING_RESULT reject 409).
 * - Enforces controller lease holding via assertControllerLease (CONTROLLER_NOT_HELD).
 * - Records dice_path, penalty_path, full_path, step_duration_ms, and database UTC movement start/end times.
 * - Schedules best-effort timer with movementWorker after commit.
 */
export async function rollDice({
  sequelize, gameId, actorUserId, idempotencyKey, requestId, input, movementWorker
}) {
  // In-band settlement commits in its own transaction before command processing
  await settleExpiredMovementIfDue({ sequelize, gameId, requestId });

  const { Team, BoardCell, GameEvent, OutboxEvent } = defineGameSetup(sequelize);
  const Turn = defineTurn(sequelize);
  const { AuditLog } = defineAuthAudit(sequelize);

  const result = await executeGameCommand({
    sequelize,
    gameId,
    actorUserId,
    idempotencyKey,
    requestId,
    commandType: 'ROLL_DICE',
    method: 'POST',
    target: `/api/v1/games/${gameId}/turns/roll`,
    input,
    mutate: async ({ game, transaction }) => {
      if (game.status === 'PAUSED') {
        throw new GameError('GAME_PAUSED', 'Game sedang di-pause.', 423);
      }
      if (game.status === 'FINISHED') {
        throw new GameError('GAME_FINISHED', 'Game sudah selesai.', 409);
      }
      if (game.status !== 'RUNNING') {
        throw new GameError('GAME_NOT_READY', 'Game belum dimulai atau tidak aktif.', 409);
      }

      await assertControllerLease({
        sequelize,
        transaction,
        gameId,
        actorUserId,
        controllerLeaseToken: input.controllerLeaseToken
      });

      if (safeInteger(game.stateVersion) !== input.expectedStateVersion) {
        throw new GameError('STALE_STATE', 'State game telah berubah. Muat ulang sebelum melakukan roll.', 409);
      }

      if (game.activeTurnId !== null) {
        throw new GameError('TURN_NOT_READY', 'Giliran sedang berlangsung atau menunggu hasil.', 409);
      }

      const nextTurnNumber = safeInteger(game.turnNumber) + 1;
      if (input.expectedTurnNumber !== undefined && input.expectedTurnNumber !== nextTurnNumber) {
        throw new GameError('STALE_STATE', 'Nomor turn tidak sesuai. Muat ulang status game.', 409);
      }

      const team = await Team.findByPk(game.currentTeamId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!team) {
        throw new GameError('TEAM_NOT_FOUND', 'Tim aktif tidak ditemukan.', 404);
      }

      const cells = await BoardCell.findAll({
        where: { gameId: game.id },
        order: [['number', 'ASC']],
        transaction
      });
      if (cells.length !== 50) {
        throw new GameError('GAME_NOT_READY', 'Konfigurasi papan tidak lengkap.', 409);
      }

      const movement = calculateMovement({
        from: team.position,
        diceValue: input.diceValue,
        boardCells: cells.map((cell) => ({
          number: cell.number,
          category: cell.category,
          penaltySteps: cell.penaltySteps
        }))
      });

      const now = await databaseNow(sequelize, transaction);
      const movementStartsAt = new Date(now.getTime() + START_DELAY_MS);
      const movementEndsAt = new Date(movementStartsAt.getTime() + movement.fullPath.length * STEP_DURATION_MS);

      const turn = await Turn.create({
        id: randomUUID(),
        gameId: game.id,
        turnNumber: nextTurnNumber,
        teamId: team.id,
        diceValue: input.diceValue,
        fromPosition: movement.from,
        landingCell: movement.landingCell,
        finalPosition: movement.finalPosition,
        status: 'ANIMATING',
        requiresChallenge: movement.requiresChallenge,
        dicePath: movement.dicePath,
        penaltyPath: movement.penaltyPath,
        fullPath: movement.fullPath,
        stepDurationMs: STEP_DURATION_MS,
        movementStartedAt: movementStartsAt,
        movementEndsAt,
        resolvedAt: null
      }, { transaction });

      team.position = movement.finalPosition;
      await team.save({ transaction });

      game.activeTurnId = turn.id;
      game.turnNumber = nextTurnNumber;
      game.stateVersion = safeInteger(safeInteger(game.stateVersion) + 1);
      game.eventSequence = safeInteger(safeInteger(game.eventSequence) + 1);
      await game.save({ transaction });

      const movementPayload = {
        turnId: turn.id,
        teamId: team.id,
        diceValue: turn.diceValue,
        from: movement.from,
        dicePath: movement.dicePath,
        penaltyPath: movement.penaltyPath,
        fullPath: movement.fullPath,
        landingCell: movement.landingCell,
        finalPosition: movement.finalPosition,
        requiresChallenge: movement.requiresChallenge,
        startAt: movementStartsAt.toISOString(),
        endAt: movementEndsAt.toISOString(),
        stepDurationMs: STEP_DURATION_MS
      };

      const moveEvent = await GameEvent.create({
        id: randomUUID(),
        gameId: game.id,
        sequence: game.eventSequence,
        stateVersion: game.stateVersion,
        type: 'game:movement_started',
        payloadJson: movementPayload,
        actorType: 'USER',
        actorUserId,
        requestId,
        occurredAt: now
      }, { transaction });

      await OutboxEvent.create({
        id: randomUUID(),
        gameId: game.id,
        gameEventId: moveEvent.id,
        nextAttemptAt: now
      }, { transaction });

      game.eventSequence = safeInteger(safeInteger(game.eventSequence) + 1);
      await game.save({ transaction });

      const stateEvent = await GameEvent.create({
        id: randomUUID(),
        gameId: game.id,
        sequence: game.eventSequence,
        stateVersion: game.stateVersion,
        type: 'game:state_changed',
        payloadJson: {
          status: game.status,
          currentTeamId: game.currentTeamId,
          activeTurnId: game.activeTurnId,
          turnNumber: safeInteger(game.turnNumber),
          turnStatus: 'ANIMATING'
        },
        actorType: 'USER',
        actorUserId,
        requestId,
        occurredAt: now
      }, { transaction });

      await OutboxEvent.create({
        id: randomUUID(),
        gameId: game.id,
        gameEventId: stateEvent.id,
        nextAttemptAt: now
      }, { transaction });

      await AuditLog.create({
        id: randomUUID(),
        gameId: game.id,
        actorType: 'USER',
        actorUserId,
        requestId,
        action: 'DICE_ROLLED',
        beforeJson: {
          position: movement.from,
          turnNumber: safeInteger(game.turnNumber) - 1,
          activeTurnId: null
        },
        afterJson: {
          turnId: turn.id,
          diceValue: turn.diceValue,
          from: movement.from,
          landingCell: movement.landingCell,
          finalPosition: movement.finalPosition,
          requiresChallenge: movement.requiresChallenge,
          movementEndsAt: movementEndsAt.toISOString()
        },
        occurredAt: now
      }, { transaction });

      return {
        status: 200,
        body: {
          success: true,
          data: {
            turnId: turn.id,
            teamId: team.id,
            diceValue: turn.diceValue,
            from: movement.from,
            dicePath: movement.dicePath,
            penaltyPath: movement.penaltyPath,
            fullPath: movement.fullPath,
            landingCell: movement.landingCell,
            finalPosition: movement.finalPosition,
            requiresChallenge: movement.requiresChallenge,
            movementStartsAt: movementStartsAt.toISOString(),
            movementEndsAt: movementEndsAt.toISOString(),
            stepDurationMs: STEP_DURATION_MS
          },
          meta: {
            stateVersion: safeInteger(game.stateVersion),
            eventSequence: safeInteger(game.eventSequence),
            serverTime: now.toISOString(),
            requestId
          }
        }
      };
    }
  });

  if (movementWorker && result?.body?.data?.movementEndsAt) {
    const delayMs = new Date(result.body.data.movementEndsAt).getTime() - Date.now() + 50;
    movementWorker.scheduleSettlementTimer({ gameId, delayMs });
  }

  return result;
}

/**
 * Records challenge scoring result for an AWAITING_RESULT turn.
 *
 * Requirements:
 * - Prior in-band settlement commits in a separate system transaction before command execution.
 * - Enforces game RUNNING state.
 * - Idempotent replay: retrying with identical Idempotency-Key returns cached 200 response without duplicate score.
 * - ALREADY_RESOLVED check takes priority over STALE_STATE (R-10, AT-29): if turn already resolved,
 *   rejects 409 ALREADY_RESOLVED.
 * - Optimistic concurrency: rejects 409 STALE_STATE if stateVersion does not match.
 * - Super Admin can submit with or without controller lease.
 * - For BUTTON: SUCCESS awards cell.successPoints; FAIL awards 0. points field is rejected.
 * - Records challenge_results row (UNIQUE(turn_id)).
 * - For awardedPoints > 0: inserts score_ledger row and atomically increments team.totalScore.
 * - For awardedPoints === 0: NO score_ledger row is created (zero delta ledger invariant).
 * - Completes turn, advances currentTeamId round-robin, emits challenge_resolved, leaderboard_updated,
 *   and state_changed events.
 */
export async function recordChallengeResult({
  sequelize, gameId, turnId, actorUserId, idempotencyKey, requestId, input
}) {
  await settleExpiredMovementIfDue({ sequelize, gameId, requestId });

  const { Team, BoardCell, GameEvent, OutboxEvent } = defineGameSetup(sequelize);
  const Turn = defineTurn(sequelize);
  const { ChallengeResult, ScoreLedger } = defineScoring(sequelize);
  const { AuditLog } = defineAuthAudit(sequelize);

  return executeGameCommand({
    sequelize,
    gameId,
    actorUserId,
    idempotencyKey,
    requestId,
    commandType: 'RESOLVE_CHALLENGE',
    method: 'POST',
    target: `/api/v1/games/${gameId}/turns/${turnId}/result`,
    input,
    mutate: async ({ game, transaction }) => {
      if (game.status === 'PAUSED') {
        throw new GameError('GAME_PAUSED', 'Game sedang di-pause.', 423);
      }
      if (game.status === 'FINISHED') {
        throw new GameError('GAME_FINISHED', 'Game sudah selesai.', 409);
      }
      if (game.status !== 'RUNNING') {
        throw new GameError('GAME_NOT_READY', 'Game belum dimulai atau tidak aktif.', 409);
      }

      const turn = await Turn.findByPk(turnId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!turn || turn.gameId !== game.id) {
        throw new GameError('NOT_FOUND', 'Giliran tidak ditemukan.', 404);
      }

      const existingResult = await ChallengeResult.findOne({
        where: { turnId: turn.id },
        transaction
      });

      // R-10 / AT-29: ALREADY_RESOLVED takes priority over STALE_STATE
      if (existingResult || turn.status === 'COMPLETED') {
        throw new GameError('ALREADY_RESOLVED', 'Hasil untuk giliran ini sudah dicatat.', 409);
      }

      if (turn.status === 'ANIMATING') {
        throw new GameError('TURN_NOT_READY', 'Gerakan bidak sedang berlangsung.', 409);
      }

      if (turn.status !== 'AWAITING_RESULT' || game.activeTurnId !== turn.id) {
        throw new GameError('TURN_NOT_READY', 'Giliran tidak sedang menunggu hasil.', 409);
      }

      if (safeInteger(game.stateVersion) !== input.expectedStateVersion) {
        throw new GameError('STALE_STATE', 'State game telah berubah. Muat ulang sebelum menyimpan hasil.', 409);
      }

      const team = await Team.findByPk(turn.teamId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!team) {
        throw new GameError('NOT_FOUND', 'Tim aktif tidak ditemukan.', 404);
      }

      const cell = await BoardCell.findOne({
        where: { gameId: game.id, number: turn.landingCell },
        transaction
      });

      let awardedPoints = 0;
      let manualPoints = null;
      let outcome = null;

      if (input.scoringMethod === 'BUTTON') {
        outcome = input.outcome;
        if (input.outcome === 'SUCCESS') {
          awardedPoints = cell ? cell.successPoints : 0;
        } else {
          awardedPoints = 0;
        }
      } else if (input.scoringMethod === 'MANUAL') {
        awardedPoints = input.points;
        manualPoints = input.points;
      }

      const now = await databaseNow(sequelize, transaction);

      const challengeResult = await ChallengeResult.create({
        id: randomUUID(),
        gameId: game.id,
        turnId: turn.id,
        boardCellId: cell ? cell.id : null,
        teamId: team.id,
        scoringMethod: input.scoringMethod,
        outcome,
        manualPoints,
        awardedPoints,
        note: input.note || null,
        actorUserId
      }, { transaction });

      const oldScore = safeInteger(team.totalScore);
      if (awardedPoints > 0) {
        await ScoreLedger.create({
          id: randomUUID(),
          gameId: game.id,
          teamId: team.id,
          turnId: turn.id,
          challengeResultId: challengeResult.id,
          deltaPoints: awardedPoints,
          source: input.scoringMethod === 'BUTTON' ? 'CHALLENGE_BUTTON' : 'CHALLENGE_MANUAL',
          reason: input.note || (input.scoringMethod === 'BUTTON'
            ? `Button ${outcome} on cell ${turn.landingCell}`
            : `Manual points on cell ${turn.landingCell}`),
          actorUserId,
          compensatesEntryId: null
        }, { transaction });

        team.totalScore = oldScore + awardedPoints;
        await team.save({ transaction });
      }

      turn.status = 'COMPLETED';
      turn.resolvedAt = now;
      await turn.save({ transaction });

      const allTeams = await Team.findAll({
        where: { gameId: game.id },
        order: [['sortOrder', 'ASC']],
        transaction
      });
      const currentIndex = allTeams.findIndex((t) => t.id === team.id);
      const nextTeam = allTeams[(currentIndex + 1) % allTeams.length];

      game.activeTurnId = null;
      game.currentTeamId = nextTeam ? nextTeam.id : team.id;
      game.stateVersion = safeInteger(safeInteger(game.stateVersion) + 1);
      game.eventSequence = safeInteger(safeInteger(game.eventSequence) + 1);
      await game.save({ transaction });

      const updatedTeams = allTeams.map((t) => (t.id === team.id ? team : t));
      const leaderboard = calculateLeaderboard(updatedTeams);

      const resolvedPayload = {
        turnId: turn.id,
        teamId: team.id,
        scoringMethod: input.scoringMethod,
        outcome,
        awardedPoints,
        newTotalScore: safeInteger(team.totalScore)
      };

      const resolvedEvent = await GameEvent.create({
        id: randomUUID(),
        gameId: game.id,
        sequence: game.eventSequence,
        stateVersion: game.stateVersion,
        type: 'game:challenge_resolved',
        payloadJson: resolvedPayload,
        actorType: 'USER',
        actorUserId,
        requestId,
        occurredAt: now
      }, { transaction });

      await OutboxEvent.create({
        id: randomUUID(),
        gameId: game.id,
        gameEventId: resolvedEvent.id,
        nextAttemptAt: now
      }, { transaction });

      game.eventSequence = safeInteger(safeInteger(game.eventSequence) + 1);
      await game.save({ transaction });

      const leaderboardEvent = await GameEvent.create({
        id: randomUUID(),
        gameId: game.id,
        sequence: game.eventSequence,
        stateVersion: game.stateVersion,
        type: 'game:leaderboard_updated',
        payloadJson: {
          teams: leaderboard,
          version: safeInteger(game.stateVersion)
        },
        actorType: 'USER',
        actorUserId,
        requestId,
        occurredAt: now
      }, { transaction });

      await OutboxEvent.create({
        id: randomUUID(),
        gameId: game.id,
        gameEventId: leaderboardEvent.id,
        nextAttemptAt: now
      }, { transaction });

      game.eventSequence = safeInteger(safeInteger(game.eventSequence) + 1);
      await game.save({ transaction });

      const stateEvent = await GameEvent.create({
        id: randomUUID(),
        gameId: game.id,
        sequence: game.eventSequence,
        stateVersion: game.stateVersion,
        type: 'game:state_changed',
        payloadJson: {
          status: game.status,
          currentTeamId: game.currentTeamId,
          activeTurnId: null,
          turnNumber: safeInteger(game.turnNumber),
          turnStatus: 'READY_FOR_ROLL'
        },
        actorType: 'USER',
        actorUserId,
        requestId,
        occurredAt: now
      }, { transaction });

      await OutboxEvent.create({
        id: randomUUID(),
        gameId: game.id,
        gameEventId: stateEvent.id,
        nextAttemptAt: now
      }, { transaction });

      await AuditLog.create({
        id: randomUUID(),
        gameId: game.id,
        actorType: 'USER',
        actorUserId,
        requestId,
        action: 'CHALLENGE_RESOLVED',
        beforeJson: {
          turnId: turn.id,
          status: 'AWAITING_RESULT',
          totalScore: oldScore
        },
        afterJson: {
          turnId: turn.id,
          status: 'COMPLETED',
          scoringMethod: input.scoringMethod,
          outcome,
          manualPoints,
          awardedPoints,
          newTotalScore: safeInteger(team.totalScore),
          note: input.note || null
        },
        occurredAt: now
      }, { transaction });

      return {
        status: 200,
        body: {
          success: true,
          data: {
            turnId: turn.id,
            scoringMethod: input.scoringMethod,
            outcome,
            awardedPoints,
            newTotalScore: safeInteger(team.totalScore)
          },
          meta: {
            stateVersion: safeInteger(game.stateVersion),
            eventSequence: safeInteger(game.eventSequence),
            serverTime: now.toISOString(),
            requestId
          }
        }
      };
    }
  });
}

/**
 * Returns the current game leaderboard sorted with authoritative server-calculated rankings.
 *
 * @param {object} params Parameter payload.
 * @param {import('sequelize').Sequelize} params.sequelize Database connection.
 * @param {string} params.gameId Game identifier.
 * @param {string} [params.requestId] Request identifier.
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function getGameLeaderboard({ sequelize, gameId, requestId }) {
  const { Game, Team } = defineGameSetup(sequelize);
  const game = await Game.findByPk(gameId);
  if (!game) {
    throw new GameError('NOT_FOUND', 'Game tidak ditemukan.', 404);
  }
  const teams = await Team.findAll({
    where: { gameId: game.id },
    order: [['sortOrder', 'ASC']]
  });
  const leaderboard = calculateLeaderboard(teams);
  const now = await databaseNow(sequelize);
  return {
    status: 200,
    body: {
      success: true,
      data: {
        gameId: game.id,
        status: game.status,
        leaderboard
      },
      meta: {
        stateVersion: safeInteger(game.stateVersion),
        eventSequence: safeInteger(game.eventSequence),
        serverTime: now.toISOString(),
        requestId
      }
    }
  };
}

/**
 * Voids the latest eligible committed roll (R-05–R-07, R-12; SPEC §4.6).
 *
 * Invariants & Requirements:
 * - In-band settlement commits in its own transaction before command processing.
 * - Enforces game RUNNING or PAUSED status. Reject 409 if FINISHED or not ready.
 * - Rejects 409 TURN_NOT_READY if any movement is currently ANIMATING.
 * - Rejects 404 NOT_FOUND if turnId does not exist or belongs to another game.
 * - Rejects 409 TURN_NOT_READY if target turn is already VOIDED, currently ANIMATING, or not eligible.
 * - Optimistic concurrency: rejects 409 STALE_STATE if expectedStateVersion does not match game.stateVersion.
 * - Rejects 409 TURN_NOT_READY if any subsequent turn exists in the game (including VOIDED turns).
 * - Rejects 409 TURN_NOT_READY if any score correction already exists on this turn or on this team after the turn.
 * - Atomically:
 *   1. Restores team.position to targetTurn.fromPosition.
 *   2. If challengeResult.awardedPoints > 0, creates a single negative CORRECTION ledger entry with
 *      compensates_entry_id pointing to the original ledger, and decrements team.totalScore.
 *      If awardedPoints === 0 or no challengeResult, no zero-delta ledger is created.
 *   3. Marks targetTurn status = 'VOIDED' with voidedAt, voidedBy, and voidReason.
 *   4. Restores game.currentTeamId to targetTurn.teamId, sets game.activeTurnId = null,
 *      does NOT decrement game.turnNumber.
 *   5. Emits game:correction_applied (with correctionType = 'TURN_VOID'), game:leaderboard_updated,
 *      and game:state_changed (READY_FOR_ROLL) to game_events and outbox_events.
 *   6. Creates AuditLog action = 'TURN_VOIDED'.
 *   7. Returns data: { voidedTurnId, teamId, restoredPosition, compensatedPoints, newTotalScore }.
 */
export async function voidTurn({
  sequelize, gameId, turnId, actorUserId, idempotencyKey, requestId, input
}) {
  await settleExpiredMovementIfDue({ sequelize, gameId, requestId });

  const { Team, GameEvent, OutboxEvent } = defineGameSetup(sequelize);
  const Turn = defineTurn(sequelize);
  const { ChallengeResult, ScoreLedger } = defineScoring(sequelize);
  const { AuditLog } = defineAuthAudit(sequelize);

  return executeGameCommand({
    sequelize,
    gameId,
    actorUserId,
    idempotencyKey,
    requestId,
    commandType: 'VOID_TURN',
    method: 'POST',
    target: `/api/v1/games/${gameId}/turns/${turnId}/void`,
    input,
    mutate: async ({ game, transaction }) => {
      if (game.status === 'FINISHED') {
        throw new GameError('GAME_FINISHED', 'Game sudah selesai.', 409);
      }
      if (game.status !== 'RUNNING' && game.status !== 'PAUSED') {
        throw new GameError('GAME_NOT_READY', 'Game belum dimulai atau tidak aktif.', 409);
      }

      const activeAnimation = await Turn.findOne({
        where: {
          gameId: game.id,
          status: 'ANIMATING'
        },
        transaction
      });
      if (activeAnimation) {
        throw new GameError('TURN_NOT_READY', 'Gerakan bidak sedang berlangsung.', 409);
      }

      const targetTurn = await Turn.findByPk(turnId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!targetTurn || targetTurn.gameId !== game.id) {
        throw new GameError('NOT_FOUND', 'Giliran tidak ditemukan.', 404);
      }

      if (targetTurn.status === 'VOIDED') {
        throw new GameError('TURN_NOT_READY', 'Giliran sudah pernah dibatalkan (VOIDED).', 409);
      }

      if (targetTurn.status === 'ANIMATING') {
        throw new GameError('TURN_NOT_READY', 'Gerakan bidak sedang berlangsung.', 409);
      }

      if (targetTurn.status !== 'AWAITING_RESULT' && targetTurn.status !== 'COMPLETED') {
        throw new GameError('TURN_NOT_READY', 'Giliran tidak dapat dibatalkan.', 409);
      }

      if (safeInteger(game.stateVersion) !== input.expectedStateVersion) {
        throw new GameError('STALE_STATE', 'State game telah berubah. Muat ulang sebelum membatalkan roll.', 409);
      }

      const subsequentTurn = await Turn.findOne({
        where: {
          gameId: game.id,
          turnNumber: { [Op.gt]: targetTurn.turnNumber }
        },
        transaction
      });
      if (subsequentTurn) {
        throw new GameError('TURN_NOT_READY', 'Hanya roll terakhir yang dapat dibatalkan.', 409);
      }

      const existingCorrection = await ScoreLedger.findOne({
        where: {
          gameId: game.id,
          teamId: targetTurn.teamId,
          source: 'CORRECTION',
          [Op.or]: [
            { turnId: targetTurn.id },
            { createdAt: { [Op.gt]: targetTurn.createdAt } }
          ]
        },
        transaction
      });
      if (existingCorrection) {
        throw new GameError('TURN_NOT_READY', 'Giliran atau skor sudah memiliki riwayat koreksi.', 409);
      }

      const team = await Team.findByPk(targetTurn.teamId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!team) {
        throw new GameError('NOT_FOUND', 'Tim tidak ditemukan.', 404);
      }

      const now = await databaseNow(sequelize, transaction);
      const oldPosition = team.position;
      const oldScore = safeInteger(team.totalScore);
      const restoredPosition = targetTurn.fromPosition;

      team.position = restoredPosition;

      let compensatedPoints = 0;
      const challengeResult = await ChallengeResult.findOne({
        where: { turnId: targetTurn.id },
        transaction
      });

      if (challengeResult && challengeResult.awardedPoints > 0) {
        compensatedPoints = safeInteger(challengeResult.awardedPoints);
        const originalLedger = await ScoreLedger.findOne({
          where: {
            challengeResultId: challengeResult.id,
            teamId: team.id
          },
          transaction
        });

        await ScoreLedger.create({
          id: randomUUID(),
          gameId: game.id,
          teamId: team.id,
          turnId: targetTurn.id,
          challengeResultId: null,
          deltaPoints: -compensatedPoints,
          source: 'CORRECTION',
          reason: `Void turn #${targetTurn.turnNumber}: ${input.reason}`,
          actorUserId,
          compensatesEntryId: originalLedger ? originalLedger.id : null
        }, { transaction });

        team.totalScore = oldScore - compensatedPoints;
      }

      await team.save({ transaction });

      targetTurn.status = 'VOIDED';
      targetTurn.voidedAt = now;
      targetTurn.voidedBy = actorUserId;
      targetTurn.voidReason = input.reason;
      await targetTurn.save({ transaction });

      game.activeTurnId = null;
      game.currentTeamId = targetTurn.teamId;
      game.stateVersion = safeInteger(safeInteger(game.stateVersion) + 1);
      game.eventSequence = safeInteger(safeInteger(game.eventSequence) + 1);
      await game.save({ transaction });

      const allTeams = await Team.findAll({
        where: { gameId: game.id },
        order: [['sortOrder', 'ASC']],
        transaction
      });
      const updatedTeams = allTeams.map((t) => (t.id === team.id ? team : t));
      const leaderboard = calculateLeaderboard(updatedTeams);

      const correctionEvent = await GameEvent.create({
        id: randomUUID(),
        gameId: game.id,
        sequence: game.eventSequence,
        stateVersion: game.stateVersion,
        type: 'game:correction_applied',
        payloadJson: {
          correctionType: 'TURN_VOID',
          voidedTurnId: targetTurn.id,
          teamId: team.id,
          restoredPosition,
          compensatedPoints,
          newTotalScore: safeInteger(team.totalScore),
          reason: input.reason
        },
        actorType: 'USER',
        actorUserId,
        requestId,
        occurredAt: now
      }, { transaction });

      await OutboxEvent.create({
        id: randomUUID(),
        gameId: game.id,
        gameEventId: correctionEvent.id,
        nextAttemptAt: now
      }, { transaction });

      game.eventSequence = safeInteger(safeInteger(game.eventSequence) + 1);
      await game.save({ transaction });

      const leaderboardEvent = await GameEvent.create({
        id: randomUUID(),
        gameId: game.id,
        sequence: game.eventSequence,
        stateVersion: game.stateVersion,
        type: 'game:leaderboard_updated',
        payloadJson: {
          teams: leaderboard,
          version: safeInteger(game.stateVersion)
        },
        actorType: 'USER',
        actorUserId,
        requestId,
        occurredAt: now
      }, { transaction });

      await OutboxEvent.create({
        id: randomUUID(),
        gameId: game.id,
        gameEventId: leaderboardEvent.id,
        nextAttemptAt: now
      }, { transaction });

      game.eventSequence = safeInteger(safeInteger(game.eventSequence) + 1);
      await game.save({ transaction });

      const stateEvent = await GameEvent.create({
        id: randomUUID(),
        gameId: game.id,
        sequence: game.eventSequence,
        stateVersion: game.stateVersion,
        type: 'game:state_changed',
        payloadJson: {
          status: game.status,
          currentTeamId: game.currentTeamId,
          activeTurnId: null,
          turnNumber: safeInteger(game.turnNumber),
          turnStatus: 'READY_FOR_ROLL'
        },
        actorType: 'USER',
        actorUserId,
        requestId,
        occurredAt: now
      }, { transaction });

      await OutboxEvent.create({
        id: randomUUID(),
        gameId: game.id,
        gameEventId: stateEvent.id,
        nextAttemptAt: now
      }, { transaction });

      await AuditLog.create({
        id: randomUUID(),
        gameId: game.id,
        actorType: 'USER',
        actorUserId,
        requestId,
        action: 'TURN_VOIDED',
        beforeJson: {
          turnId: targetTurn.id,
          turnNumber: safeInteger(targetTurn.turnNumber),
          status: targetTurn.status,
          teamId: team.id,
          position: oldPosition,
          totalScore: oldScore
        },
        afterJson: {
          turnId: targetTurn.id,
          status: 'VOIDED',
          restoredPosition,
          compensatedPoints,
          newTotalScore: safeInteger(team.totalScore),
          reason: input.reason
        },
        occurredAt: now
      }, { transaction });

      return {
        status: 200,
        body: {
          success: true,
          data: {
            voidedTurnId: targetTurn.id,
            teamId: team.id,
            restoredPosition,
            compensatedPoints,
            newTotalScore: safeInteger(team.totalScore)
          },
          meta: {
            stateVersion: safeInteger(game.stateVersion),
            eventSequence: safeInteger(game.eventSequence),
            serverTime: now.toISOString(),
            requestId
          }
        }
      };
    }
  });
}


