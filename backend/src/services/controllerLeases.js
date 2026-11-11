import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { defineControllerLease } from '../models/controllerLease.js';
import { databaseNow, executeGameCommand, GameError, recordGameMutation, safeInteger } from './gameCommands.js';
import { settleExpiredMovementIfDue } from './turnSettlement.js';

const leaseDurationMs = 30000;

/** Only hashes reach the lease table; token plaintext is limited to the authorized response and encrypted receipt. */
function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

/** Database time determines expiry; expired rows remain available for audit without granting rights. */
function leaseDto(lease, now) {
  const active = lease && lease.expiresAt > now;
  return { holderUserId: active ? lease.holderUserId : null, expiresAt: active ? lease.expiresAt.toISOString() : null,
    version: lease ? safeInteger(lease.version) : 0 };
}

/**
 * Movement commands must first hold the game lock, then check actor + token + expiry in that same transaction.
 * Scoring must not call this guard: a movement lease does not grant or restrict other admins' scoring rights.
 */
export async function assertControllerLease({ sequelize, transaction, gameId, actorUserId, controllerLeaseToken }) {
  const Lease = defineControllerLease(sequelize);
  const lease = await Lease.findByPk(gameId, { transaction, lock: transaction.LOCK.UPDATE });
  const now = await databaseNow(sequelize, transaction);
  if (!lease || lease.holderUserId !== actorUserId || lease.expiresAt <= now
    || typeof controllerLeaseToken !== 'string' || !/^[a-f0-9]{64}$/.test(controllerLeaseToken)
    || !timingSafeEqual(Buffer.from(lease.leaseTokenHash, 'hex'), Buffer.from(tokenHash(controllerLeaseToken), 'hex'))) {
    throw new GameError('CONTROLLER_NOT_HELD', 'Lease controller tidak sah atau sudah berakhir. Muat ulang status.');
  }
  return { lease, now };
}

/** All lease operations serialize on the game, including initial acquire and forced takeover. */
async function changeController(parameters, operation) {
  const { sequelize, gameId, actorUserId, requestId, input } = parameters;
  await settleExpiredMovementIfDue({ sequelize, gameId, requestId });
  const Lease = defineControllerLease(sequelize);
  return executeGameCommand({ ...parameters, commandType: `CONTROLLER_${operation.toUpperCase().replace('-', '_')}`,
    method: 'POST', target: `/api/v1/games/${gameId}/controller/${operation}`,
    mutate: async ({ game, transaction }) => {
      if (!['RUNNING', 'PAUSED'].includes(game.status)) {
        throw new GameError('GAME_NOT_READY', 'Controller hanya tersedia pada game RUNNING atau PAUSED.');
      }
      if (operation !== 'heartbeat' && safeInteger(game.stateVersion) !== input.expectedStateVersion) {
        throw new GameError('STALE_STATE', 'State game telah berubah. Muat ulang sebelum mengambil controller.');
      }
      if (operation === 'take-over' && input.confirmed !== true) {
        throw new GameError('VALIDATION_ERROR', 'Take Over memerlukan konfirmasi eksplisit.', 400);
      }
      let lease;
      let now;
      if (operation === 'heartbeat') {
        ({ lease, now } = await assertControllerLease({ ...parameters, transaction, ...input }));
      } else {
        lease = await Lease.findByPk(gameId, { transaction, lock: transaction.LOCK.UPDATE });
        now = await databaseNow(sequelize, transaction);
      }
      const before = leaseDto(lease, now);
      if (operation === 'acquire' && before.holderUserId) {
        throw new GameError('CONTROLLER_NOT_HELD', 'Controller sedang dipegang admin lain. Gunakan Take Over.');
      }
      const controllerLeaseToken = operation === 'heartbeat' ? null : randomBytes(32).toString('hex');
      const values = { holderUserId: actorUserId, expiresAt: new Date(now.getTime() + leaseDurationMs),
        version: safeInteger(before.version + 1),
        ...(controllerLeaseToken ? { leaseTokenHash: tokenHash(controllerLeaseToken) } : {}) };
      if (lease) await lease.update(values, { transaction });
      else lease = await Lease.create({ gameId, ...values }, { transaction });
      const controller = leaseDto(lease, now);
      await recordGameMutation({ sequelize, transaction, game, actorUserId, requestId,
        action: operation === 'take-over' ? 'CONTROLLER_TAKEN_OVER' : `CONTROLLER_${operation.toUpperCase()}`,
        before, after: controller, eventType: 'game:controller_changed', eventPayload: controller });
      const receiptBody = { success: true, data: { controller }, meta: {
        stateVersion: safeInteger(game.stateVersion), eventSequence: safeInteger(game.eventSequence),
        serverTime: now.toISOString(), requestId
      } };
      return { status: 200, receiptBody,
        body: { ...receiptBody, data: { controller, ...(controllerLeaseToken ? { controllerLeaseToken } : {}) } },
        ...(controllerLeaseToken ? { secret: { controllerLeaseToken } } : {}) };
    } });
}

/** Acquisition cannot replace any unexpired lease, including another browser owned by the same admin. */
export function acquireController(parameters) {
  return changeController(parameters, 'acquire');
}

/** A heartbeat is idempotent per intent; replay returns the original deadline without extending it again. */
export function heartbeatController(parameters) {
  return changeController(parameters, 'heartbeat');
}

/** Explicit takeover rotates the token atomically and preserves the displaced holder in audit history. */
export function takeOverController(parameters) {
  return changeController(parameters, 'take-over');
}
