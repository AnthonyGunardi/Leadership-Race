import { randomUUID } from 'node:crypto';
import { Transaction, Op } from 'sequelize';
import { defineGameSetup } from '../models/gameSetup.js';
import { defineControllerLease } from '../models/controllerLease.js';
import { defineTurn } from '../models/turn.js';
import { defineScoring } from '../models/scoring.js';
import { GameError, executeGameCommand, recordGameMutation, databaseNow, safeInteger } from './gameCommands.js';
import { getPrdBoardTemplate } from '../data/boardTemplate.js';
import { assertGamePreflight } from './gamePreflight.js';
import { settleExpiredMovementIfDue } from './turnSettlement.js';
import { calculateLeaderboard } from '../domain/scoring.js';

/** Public DTOs are allowlisted so persistence metadata and future credentials cannot leak. */
function gameDto(game) {
  return {
    id: game.id, name: game.name, status: game.status, currentTeamId: game.currentTeamId,
    boardSource: game.boardSource,
    activeTurnId: game.activeTurnId, turnNumber: safeInteger(game.turnNumber),
    startedAt: game.startedAt?.toISOString() ?? null, finishedAt: game.finishedAt?.toISOString() ?? null
  };
}

/** Canonical field projection ignores record IDs and input order when determining whether board provenance changed. */
function boardConfiguration(cells) {
  return cells.map(cellDto).map(({ id: _id, ...cell }) => cell).sort((a, b) => a.number - b.number);
}

/** Every setup command takes the same game lock and rejects lifecycle changes before version checks. */
function assertEditableVersion(game, expectedStateVersion) {
  if (!['DRAFT', 'READY'].includes(game.status)) {
    throw new GameError('SETUP_LOCKED', 'Setup hanya dapat diubah pada game DRAFT atau READY.');
  }
  if (safeInteger(game.stateVersion) !== expectedStateVersion) {
    throw new GameError('STALE_STATE', 'Setup telah berubah. Muat ulang sebelum melanjutkan.');
  }
}

/** Board replacement preserves teams, regenerates cell IDs and invalidates READY inside its caller's transaction. */
async function replaceBoardCells({ sequelize, transaction, game, cells, boardSource }) {
  const { BoardCell } = defineGameSetup(sequelize);
  await BoardCell.destroy({ where: { gameId: game.id }, transaction });
  await BoardCell.bulkCreate(cells.map((cell) => ({ ...cell, id: randomUUID(), gameId: game.id })), { transaction });
  game.status = 'DRAFT';
  game.boardSource = boardSource;
}

/** Team codes follow persisted order; browser state never supplies position or score. */
function teamDto(team) {
  return {
    id: team.id, name: team.name, sortOrder: team.sortOrder, code: `T${team.sortOrder}`, color: team.color,
    position: team.position, totalScore: safeInteger(team.totalScore)
  };
}

/** Reference activity text stays optional and does not block storing setup. */
function cellDto(cell) {
  return {
    id: cell.id, number: cell.number, category: cell.category, title: cell.title,
    instruction: cell.instruction, backupText: cell.backupText, durationText: cell.durationText,
    successPoints: cell.successPoints, allowManualPoints: cell.allowManualPoints,
    defaultScoringMethod: cell.defaultScoringMethod, pointsPerUnit: cell.pointsPerUnit, penaltySteps: cell.penaltySteps
  };
}

/** Reads the common board state first; public requests never load controller, judging or history details. */
async function snapshotData(sequelize, transaction, game, publicOnly = false) {
  const { Team, BoardCell } = defineGameSetup(sequelize);
  const Turn = defineTurn(sequelize);
  const teams = (await Team.findAll({ where: { gameId: game.id }, order: [['sortOrder', 'ASC']], transaction })).map(teamDto);
  const cells = await BoardCell.findAll({ where: { gameId: game.id }, order: [['number', 'ASC']], transaction });
  const now = await databaseNow(sequelize, transaction);

  const animatingTurns = await Turn.findAll({
    where: {
      gameId: game.id,
      status: 'ANIMATING',
      movementEndsAt: { [Op.gt]: now }
    },
    order: [['movementStartedAt', 'ASC']],
    transaction
  });

  const activeMovements = animatingTurns.map((t) => ({
    turnId: t.id,
    teamId: t.teamId,
    diceValue: t.diceValue,
    from: t.fromPosition,
    dicePath: t.dicePath,
    penaltyPath: t.penaltyPath,
    fullPath: t.fullPath,
    landingCell: t.landingCell,
    finalPosition: t.finalPosition,
    movementStartsAt: t.movementStartedAt.toISOString(),
    movementEndsAt: t.movementEndsAt.toISOString(),
    stepDurationMs: t.stepDurationMs
  }));
  const activeMovement = activeMovements.length > 0 ? activeMovements[0] : null;

  const awaitingTurns = await Turn.findAll({
    where: { gameId: game.id, status: 'AWAITING_RESULT' },
    order: [['turnNumber', 'ASC']],
    transaction
  });

  const pendingResults = awaitingTurns.map((t) => {
    const cell = cells.find((c) => c.number === t.landingCell);
    return {
      turnId: t.id,
      teamId: t.teamId,
      cellNumber: cell ? cell.number : t.landingCell,
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
  });
  const pendingResult = pendingResults.length > 0 ? pendingResults[0] : null;

  const turnRecord = game.activeTurnId
    ? await Turn.findByPk(game.activeTurnId, { transaction })
    : (animatingTurns[0] || awaitingTurns[0] || null);

  const turnStatus = activeMovements.length > 0
    ? 'ANIMATING'
    : (pendingResults.length > 0 ? 'AWAITING_RESULT' : 'READY_FOR_ROLL');

  const data = {
    game: gameDto(game),
    teams,
    boardCells: cells.map(cellDto),
    turnStatus,
    activeMovement,
    leaderboard: calculateLeaderboard(teams)
  };
  if (publicOnly) return data;

  const lease = await defineControllerLease(sequelize).findByPk(game.id, { transaction });
  const leaseActive = lease && lease.expiresAt > now && ['RUNNING', 'PAUSED'].includes(game.status);

  const turn = turnRecord ? {
    id: turnRecord.id,
    turnNumber: safeInteger(turnRecord.turnNumber),
    teamId: turnRecord.teamId,
    diceValue: turnRecord.diceValue,
    from: turnRecord.fromPosition,
    landingCell: turnRecord.landingCell,
    finalPosition: turnRecord.finalPosition,
    status: turnRecord.status,
    requiresChallenge: turnRecord.requiresChallenge,
    resolvedAt: turnRecord.resolvedAt?.toISOString() ?? null,
    voidedAt: turnRecord.voidedAt?.toISOString() ?? null,
    voidedBy: turnRecord.voidedBy,
    voidReason: turnRecord.voidReason
  } : null;

  const lastTurnRecord = await Turn.findOne({
    where: { gameId: game.id },
    order: [['turnNumber', 'DESC']],
    transaction
  });

  let lastTurn = null;
  if (lastTurnRecord) {
    const { ChallengeResult } = defineScoring(sequelize);
    const lastResult = await ChallengeResult.findOne({
      where: { turnId: lastTurnRecord.id },
      transaction
    });
    lastTurn = {
      id: lastTurnRecord.id,
      turnNumber: safeInteger(lastTurnRecord.turnNumber),
      teamId: lastTurnRecord.teamId,
      diceValue: lastTurnRecord.diceValue,
      from: lastTurnRecord.fromPosition,
      landingCell: lastTurnRecord.landingCell,
      finalPosition: lastTurnRecord.finalPosition,
      status: lastTurnRecord.status,
      requiresChallenge: lastTurnRecord.requiresChallenge,
      awardedPoints: lastResult ? safeInteger(lastResult.awardedPoints) : 0,
      resolvedAt: lastTurnRecord.resolvedAt?.toISOString() ?? null,
      voidedAt: lastTurnRecord.voidedAt?.toISOString() ?? null,
      voidedBy: lastTurnRecord.voidedBy,
      voidReason: lastTurnRecord.voidReason
    };
  }




  let finalResults = null;
  if (game.status === 'FINISHED') {
    const { FinalResult } = defineScoring(sequelize);
    const storedFinals = await FinalResult.findAll({
      where: { gameId: game.id },
      order: [['rank', 'ASC'], ['score', 'DESC']],
      transaction
    });
    const leaderboard = calculateLeaderboard(teams);
    const winners = leaderboard.filter((entry) => entry.rank === 1);
    finalResults = {
      finishedAt: game.finishedAt?.toISOString() ?? null,
      finishedBy: game.finishedBy,
      winners,
      results: storedFinals.length > 0 ? storedFinals.map((r) => {
        const team = teams.find((t) => t.id === r.teamId);
        return {
          teamId: r.teamId,
          name: team?.name ?? '',
          code: team?.code ?? `T${team?.sortOrder ?? ''}`,
          color: team?.color ?? '',
          score: safeInteger(r.score),
          position: r.position,
          rank: r.rank,
          isWinner: Boolean(r.isWinner)
        };
      }) : leaderboard.map((entry) => ({
        ...entry,
        score: entry.totalScore,
        isWinner: entry.rank === 1
      }))
    };
  }

  return {
    ...data, activeMovements, turn, pendingResult, pendingResults, lastTurn, controller: {
      holderUserId: leaseActive ? lease.holderUserId : null,
      expiresAt: leaseActive ? lease.expiresAt.toISOString() : null,
      version: lease ? safeInteger(lease.version) : 0
    }, finalResults
  };
}

/** Snapshot counters describe committed state, while request tracing and server clock describe this request. */
export async function envelope(sequelize, transaction, game, requestId, { publicOnly = false } = {}) {
  return {
    success: true, data: await snapshotData(sequelize, transaction, game, publicOnly),
    meta: {
      stateVersion: safeInteger(game.stateVersion), eventSequence: safeInteger(game.eventSequence),
      serverTime: (await databaseNow(sequelize, transaction)).toISOString(), requestId
    }
  };
}

/** Authorization is enforced before this consistent snapshot for admin reads. */
export async function getGameSnapshot({ sequelize, gameId, requestId }) {
  await settleExpiredMovementIfDue({ sequelize, gameId, requestId });
  const { Game } = defineGameSetup(sequelize);
  return sequelize.transaction({
    isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ
  }, async (transaction) => {
    const game = await Game.findByPk(gameId, { transaction });
    if (!game) throw new GameError('NOT_FOUND', 'Game tidak ditemukan.', 404);
    return envelope(sequelize, transaction, game, requestId);
  });
}

/**
 * Replaces editable draft configuration atomically, retaining validated IDs and auditing the full configuration.
 * Replacement avoids transient unique conflicts during name/order swaps. No gameplay rows exist in editable states.
 * READY edits invalidate preflight in this same transaction; all later lifecycle states reject setup writes.
 */
export async function saveGameSetup({ sequelize, gameId, actorUserId, idempotencyKey, requestId, input }) {
  const { Team, BoardCell } = defineGameSetup(sequelize);
  return executeGameCommand({
    sequelize, gameId, actorUserId, idempotencyKey, requestId, input,
    commandType: 'SAVE_SETUP', method: 'PUT', target: `/api/v1/games/${gameId}/setup`,
    mutate: async ({ game, transaction }) => {
      assertEditableVersion(game, input.expectedStateVersion);
      const before = await snapshotData(sequelize, transaction, game);
      const teamIds = new Set(before.teams.map((team) => team.id));
      const cellIds = new Set(before.boardCells.map((cell) => cell.id));
      if (input.teams.some((team) => team.id && !teamIds.has(team.id))
        || input.boardCells.some((cell) => cell.id && !cellIds.has(cell.id))) {
        throw new GameError('FORBIDDEN', 'ID tim atau kotak tidak termasuk game ini.', 403);
      }
      // Both pointers are null throughout editable setup. Draft configuration replacement is scoped to this game.
      await Team.destroy({ where: { gameId }, transaction });
      await BoardCell.destroy({ where: { gameId }, transaction });
      await Team.bulkCreate(input.teams.map((team) => ({
        ...team, id: team.id ?? randomUUID(), gameId
      })), { transaction });
      if (input.boardCells.length) {
        await BoardCell.bulkCreate(input.boardCells.map((cell) => ({
          ...cell, id: cell.id ?? randomUUID(), gameId
        })), { transaction });
      }
      game.name = input.name;
      game.status = 'DRAFT';
      const boardChanged = JSON.stringify(boardConfiguration(before.boardCells))
        !== JSON.stringify(boardConfiguration(input.boardCells));
      if (boardChanged) {
        game.boardSource = 'CUSTOM';
      }
      await recordGameMutation({
        sequelize, transaction, game, actorUserId, requestId,
        action: 'GAME_SETUP_SAVED', before: { game: before.game, teams: before.teams, boardCells: before.boardCells },
        after: { name: input.name, status: 'DRAFT', teams: input.teams, boardCells: input.boardCells }
      });
      return { status: 200, body: await envelope(sequelize, transaction, game, requestId) };
    }
  });
}

/** Reading a template never mutates a game or claims that its source workbook has been reconciled. */
export async function readBoardTemplate() {
  return { success: true, data: getPrdBoardTemplate() };
}

/** Template replacement is explicit, versioned, audited and scoped; teams and game name remain unchanged. */
export async function applyBoardTemplate(parameters) {
  const { sequelize, gameId, actorUserId, requestId, input } = parameters;
  return executeGameCommand({
    ...parameters, commandType: 'APPLY_BOARD_TEMPLATE', method: 'POST',
    target: `/api/v1/games/${gameId}/board-template`, mutate: async ({ game, transaction }) => {
      assertEditableVersion(game, input.expectedStateVersion);
      const before = await snapshotData(sequelize, transaction, game);
      const template = getPrdBoardTemplate();
      await replaceBoardCells({ sequelize, transaction, game, cells: template.boardCells, boardSource: 'PRD_APPENDIX_A' });
      await recordGameMutation({
        sequelize, transaction, game, actorUserId, requestId,
        action: 'BOARD_TEMPLATE_APPLIED', before: { boardCells: before.boardCells, boardSource: before.game.boardSource },
        after: { boardCells: template.boardCells, template: template.template }
      });
      return { status: 200, body: await envelope(sequelize, transaction, game, requestId) };
    }
  });
}

/** Preflight serializes with setup; failed checks roll back without publishing a misleading READY state. */
export async function validateGame(parameters) {
  const { sequelize, actorUserId, requestId, input, gameId } = parameters;
  return executeGameCommand({
    ...parameters, commandType: 'VALIDATE_GAME', method: 'POST',
    target: `/api/v1/games/${gameId}/validate`, mutate: async ({ game, transaction }) => {
      assertEditableVersion(game, input.expectedStateVersion);
      const before = await snapshotData(sequelize, transaction, game);
      const preflight = assertGamePreflight(before);
      game.status = 'READY';
      await recordGameMutation({
        sequelize, transaction, game, actorUserId, requestId,
        action: 'GAME_VALIDATED', before: { status: before.game.status }, after: preflight
      });
      const body = await envelope(sequelize, transaction, game, requestId);
      body.data.preflight = preflight;
      return { status: 200, body };
    }
  });
}

/** Start revalidates under lock, chooses the first persisted team, and never resets score history. */
export async function startGame(parameters) {
  const { sequelize, actorUserId, requestId, input, gameId } = parameters;
  return executeGameCommand({
    ...parameters, commandType: 'START_GAME', method: 'POST',
    target: `/api/v1/games/${gameId}/start`, mutate: async ({ game, transaction }) => {
      if (game.status !== 'READY') throw new GameError('GAME_NOT_READY', 'Start memerlukan status READY dari preflight terbaru.');
      assertEditableVersion(game, input.expectedStateVersion);
      const before = await snapshotData(sequelize, transaction, game);
      assertGamePreflight(before);
      game.status = 'RUNNING';
      game.currentTeamId = before.teams[0].id;
      game.startedAt = await databaseNow(sequelize, transaction);
      await recordGameMutation({
        sequelize, transaction, game, actorUserId, requestId,
        action: 'GAME_STARTED', before: { status: 'READY', currentTeamId: null },
        after: { status: game.status, currentTeamId: game.currentTeamId, startedAt: game.startedAt.toISOString() }
      });
      return { status: 200, body: await envelope(sequelize, transaction, game, requestId) };
    }
  });
}

/** Validated JSON replaces only this game's board, with no client-owned IDs, score, or provenance claims. */
export async function importGameBoard(parameters) {
  const { sequelize, gameId, actorUserId, requestId, input } = parameters;
  return executeGameCommand({
    ...parameters, commandType: 'IMPORT_BOARD', method: 'POST',
    target: `/api/v1/games/${gameId}/board-import`, mutate: async ({ game, transaction }) => {
      assertEditableVersion(game, input.expectedStateVersion);
      const before = await snapshotData(sequelize, transaction, game);
      await replaceBoardCells({
        sequelize, transaction, game,
        cells: input.configuration.boardCells, boardSource: 'JSON_IMPORT'
      });
      await recordGameMutation({
        sequelize, transaction, game, actorUserId, requestId,
        action: 'BOARD_IMPORTED', before: { boardCells: before.boardCells, boardSource: before.game.boardSource },
        after: input.configuration
      });
      return { status: 200, body: await envelope(sequelize, transaction, game, requestId) };
    }
  });
}

/** Pauses a running game without active movement; turns and pending results remain intact. */
export async function pauseGame(parameters) {
  const { sequelize, gameId, actorUserId, requestId, input, movementWorker } = parameters;
  await settleExpiredMovementIfDue({ sequelize, gameId, movementWorker });
  const Turn = defineTurn(sequelize);
  return executeGameCommand({
    ...parameters,
    commandType: 'PAUSE_GAME',
    method: 'POST',
    target: `/api/v1/games/${gameId}/pause`,
    mutate: async ({ game, transaction }) => {
      if (game.status !== 'RUNNING') {
        throw new GameError('INVALID_STATE', 'Game hanya dapat di-pause saat berstatus RUNNING.', 409);
      }
      if (safeInteger(game.stateVersion) !== input.expectedStateVersion) {
        throw new GameError('STALE_STATE', 'Status game telah berubah. Muat ulang sebelum melanjutkan.', 409);
      }
      if (game.activeTurnId) {
        const turn = await Turn.findByPk(game.activeTurnId, { transaction });
        const now = await databaseNow(sequelize, transaction);
        if (turn && turn.status === 'ANIMATING' && now < turn.movementEndsAt) {
          throw new GameError('TURN_NOT_READY', 'Tidak dapat pause saat animasi gerakan sedang berlangsung.', 409);
        }
      }
      const beforeStatus = game.status;
      game.status = 'PAUSED';
      const turnRecord = game.activeTurnId ? await Turn.findByPk(game.activeTurnId, { transaction }) : null;
      await recordGameMutation({
        sequelize,
        transaction,
        game,
        actorUserId,
        requestId,
        action: 'GAME_PAUSED',
        before: { status: beforeStatus },
        after: { status: 'PAUSED' },
        eventType: 'game:state_changed',
        eventPayload: {
          status: 'PAUSED',
          currentTeamId: game.currentTeamId,
          activeTurnId: game.activeTurnId,
          turnNumber: safeInteger(game.turnNumber),
          turnStatus: !game.activeTurnId ? 'READY_FOR_ROLL' : (turnRecord?.status ?? 'READY_FOR_ROLL')
        }
      });
      return { status: 200, body: await envelope(sequelize, transaction, game, requestId) };
    }
  });
}

/** Resumes a paused game, unfreezing roll and scoring without creating a new turn or advancing team. */
export async function resumeGame(parameters) {
  const { sequelize, gameId, actorUserId, requestId, input, movementWorker } = parameters;
  await settleExpiredMovementIfDue({ sequelize, gameId, movementWorker });
  const Turn = defineTurn(sequelize);
  return executeGameCommand({
    ...parameters,
    commandType: 'RESUME_GAME',
    method: 'POST',
    target: `/api/v1/games/${gameId}/resume`,
    mutate: async ({ game, transaction }) => {
      if (game.status !== 'PAUSED') {
        throw new GameError('INVALID_STATE', 'Game hanya dapat di-resume saat berstatus PAUSED.', 409);
      }
      if (safeInteger(game.stateVersion) !== input.expectedStateVersion) {
        throw new GameError('STALE_STATE', 'Status game telah berubah. Muat ulang sebelum melanjutkan.', 409);
      }
      const beforeStatus = game.status;
      game.status = 'RUNNING';
      const turnRecord = game.activeTurnId ? await Turn.findByPk(game.activeTurnId, { transaction }) : null;
      await recordGameMutation({
        sequelize,
        transaction,
        game,
        actorUserId,
        requestId,
        action: 'GAME_RESUMED',
        before: { status: beforeStatus },
        after: { status: 'RUNNING' },
        eventType: 'game:state_changed',
        eventPayload: {
          status: 'RUNNING',
          currentTeamId: game.currentTeamId,
          activeTurnId: game.activeTurnId,
          turnNumber: safeInteger(game.turnNumber),
          turnStatus: !game.activeTurnId ? 'READY_FOR_ROLL' : (turnRecord?.status ?? 'READY_FOR_ROLL')
        }
      });
      return { status: 200, body: await envelope(sequelize, transaction, game, requestId) };
    }
  });
}

/** Manually finishes a game after all turns and results have been resolved, freezing final results. */
export async function finishGame(parameters) {
  const { sequelize, gameId, actorUserId, requestId, input, movementWorker } = parameters;
  await settleExpiredMovementIfDue({ sequelize, gameId, movementWorker });
  const Turn = defineTurn(sequelize);
  const { Team } = defineGameSetup(sequelize);
  const { FinalResult } = defineScoring(sequelize);
  return executeGameCommand({
    ...parameters,
    commandType: 'FINISH_GAME',
    method: 'POST',
    target: `/api/v1/games/${gameId}/finish`,
    mutate: async ({ game, transaction }) => {
      if (!['RUNNING', 'PAUSED'].includes(game.status)) {
        throw new GameError('INVALID_STATE', 'Game hanya dapat diselesaikan saat berstatus RUNNING atau PAUSED.', 409);
      }
      if (safeInteger(game.stateVersion) !== input.expectedStateVersion) {
        throw new GameError('STALE_STATE', 'Status game telah berubah. Muat ulang sebelum menyelesaikan game.', 409);
      }
      if (game.activeTurnId) {
        const turn = await Turn.findByPk(game.activeTurnId, { transaction });
        if (turn && ['ANIMATING', 'AWAITING_RESULT', 'RESOLVING_PENALTY'].includes(turn.status)) {
          throw new GameError('PENDING_RESULT', 'Tidak dapat menyelesaikan game saat masih ada giliran atau hasil yang belum selesai.', 409);
        }
      }
      const teams = (await Team.findAll({
        where: { gameId: game.id },
        order: [['sortOrder', 'ASC']],
        transaction
      })).map(teamDto);
      const leaderboard = calculateLeaderboard(teams);
      const winners = leaderboard.filter((entry) => entry.rank === 1);
      const now = await databaseNow(sequelize, transaction);
      const beforeStatus = game.status;

      game.status = 'FINISHED';
      game.finishedAt = now;
      game.finishedBy = actorUserId;
      game.activeTurnId = null;

      const finalRecords = leaderboard.map((entry) => ({
        id: randomUUID(),
        gameId: game.id,
        teamId: entry.teamId,
        score: entry.totalScore,
        position: entry.position,
        rank: entry.rank,
        isWinner: entry.rank === 1
      }));
      await FinalResult.bulkCreate(finalRecords, { transaction });

      const finalResultsList = finalRecords.map((r) => {
        const team = teams.find((t) => t.id === r.teamId);
        return {
          teamId: r.teamId,
          name: team?.name ?? '',
          code: team?.code ?? `T${team?.sortOrder ?? ''}`,
          color: team?.color ?? '',
          score: safeInteger(r.score),
          position: r.position,
          rank: r.rank,
          isWinner: r.isWinner
        };
      });

      await recordGameMutation({
        sequelize,
        transaction,
        game,
        actorUserId,
        requestId,
        action: 'GAME_FINISHED',
        before: { status: beforeStatus },
        after: {
          status: 'FINISHED',
          finishedAt: now.toISOString(),
          finishedBy: actorUserId,
          winners,
          results: finalResultsList
        },
        eventType: 'game:finished',
        eventPayload: {
          status: 'FINISHED',
          finishedAt: now.toISOString(),
          finishedBy: actorUserId,
          winners,
          results: finalResultsList
        }
      });
      return { status: 200, body: await envelope(sequelize, transaction, game, requestId) };
    }
  });
}

/** Returns authoritative final results for a FINISHED game. */
export async function getGameResults({ sequelize, gameId, requestId }) {
  const { Game, Team } = defineGameSetup(sequelize);
  const { FinalResult } = defineScoring(sequelize);
  const game = await Game.findByPk(gameId);
  if (!game) {
    throw new GameError('NOT_FOUND', 'Game tidak ditemukan.', 404);
  }
  if (game.status !== 'FINISHED') {
    throw new GameError('INVALID_STATE', 'Hasil final hanya tersedia setelah game berstatus FINISHED.', 409);
  }
  const teams = (await Team.findAll({
    where: { gameId: game.id },
    order: [['sortOrder', 'ASC']]
  })).map(teamDto);
  const storedFinals = await FinalResult.findAll({
    where: { gameId: game.id },
    order: [['rank', 'ASC'], ['score', 'DESC']]
  });
  const leaderboard = calculateLeaderboard(teams);
  const winners = leaderboard.filter((entry) => entry.rank === 1);
  const results = storedFinals.length > 0 ? storedFinals.map((r) => {
    const team = teams.find((t) => t.id === r.teamId);
    return {
      teamId: r.teamId,
      name: team?.name ?? '',
      code: team?.code ?? `T${team?.sortOrder ?? ''}`,
      color: team?.color ?? '',
      score: safeInteger(r.score),
      position: r.position,
      rank: r.rank,
      isWinner: Boolean(r.isWinner)
    };
  }) : leaderboard.map((entry) => ({
    ...entry,
    score: entry.totalScore,
    isWinner: entry.rank === 1
  }));
  const now = await databaseNow(sequelize);
  return {
    status: 200,
    body: {
      success: true,
      data: {
        gameId: game.id,
        status: game.status,
        finishedAt: game.finishedAt?.toISOString() ?? null,
        finishedBy: game.finishedBy,
        winners,
        results
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
