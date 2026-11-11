import { Router } from 'express';
import { getLiveness, getReadiness, getMetrics } from '../controllers/health.js';

const router = Router();

router.get('/live', getLiveness);
router.get('/ready', getReadiness);
router.get('/metrics', getMetrics);

export default router;
