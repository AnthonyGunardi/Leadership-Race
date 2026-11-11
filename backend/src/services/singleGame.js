import { randomUUID } from 'node:crypto';
import { Op, Transaction } from 'sequelize';
import { defineSingleGame } from '../models/singleGame.js';
import { defineGameSetup } from '../models/gameSetup.js';
import { defineTurn } from '../models/turn.js';
import { getPrdBoardTemplate } from '../data/boardTemplate.js';
import { envelope } from './gameSetup.js';
import { getGameEvents } from './gameEvents.js';
import { databaseNow, executeGameCommand, GameError, recordGameMutation, safeInteger } from './gameCommands.js';

/** Anonymous viewers can only subscribe to the operational game, never to archived or unrelated game IDs. */
export async function assertPublicGame({ sequelize, gameId, transaction }) {
  const current = await defineSingleGame(sequelize).SingleGame.findByPk(1, { transaction });
  if (!current?.gameId || current.gameId !== gameId) {
    throw new GameError('NOT_FOUND', 'Game publik tidak tersedia.', 404);
  }
}

/** Reading the pointer and board in one snapshot avoids combining two different reset sessions. */
export async function getPublicGame({ sequelize, gameId }) {
  const { Game } = defineGameSetup(sequelize);
  return sequelize.transaction({
    isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ
  }, async (transaction) => {
    const current = await defineSingleGame(sequelize).SingleGame.findByPk(1, { transaction });
    if (gameId) await assertPublicGame({ sequelize, gameId, transaction });
    if (!current?.gameId) {
      return { success: true, data: {
        game: { id: null, name: 'F1 Leadership Race', status: 'DRAFT', currentTeamId: null,
          activeTurnId: null, turnNumber: 0, boardSource: 'PRD_APPENDIX_A' },
        teams: [], boardCells: getPrdBoardTemplate().boardCells, leaderboard: [],
        activeMovement: null, turnStatus: 'READY_FOR_ROLL'
      }, meta: { stateVersion: 0, eventSequence: 0,
        serverTime: (await databaseNow(sequelize, transaction)).toISOString() } };
    }
    const game = await Game.findByPk(current.gameId, { transaction });
    if (!game) throw new GameError('NOT_FOUND', 'Game tidak ditemukan.', 404);
    return envelope(sequelize, transaction, game, undefined, { publicOnly: true });
  });
}

/** Concurrent initializations lock the one durable slot and therefore return the same operational game. */
export async function ensureCurrentGame(parameters) {
  const { sequelize, actorUserId, requestId, input } = parameters;
  const { Game, BoardCell } = defineGameSetup(sequelize);
  const { SingleGame } = defineSingleGame(sequelize);
  let created = false;
  return executeGameCommand({ ...parameters, commandType: 'ENSURE_CURRENT_GAME', method: 'POST',
    target: '/api/v1/games/current', create: async (transaction) => {
      created = false;
      const current = await SingleGame.findByPk(1, { transaction, lock: transaction.LOCK.UPDATE });
      if (current.gameId) return Game.findByPk(current.gameId, { transaction, lock: transaction.LOCK.UPDATE });
      const game = await Game.create({ id: randomUUID(), name: input.name, boardSource: 'PRD_APPENDIX_A' }, { transaction });
      await BoardCell.bulkCreate(getPrdBoardTemplate().boardCells.map((cell) => ({
        ...cell, id: randomUUID(), gameId: game.id
      })), { transaction });
      await current.update({ gameId: game.id }, { transaction });
      created = true;
      return game;
    }, mutate: async ({ game, transaction }) => {
      if (created) await recordGameMutation({ sequelize, transaction, game, actorUserId, requestId,
        action: 'GAME_CREATED', before: null, after: { name: game.name, singleGame: true } });
      return { status: 200, body: await envelope(sequelize, transaction, game, requestId) };
    }
  });
}

/** Public replay preserves contiguous sequencing but carries only invalidations, with no admin/security payloads. */
export async function getPublicGameEvents(parameters) {
  await assertPublicGame(parameters);
  const result = await getGameEvents(parameters);
  return { ...result, data: { events: result.data.events.map((event) => ({ ...event, payload: {} })) } };
}

/** A reset archives the original ledger/turns and atomically switches to a fresh configuration copy. */
export async function resetCurrentGame(parameters) {
  const { sequelize, actorUserId, requestId, input, gameId } = parameters;
  const { Game, Team, BoardCell } = defineGameSetup(sequelize);
  const { SingleGame, GameArchive } = defineSingleGame(sequelize);
  return executeGameCommand({ ...parameters, commandType: 'RESET_GAME', method: 'POST',
    target: `/api/v1/games/${gameId}/reset`, mutate: async ({ game, transaction }) => {
      const current = await SingleGame.findByPk(1, { transaction, lock: transaction.LOCK.UPDATE });
      if (current.gameId !== game.id) throw new GameError('GAME_ARCHIVED', 'Hanya game operasional yang dapat direset.');
      if (safeInteger(game.stateVersion) !== input.expectedStateVersion) {
        throw new GameError('STALE_STATE', 'Game telah berubah. Muat ulang sebelum reset.');
      }
      const turn = game.activeTurnId && await defineTurn(sequelize).findByPk(game.activeTurnId, { transaction });
      if (turn?.status === 'ANIMATING') {
        throw new GameError('TURN_NOT_READY', 'Tunggu animasi bidak selesai sebelum reset.');
      }
      const before = await envelope(sequelize, transaction, game, requestId);
      const next = await Game.create({
        id: randomUUID(), name: game.name, boardSource: game.boardSource
      }, { transaction });
      if (before.data.teams.length) await Team.bulkCreate(before.data.teams.map(({ name, color, sortOrder }) => ({
        id: randomUUID(), gameId: next.id, name, color, sortOrder
      })), { transaction });
      if (before.data.boardCells.length) {
        await BoardCell.bulkCreate(before.data.boardCells.map(({ id: _id, ...cell }) => ({
          ...cell, id: randomUUID(), gameId: next.id
        })), { transaction });
      }
      await GameArchive.create({ gameId, nextGameId: next.id, archivedBy: actorUserId,
        archivedAt: await databaseNow(sequelize, transaction) }, { transaction });
      await current.update({ gameId: next.id }, { transaction });
      await recordGameMutation({ sequelize, transaction, game, actorUserId, requestId,
        action: 'GAME_RESET_ARCHIVED', before: before.data,
        after: { nextGameId: next.id }, eventPayload: { reset: true } });
      await recordGameMutation({ sequelize, transaction, game: next, actorUserId, requestId,
        action: 'GAME_RESET_CREATED', before: null, after: { previousGameId: gameId } });
      return { status: 200, body: await envelope(sequelize, transaction, next, requestId) };
    }
  });
}

/** Archive pagination exposes session metadata only; existing admin history/CSV routes retain their records. */
export async function listGameArchives({ sequelize, query }) {
  const { Game } = defineGameSetup(sequelize);
  const { count, rows } = await defineSingleGame(sequelize).GameArchive.findAndCountAll({
    limit: query.limit, offset: (query.page - 1) * query.limit,
    order: [['archivedAt', 'DESC'], ['gameId', 'ASC']]
  });
  const records = await Game.findAll({ where: { id: { [Op.in]: rows.map((row) => row.gameId) } } });
  const byId = new Map(records.map((game) => [game.id, game]));
  const games = rows.map((archive) => {
    const game = byId.get(archive.gameId);
    return { id: game.id, name: game.name, status: game.status, archivedAt: archive.archivedAt.toISOString() };
  });
  return { success: true, data: { games }, meta: { total: count, page: query.page, limit: query.limit } };
}
