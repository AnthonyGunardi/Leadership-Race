import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Transaction, Op } from 'sequelize';
import { defineGameSetup } from '../models/gameSetup.js';
import { defineTurn } from '../models/turn.js';
import { defineAuthAudit } from '../models/authAudit.js';
import { databaseNow, safeInteger } from './gameCommands.js';
import { logger } from '../config/logger.js';

/**
 * Executes movement settlement in an independent system transaction.
 *
 * Invariants:
 * - Lock hierarchy: game -> turn -> team.
 * - Settlement deadline evaluated strictly via database UTC time (databaseNow).
 * - Target VOIDED, non-animating, or not due is a safe no-op.
 * - Non-indisipliner turns transition to AWAITING_RESULT and publish challenge_pending.
 * - Indisipliner penalty turns complete automatically, clearing activeTurnId and advancing currentTeamId round-robin.
 * - Committed independently before any caller command gate; failures/stale versions do not roll it back.
 *
 * @param {object} params Settlement parameters.
 * @param {import('sequelize').Sequelize} params.sequelize Database connection.
 * @param {string} params.gameId Game identifier.
 * @param {string} [params.requestId] Request tracing identifier.
 * @returns {Promise<{ settled: boolean, turnId?: string, status?: string, reason?: string }>}
 */
export async function settleExpiredMovementIfDue({ sequelize, gameId, requestId }) {
  const { Game, Team, BoardCell, GameEvent, OutboxEvent } = defineGameSetup(sequelize);
  const Turn = defineTurn(sequelize);
  const { AuditLog } = defineAuthAudit(sequelize);

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const result = await sequelize.transaction({
        isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED
      }, async (transaction) => {
        const game = await Game.findByPk(gameId, { transaction, lock: transaction.LOCK.UPDATE });
        if (!game) {
          return { settled: false, reason: 'NO_GAME' };
        }

        const now = await databaseNow(sequelize, transaction);

        const anyAnimatingTurn = await Turn.findOne({
          where: { gameId: game.id, status: 'ANIMATING' },
          transaction
        });
        if (!anyAnimatingTurn) {
          return { settled: false, reason: 'NOT_ANIMATING' };
        }

        const turn = await Turn.findOne({
          where: {
            gameId: game.id,
            status: 'ANIMATING',
            movementEndsAt: { [Op.lte]: now }
          },
          order: [['movementEndsAt', 'ASC']],
          transaction,
          lock: transaction.LOCK.UPDATE
        });
        if (!turn) {
          return { settled: false, reason: 'NOT_DUE' };
        }

        await Team.findByPk(turn.teamId, { transaction, lock: transaction.LOCK.UPDATE });

        if (turn.requiresChallenge) {
          turn.status = 'AWAITING_RESULT';
          await turn.save({ transaction });

          game.stateVersion = safeInteger(safeInteger(game.stateVersion) + 1);
          game.eventSequence = safeInteger(safeInteger(game.eventSequence) + 1);
          await game.save({ transaction });

          const cell = await BoardCell.findOne({ where: { gameId: game.id, number: turn.landingCell }, transaction });
          const pendingResult = {
            turnId: turn.id,
            teamId: turn.teamId,
            cellNumber: cell ? cell.number : turn.landingCell,
            category: cell ? cell.category : 'ACTION',
            title: cell ? cell.title : '',
            successPoints: cell ? cell.successPoints : 0,
            allowedMethods: ['BUTTON', 'MANUAL'],
            defaultMethod: cell ? cell.defaultScoringMethod : 'BUTTON',
            pointsPerUnit: cell ? cell.pointsPerUnit : null,
            ...(cell?.instruction ? { instruction: cell.instruction } : {}),
            ...(cell?.backupText ? { backupText: cell.backupText } : {}),
            ...(cell?.durationText ? { durationText: cell.durationText } : {})
          };

          const challengeEvent = await GameEvent.create({
            id: randomUUID(),
            gameId: game.id,
            sequence: game.eventSequence,
            stateVersion: game.stateVersion,
            type: 'game:challenge_pending',
            payloadJson: pendingResult,
            actorType: 'SYSTEM',
            actorUserId: null,
            requestId,
            occurredAt: now
          }, { transaction });

          await OutboxEvent.create({
            id: randomUUID(),
            gameId: game.id,
            gameEventId: challengeEvent.id,
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
              turnStatus: 'AWAITING_RESULT'
            },
            actorType: 'SYSTEM',
            actorUserId: null,
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
            actorType: 'SYSTEM',
            actorUserId: null,
            requestId,
            action: 'MOVEMENT_SETTLED_AWAITING_RESULT',
            beforeJson: { turnId: turn.id, status: 'ANIMATING' },
            afterJson: { turnId: turn.id, status: 'AWAITING_RESULT' },
            occurredAt: now
          }, { transaction });

          logger.info('Movement settled to AWAITING_RESULT', { gameId, turnId: turn.id });
          return { settled: true, turnId: turn.id, status: 'AWAITING_RESULT' };
        }

        // Indisipliner penalty turn: complete automatically and advance to next team round-robin
        turn.status = 'COMPLETED';
        turn.resolvedAt = now;
        await turn.save({ transaction });

        const allTeams = await Team.findAll({
          where: { gameId: game.id },
          order: [['sortOrder', 'ASC']],
          transaction
        });
        const currentIndex = allTeams.findIndex((t) => t.id === turn.teamId);
        const nextTeam = allTeams[(currentIndex + 1) % allTeams.length];

        if (game.activeTurnId === turn.id) {
          const nextActive = await Turn.findOne({
            where: {
              gameId: game.id,
              id: { [Op.ne]: turn.id },
              status: { [Op.in]: ['ANIMATING', 'AWAITING_RESULT'] }
            },
            order: [['turnNumber', 'DESC']],
            transaction
          });
          game.activeTurnId = nextActive ? nextActive.id : null;
        }
        game.currentTeamId = nextTeam ? nextTeam.id : turn.teamId;
        game.stateVersion = safeInteger(safeInteger(game.stateVersion) + 1);
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
          actorType: 'SYSTEM',
          actorUserId: null,
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
          actorType: 'SYSTEM',
          actorUserId: null,
          requestId,
          action: 'PENALTY_RESOLVED_COMPLETED',
          beforeJson: { turnId: turn.id, status: 'ANIMATING', currentTeamId: turn.teamId },
          afterJson: { turnId: turn.id, status: 'COMPLETED', currentTeamId: game.currentTeamId },
          occurredAt: now
        }, { transaction });

        logger.info('Penalty movement settled to COMPLETED', {
          gameId,
          turnId: turn.id,
          nextTeamId: game.currentTeamId
        });
        return { settled: true, turnId: turn.id, status: 'COMPLETED' };
      });

      return result;
    } catch (error) {
      const code = error.original?.code || error.code;
      if (code === 'ER_LOCK_DEADLOCK' && attempt < 3) {
        await delay(20 + Math.floor(Math.random() * 60));
        continue;
      }
      logger.error('Movement settlement transaction failed', { gameId, error: error.message });
      throw error;
    }
  }
}

