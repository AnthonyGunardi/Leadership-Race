import { Op, Transaction } from 'sequelize';
import { defineGameSetup } from '../models/gameSetup.js';
import { databaseNow, GameError, safeInteger } from './gameCommands.js';

/** Public envelopes exclude actor/request metadata and any credential-bearing internal security state. */
export function eventDto(event) {
  return { eventId: event.id, gameId: event.gameId, sequence: safeInteger(event.sequence),
    stateVersion: safeInteger(event.stateVersion), occurredAt: event.occurredAt.toISOString(),
    type: event.type, payload: event.payloadJson };
}

/** A consistent high-water and contiguous cursor expose retention/hole recovery without silent event loss. */
export async function getGameEvents({ sequelize, gameId, query, requestId }) {
  const { Game, GameEvent } = defineGameSetup(sequelize);
  return sequelize.transaction({
    isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ
  }, async (transaction) => {
    const game = await Game.findByPk(gameId, { transaction });
    if (!game) throw new GameError('NOT_FOUND', 'Game tidak ditemukan.', 404);
    const latestSequence = safeInteger(game.eventSequence);
    const floor = safeInteger(game.eventRetentionFloor);
    if (query.afterSequence < floor) {
      throw new GameError('EVENT_HISTORY_UNAVAILABLE', 'Histori tidak lengkap. Muat ulang snapshot.');
    }
    if (query.afterSequence > latestSequence) throw new GameError('STALE_STATE', 'Muat ulang snapshot game.');
    const rows = await GameEvent.findAll({ where: { gameId,
      sequence: { [Op.gt]: query.afterSequence, [Op.lte]: latestSequence } },
    order: [['sequence', 'ASC']], limit: query.limit, transaction });
    if ((rows.length === 0 && query.afterSequence < latestSequence)
      || rows.some((row, index) => safeInteger(row.sequence) !== query.afterSequence + index + 1)
      || (rows.length < query.limit && query.afterSequence + rows.length < latestSequence)) {
      throw new GameError('EVENT_HISTORY_UNAVAILABLE', 'Histori tidak lengkap. Muat ulang snapshot.');
    }
    const nextAfterSequence = query.afterSequence + rows.length;
    return { success: true, data: { events: rows.map(eventDto) }, meta: {
      afterSequence: query.afterSequence, nextAfterSequence, hasMore: nextAfterSequence < latestSequence,
      earliestAvailableSequence: floor + 1, latestSequence, stateVersion: safeInteger(game.stateVersion),
      eventSequence: latestSequence, serverTime: (await databaseNow(sequelize, transaction)).toISOString(), requestId
    } };
  });
}
