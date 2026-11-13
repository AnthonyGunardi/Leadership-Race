import { getSequelize } from '../config/database.js';
import { getPublicGame, getPublicGameEvents } from '../services/singleGame.js';

/** Keeps public transport separate from the allowlisted snapshot and replay domain. */
function publicController(service) {
  return async (req, res, next) => {
    try {
      const tStart = Date.now();
      const result = await service({ sequelize: req.app.locals.sequelize || getSequelize(), ...req.gameInput });
      const durationMs = Date.now() - tStart;
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Server-Timing', `total;dur=${durationMs}`);
      res.json({
        ...result,
        meta: {
          ...result?.meta,
          durationMs
        }
      });
    } catch (error) {
      next(error);
    }
  };
}

export const getPublicBoard = publicController(getPublicGame);
export const getPublicEvents = publicController(getPublicGameEvents);
