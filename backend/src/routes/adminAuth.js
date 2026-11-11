import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  postLogin,
  getMe,
  postRefresh,
  postLogout
} from '../controllers/adminAuth.js';
import { requireAdminAuth } from '../middleware/adminAuth.js';

const router = Router();

export function loginLimiterKeyGenerator(req) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  return `${ip}:${email}`;
}

export function loginLimiterHandler(_req, res) {
  res.status(429).json({
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many failed login attempts, please try again later'
    }
  });
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  keyGenerator: loginLimiterKeyGenerator,
  handler: loginLimiterHandler
});

router.post('/login', loginLimiter, postLogin);
router.post('/refresh', postRefresh);
router.post('/logout', postLogout);
router.get('/me', requireAdminAuth, getMe);

export default router;
