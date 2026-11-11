import { getSequelize } from '../config/database.js';
import { getGameEvents } from '../services/gameEvents.js';

/** Read transport never accesses event persistence or decides game permissions. */
export async function getEvents(req, res, next) {
  try {
    const result = await getGameEvents({ sequelize: req.app.locals.sequelize || getSequelize(),
      ...req.gameInput, requestId: req.id });
    res.setHeader('Cache-Control', 'no-store');
    res.json(result);
  } catch (error) {
    next(error);
  }
}
