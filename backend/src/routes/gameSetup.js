import { Router } from 'express';
import { requireAdminAuth, assertValidOrigin } from '../middleware/adminAuth.js';
import { validateGameRequest } from '../validation/gameSetup.js';
import { validateGameRead } from '../validation/gameRead.js';
import { getEvents } from '../controllers/gameEvents.js';
import { validateControllerRequest } from '../validation/controllerLease.js';
import { validateTurnRequest } from '../validation/turn.js';
import { postRollDice, postTurnResult, postVoidTurn, getLeaderboard } from '../controllers/turns.js';
import {
  getSnapshot, putSetup, getBoardTemplate, postCurrentGame, postResetGame, getGameArchives,
  postBoardTemplate, postValidateGame, postStartGame, postImportBoard,
  postAcquireController, postHeartbeatController, postTakeOverController,
  postPauseGame, postResumeGame, postFinishGame, getGameResults,
  postScoreCorrection, getGameHistory, getGameExportCsv
} from '../controllers/gameSetup.js';

const router = Router();
router.use(requireAdminAuth);
router.use((req, _res, next) => {
  try {
    assertValidOrigin(req);
    next();
  } catch (error) {
    next(error);
  }
});
router.post('/current', validateGameRequest('current'), postCurrentGame);
router.get('/archives', validateGameRequest('archives'), getGameArchives);
router.get('/:id/snapshot', validateGameRead('snapshot'), getSnapshot);
router.get('/:id/events', validateGameRead('events'), getEvents);
router.get('/templates/:templateId', validateGameRequest('template'), getBoardTemplate);
router.put('/:id/setup', validateGameRequest('setup'), putSetup);
router.post('/:id/board-template', validateGameRequest('board-template'), postBoardTemplate);
router.post('/:id/validate', validateGameRequest('validate'), postValidateGame);
router.post('/:id/start', validateGameRequest('start'), postStartGame);
router.post('/:id/board-import', validateGameRequest('board-import'), postImportBoard);
router.post('/:id/controller/acquire', validateControllerRequest('acquire'), postAcquireController);
router.post('/:id/controller/heartbeat', validateControllerRequest('heartbeat'), postHeartbeatController);
router.post('/:id/controller/take-over', validateControllerRequest('take-over'), postTakeOverController);
router.post('/:id/turns/roll', validateTurnRequest('roll'), postRollDice);
router.post('/:id/turns/:turnId/result', validateTurnRequest('result'), postTurnResult);
router.post('/:id/turns/:turnId/void', validateTurnRequest('void'), postVoidTurn);
router.post('/:id/pause', validateGameRequest('pause'), postPauseGame);
router.post('/:id/resume', validateGameRequest('resume'), postResumeGame);
router.post('/:id/finish', validateGameRequest('finish'), postFinishGame);
router.post('/:id/reset', validateGameRequest('reset'), postResetGame);
router.post('/:id/corrections', validateGameRequest('correction'), postScoreCorrection);
router.get('/:id/history', validateGameRequest('history'), getGameHistory);
router.get('/:id/export.csv', validateGameRequest('export'), getGameExportCsv);
router.get('/:id/results', validateGameRequest('results'), getGameResults);
router.get('/:id/leaderboard', validateGameRequest('leaderboard'), getLeaderboard);

export default router;
