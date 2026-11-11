import { getSequelize } from '../config/database.js';
import { databaseNow } from '../services/gameCommands.js';
import { rollDice, recordChallengeResult, voidTurn, getGameLeaderboard } from '../services/turnCommands.js';

/** Bridges turn mutation commands with tracing, cache control, and database server time. */
function commandController(service) {
  return async (req, res, next) => {
    try {
      const sequelize = req.app.locals.sequelize || getSequelize();
      const movementWorker = req.app.locals.movementWorker;
      const result = await service({
        sequelize,
        actorUserId: req.admin.user.id,
        requestId: req.id,
        movementWorker,
        ...req.gameInput
      });
      res.setHeader('Cache-Control', 'no-store');
      res.status(result.status).json({
        ...result.body,
        meta: {
          ...result.body.meta,
          requestId: req.id,
          serverTime: (await databaseNow(sequelize)).toISOString()
        }
      });
    } catch (error) {
      next(error);
    }
  };
}

export const postRollDice = commandController(rollDice);
export const postTurnResult = commandController(recordChallengeResult);
export const postVoidTurn = commandController(voidTurn);

/**
 * Controller for retrieving authoritative game leaderboard.
 */
export async function getLeaderboard(req, res, next) {
  try {
    const sequelize = req.app.locals.sequelize || getSequelize();
    const result = await getGameLeaderboard({
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
