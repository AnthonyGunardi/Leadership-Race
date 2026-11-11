import { getSequelize } from '../config/database.js';
import { databaseNow } from '../services/gameCommands.js';
import { acquireController, heartbeatController, takeOverController } from '../services/controllerLeases.js';
import { getGameSnapshot, saveGameSetup,
  readBoardTemplate, applyBoardTemplate, validateGame, startGame, importGameBoard,
  pauseGame, resumeGame, finishGame, getGameResults as fetchGameResults
} from '../services/gameSetup.js';
import { applyScoreCorrection } from '../services/scoreCorrections.js';
import { getGameHistory as fetchGameHistory } from '../services/gameHistory.js';
import { exportGameCsv } from '../services/csvExport.js';
import { ensureCurrentGame, resetCurrentGame, listGameArchives } from '../services/singleGame.js';

/** Passes validated commands to the domain and refreshes retry tracing without changing stored receipt counters. */
function commandController(service) {
  return async (req, res, next) => {
    try {
      const sequelize = req.app.locals.sequelize || getSequelize();
      const movementWorker = req.app.locals.movementWorker;
      const result = await service({
        sequelize, actorUserId: req.admin?.user?.id, requestId: req.id, movementWorker, ...req.gameInput
      });
      res.setHeader('Cache-Control', 'no-store');
      res.status(result.status).json({ ...result.body, meta: {
        ...result.body.meta, requestId: req.id, serverTime: (await databaseNow(sequelize)).toISOString()
      } });
    } catch (error) {
      next(error);
    }
  };
}

/** Keeps read transport separate from the snapshot/list domain queries. */
function readController(service) {
  return async (req, res, next) => {
    try {
      const result = await service({
        sequelize: req.app.locals.sequelize || getSequelize(), requestId: req.id, ...req.gameInput
      });
      res.setHeader('Cache-Control', 'no-store');
      res.json(result);
    } catch (error) {
      next(error);
    }
  };
}

export const postCurrentGame = commandController(ensureCurrentGame);
export const postResetGame = commandController(resetCurrentGame);
export const getGameArchives = readController(listGameArchives);
export const getSnapshot = readController(getGameSnapshot);
export const putSetup = commandController(saveGameSetup);
export const getBoardTemplate = readController(readBoardTemplate);
export const postBoardTemplate = commandController(applyBoardTemplate);
export const postValidateGame = commandController(validateGame);
export const postStartGame = commandController(startGame);
export const postImportBoard = commandController(importGameBoard);
export const postAcquireController = commandController(acquireController);
export const postHeartbeatController = commandController(heartbeatController);
export const postTakeOverController = commandController(takeOverController);
export const postPauseGame = commandController(pauseGame);
export const postResumeGame = commandController(resumeGame);
export const postFinishGame = commandController(finishGame);
export const postScoreCorrection = commandController(applyScoreCorrection);
export const getGameHistory = readController(fetchGameHistory);

/** Controller for retrieving final game results. */
export async function getGameResults(req, res, next) {
  try {
    const sequelize = req.app.locals.sequelize || getSequelize();
    const result = await fetchGameResults({
      sequelize,
      gameId: req.gameInput.gameId,
      requestId: req.id
    });
    res.setHeader('Cache-Control', 'no-store');
    res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

/** Controller for exporting game results and history in RFC 4180 CSV format. */
export async function getGameExportCsv(req, res, next) {
  try {
    const sequelize = req.app.locals.sequelize || getSequelize();
    const { csv, filename } = await exportGameCsv({
      sequelize,
      gameId: req.gameInput.gameId,
      scope: req.gameInput.query?.scope,
      teamId: req.gameInput.query?.teamId,
      requestId: req.id
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Request-Id', req.id);
    res.status(200).send(csv);
  } catch (error) {
    next(error);
  }
}
