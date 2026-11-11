import { getSequelize } from '../config/database.js';
import { getPublicGame, getPublicGameEvents } from '../services/singleGame.js';

/** Keeps public transport separate from the allowlisted snapshot and replay domain. */
function publicController(service) {
  return async (req, res, next) => {
    try {
      const result = await service({ sequelize: req.app.locals.sequelize || getSequelize(), ...req.gameInput });
      res.setHeader('Cache-Control', 'no-store');
      res.json(result);
    } catch (error) {
      next(error);
    }
  };
}

export const getPublicBoard = publicController(getPublicGame);
export const getPublicEvents = publicController(getPublicGameEvents);
