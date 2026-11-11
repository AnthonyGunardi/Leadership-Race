import { Router } from 'express';
import { validateGameRead } from '../validation/gameRead.js';
import { getPublicBoard, getPublicEvents } from '../controllers/singleGame.js';

const router = Router();
router.get('/game', getPublicBoard);
router.get('/games/:id/snapshot', validateGameRead('snapshot'), getPublicBoard);
router.get('/games/:id/events', validateGameRead('events'), getPublicEvents);
export default router;
