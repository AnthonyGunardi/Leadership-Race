import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { QueryTypes, Transaction } from 'sequelize';
import { defineGameSetup } from '../models/gameSetup.js';
import { defineAuthAudit } from '../models/authAudit.js';
import { defineSingleGame } from '../models/singleGame.js';
import { logger } from '../config/logger.js';
import { sealCommandSecret, openCommandSecret } from './commandSecrets.js';

/** Domain errors keep transport details out of workflow control and internal data out of responses. */
export class GameError extends Error {
  constructor(code, message, status = 409) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** Preserves JSON array order while making object key order irrelevant to intent identity. */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

/** BIGINT conversion fails closed before a counter can lose precision in a client DTO. */
export function safeInteger(value) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new GameError('COUNTER_OVERFLOW', 'Nilai game melewati batas integer aman.', 500);
  }
  return result;
}

/** ORM cannot represent the database clock; use its UTC instant for committed state and response metadata. */
export async function databaseNow(sequelize, transaction) {
  const [row] = await sequelize.query('SELECT UTC_TIMESTAMP(3) AS now', { type: QueryTypes.SELECT, transaction });
  return new Date(row.now);
}

/** A key belongs to one actor/target/body intent and must never disclose another actor's receipt. */
function replay(receipt, actorUserId, requestHash) {
  if (receipt.actorUserId !== actorUserId || receipt.requestHash !== requestHash || receipt.status !== 'SUCCEEDED') {
    throw new GameError('DUPLICATE_ACTION', 'Idempotency-Key sudah digunakan untuk tindakan lain atau masih diproses.');
  }
  const body = receipt.responseJson;
  return { status: receipt.httpStatus, body: receipt.responseSecretCiphertext
    ? { ...body, data: { ...body.data, ...openCommandSecret(receipt) } } : body };
}

/**
 * Claims an intent atomically, commits its effects and receipt together, then returns only committed data.
 * A losing create rolls back its provisional game before reading the winning receipt in a new transaction.
 * Lock timeouts are bounded to two seconds per attempt; only deadlocks are retried, at most three attempts.
 */
export async function executeGameCommand({
  sequelize, gameId, actorUserId, idempotencyKey, requestId, commandType, method, target, input, create, mutate
}) {
  const { Game, CommandLog } = defineGameSetup(sequelize);
  const scopeKey = gameId ? `game:${gameId}` : `create-game:${actorUserId}`;
  const requestHash = createHash('sha256').update(JSON.stringify(canonical({ method, target, body: input }))).digest('hex');
  const where = { scopeKey, idempotencyKey };
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      logger.info('Game command transaction started', { commandType, gameId, requestId });
      const result = await sequelize.transaction({
        isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED
      }, async (transaction) => {
        // ORM has no session-setting API. Restore this connection's timeout before managed commit/rollback releases it.
        const [settings] = await sequelize.query('SELECT @@SESSION.innodb_lock_wait_timeout AS timeout', {
          type: QueryTypes.SELECT, transaction
        });
        await sequelize.query('SET SESSION innodb_lock_wait_timeout = 2', { transaction });
        try {
          let game;
          if (gameId) {
            game = await Game.findByPk(gameId, { transaction, lock: transaction.LOCK.UPDATE });
            if (!game) throw new GameError('NOT_FOUND', 'Game tidak ditemukan.', 404);
          }
          const existing = await CommandLog.findOne({ where, transaction });
          if (existing) return replay(existing, actorUserId, requestHash);
          if (gameId && await defineSingleGame(sequelize).GameArchive.findByPk(gameId, { transaction })) {
            throw new GameError('GAME_ARCHIVED', 'Sesi ini telah diarsipkan setelah reset dan hanya dapat dibaca.');
          }
          if (!gameId) game = await create(transaction);
          const receipt = await CommandLog.create({
            id: randomUUID(), gameId: game.id, scopeKey, idempotencyKey, actorUserId, commandType, requestHash
          }, { transaction });
          const response = await mutate({ game, transaction });
          await receipt.update({
            status: 'SUCCEEDED', httpStatus: response.status, responseJson: response.receiptBody ?? response.body,
            ...(response.secret ? sealCommandSecret(response.secret, receipt) : {})
          }, {
            transaction
          });
          return response;
        } finally {
          await sequelize.query('SET SESSION innodb_lock_wait_timeout = :timeout', {
            replacements: { timeout: Number(settings.timeout) }, transaction
          });
        }
      });
      logger.info('Game command transaction committed', { commandType, gameId, requestId });
      return result;
    } catch (error) {
      logger.error('Game command transaction failed', { commandType, gameId, requestId, name: error.name });
      if (error.name === 'SequelizeUniqueConstraintError') {
        const winner = await CommandLog.findOne({ where });
        if (winner) return replay(winner, actorUserId, requestHash);
      }
      const code = error.original?.code || error.code;
      if (code === 'ER_LOCK_DEADLOCK' && attempt < 3) {
        await delay(20 + Math.floor(Math.random() * 60));
        continue;
      }
      if (code === 'ER_LOCK_WAIT_TIMEOUT' || code === 'ER_LOCK_DEADLOCK') {
        throw new GameError('DUPLICATE_ACTION', 'Tindakan lain masih diproses. Coba ulang dengan key yang sama.');
      }
      throw error;
    }
  }
}

/** Writes one version plus audit/event/outbox atomically; G4 consumes the outbox after commit. */
export async function recordGameMutation({
  sequelize, transaction, game, actorUserId, requestId, action, before, after,
  eventType = 'game:state_changed', eventPayload
}) {
  const { GameEvent, OutboxEvent } = defineGameSetup(sequelize);
  const { AuditLog } = defineAuthAudit(sequelize);
  const now = await databaseNow(sequelize, transaction);
  game.stateVersion = safeInteger(safeInteger(game.stateVersion) + 1);
  game.eventSequence = safeInteger(safeInteger(game.eventSequence) + 1);
  await game.save({ transaction });
  const event = await GameEvent.create({
    id: randomUUID(), gameId: game.id, sequence: game.eventSequence, stateVersion: game.stateVersion,
    type: eventType, payloadJson: eventPayload ?? {
      status: game.status, currentTeamId: game.currentTeamId, activeTurnId: game.activeTurnId,
      turnNumber: safeInteger(game.turnNumber), turnStatus: 'READY_FOR_ROLL'
    }, actorType: 'USER', actorUserId, requestId, occurredAt: now
  }, { transaction });
  await OutboxEvent.create({
    id: randomUUID(), gameId: game.id, gameEventId: event.id, nextAttemptAt: now
  }, { transaction });
  await AuditLog.create({
    id: randomUUID(), gameId: game.id, actorType: 'USER', actorUserId, requestId,
    action, beforeJson: before, afterJson: after, occurredAt: now
  }, { transaction });
}
