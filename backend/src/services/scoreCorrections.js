import { randomUUID } from 'node:crypto';
import { defineGameSetup } from '../models/gameSetup.js';
import { defineTurn } from '../models/turn.js';
import { defineAuthAudit } from '../models/authAudit.js';
import { defineScoring } from '../models/scoring.js';
import { calculateLeaderboard } from '../domain/scoring.js';
import { databaseNow, executeGameCommand, GameError, safeInteger } from './gameCommands.js';
import { settleExpiredMovementIfDue } from './turnSettlement.js';

/**
 * Applies an authoritative score correction to a team with compensatory ledger, audit log, and outbox notification.
 *
 * Requirements:
 * - Settles any overdue turn movement before checking eligibility.
 * - Game must be in RUNNING or PAUSED state (FINISHED rejects 409 GAME_FINISHED,
 *   DRAFT/READY rejects 409 GAME_NOT_READY).
 * - No active animation in progress (ANIMATING rejects 409 TURN_NOT_READY).
 * - Enforces optimistic concurrency via expectedStateVersion (STALE_STATE).
 * - Team total score cannot become negative (SCORE_BELOW_ZERO).
 * - CompensatesEntryId must reference an existing ScoreLedger entry belonging to the same game and team.
 * - TurnId must reference an existing Turn belonging to the same game.
 * - Writes immutable ScoreLedger row with source='CORRECTION' and updates team totalScore atomically.
 * - Outbox emits game:correction_applied and game:leaderboard_updated.
 *
 * @param {object} params Execution parameters.
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function applyScoreCorrection(params) {
  const { sequelize, gameId, actorUserId, idempotencyKey, requestId, input, movementWorker } = params;

  await settleExpiredMovementIfDue({ sequelize, gameId, requestId, movementWorker });

  const { Team, GameEvent, OutboxEvent } = defineGameSetup(sequelize);
  const Turn = defineTurn(sequelize);
  const { ScoreLedger } = defineScoring(sequelize);
  const { AuditLog } = defineAuthAudit(sequelize);

  return executeGameCommand({
    sequelize,
    gameId,
    actorUserId,
    idempotencyKey,
    requestId,
    commandType: 'SCORE_CORRECTION',
    method: 'POST',
    target: `/api/v1/games/${gameId}/corrections`,
    input,
    mutate: async ({ game, transaction }) => {
      if (game.status === 'FINISHED') {
        throw new GameError('GAME_FINISHED', 'Game sudah selesai. Skor final tidak dapat dikoreksi.', 409);
      }
      if (game.status !== 'RUNNING' && game.status !== 'PAUSED') {
        throw new GameError('GAME_NOT_READY', 'Game belum dimulai atau tidak aktif.', 409);
      }

      const activeAnimation = await Turn.findOne({
        where: { gameId: game.id, status: 'ANIMATING' },
        transaction
      });
      if (activeAnimation) {
        throw new GameError('TURN_NOT_READY', 'Gerakan bidak sedang berlangsung.', 409);
      }

      if (safeInteger(game.stateVersion) !== input.expectedStateVersion) {
        throw new GameError('STALE_STATE', 'State game telah berubah. Muat ulang sebelum melakukan koreksi skor.', 409);
      }

      const team = await Team.findByPk(input.teamId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!team || team.gameId !== game.id) {
        throw new GameError('NOT_FOUND', 'Tim tidak ditemukan dalam game ini.', 404);
      }

      let originalLedger = null;
      if (input.compensatesEntryId) {
        originalLedger = await ScoreLedger.findByPk(input.compensatesEntryId, { transaction });
        if (!originalLedger || originalLedger.gameId !== game.id || originalLedger.teamId !== team.id) {
          throw new GameError('NOT_FOUND', 'Entry ledger yang dikompensasi tidak ditemukan.', 404);
        }
      }

      let referencedTurn = null;
      if (input.turnId) {
        referencedTurn = await Turn.findByPk(input.turnId, { transaction });
        if (!referencedTurn || referencedTurn.gameId !== game.id) {
          throw new GameError('NOT_FOUND', 'Giliran yang dirujuk tidak ditemukan.', 404);
        }
      }

      const oldScore = safeInteger(team.totalScore);
      const newScore = oldScore + input.deltaPoints;
      if (newScore < 0) {
        throw new GameError('SCORE_BELOW_ZERO', 'Total skor tim tidak boleh bernilai negatif.', 400);
      }

      const now = await databaseNow(sequelize, transaction);

      const ledgerEntry = await ScoreLedger.create({
        id: randomUUID(),
        gameId: game.id,
        teamId: team.id,
        turnId: referencedTurn ? referencedTurn.id : (originalLedger?.turnId || null),
        challengeResultId: null,
        deltaPoints: input.deltaPoints,
        source: 'CORRECTION',
        reason: input.reason,
        actorUserId,
        compensatesEntryId: originalLedger ? originalLedger.id : null
      }, { transaction });

      team.totalScore = newScore;
      await team.save({ transaction });

      const nextVersion = safeInteger(game.stateVersion) + 1;
      const nextSequence = safeInteger(game.eventSequence) + 1;
      game.stateVersion = nextVersion;
      game.eventSequence = nextSequence;
      await game.save({ transaction });

      const allTeams = await Team.findAll({ where: { gameId: game.id }, transaction });
      const updatedTeams = allTeams.map((t) => (t.id === team.id ? team : t));
      const leaderboard = calculateLeaderboard(updatedTeams);

      await AuditLog.create({
        id: randomUUID(),
        gameId: game.id,
        actorType: 'USER',
        actorUserId,
        action: 'SCORE_CORRECTION',
        beforeJson: {
          teamId: team.id,
          teamName: team.name,
          totalScore: oldScore,
          position: team.position
        },
        afterJson: {
          teamId: team.id,
          teamName: team.name,
          totalScore: newScore,
          deltaPoints: input.deltaPoints,
          reason: input.reason,
          correctionId: ledgerEntry.id,
          compensatesEntryId: originalLedger?.id || null,
          turnId: referencedTurn?.id || null
        },
        reason: input.reason,
        requestId,
        occurredAt: now
      }, { transaction });

      const correctionEvent = await GameEvent.create({
        id: randomUUID(),
        gameId: game.id,
        sequence: nextSequence,
        stateVersion: nextVersion,
        type: 'game:correction_applied',
        payloadJson: {
          correctionType: 'SCORE_CORRECTION',
          affectedTeamId: team.id,
          deltaPoints: input.deltaPoints,
          newTotalScore: newScore,
          reason: input.reason,
          turnId: referencedTurn?.id || null,
          compensatesEntryId: originalLedger?.id || null,
          newStateVersion: nextVersion
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

      const leaderboardSequence = nextSequence + 1;
      game.eventSequence = leaderboardSequence;
      await game.save({ transaction });

      const leaderboardEvent = await GameEvent.create({
        id: randomUUID(),
        gameId: game.id,
        sequence: leaderboardSequence,
        stateVersion: nextVersion,
        type: 'game:leaderboard_updated',
        payloadJson: {
          teams: leaderboard,
          version: nextVersion
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

      return {
        status: 200,
        body: {
          success: true,
          data: {
            correctionId: ledgerEntry.id,
            teamId: team.id,
            deltaPoints: input.deltaPoints,
            newTotalScore: newScore,
            reason: input.reason
          },
          meta: {
            stateVersion: nextVersion,
            eventSequence: leaderboardSequence
          }
        }
      };
    }
  });
}
