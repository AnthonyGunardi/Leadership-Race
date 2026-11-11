import path from 'node:path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { getEnv } from './config/environment.js';
import { requestIdMiddleware } from './middleware/requestId.js';
import { errorHandler } from './middleware/errorHandler.js';
import healthRouter from './routes/health.js';
import adminAuthRouter from './routes/adminAuth.js';
import gameSetupRouter from './routes/gameSetup.js';
import publicGameRouter from './routes/publicGame.js';

/**
 * Creates and configures the Express application instance.
 *
 * Constraints:
 * - Helmet security headers with CSP.
 * - Same-origin and allowlisted CORS handling without wildcard preflight.
 * - JSON body parser restricted to 1MB.
 * - Request ID tracking on all requests.
 * - Centralized error handling and standardized JSON 404 response.
 *
 * @param {object} [options={}] Application configuration options.
 * @param {import('sequelize').Sequelize} [options.sequelize] Injected Sequelize instance for dependency health checks.
 * @returns {express.Express}
 */
export function createApp(options = {}) {
  const env = getEnv();
  const app = express();

  if (options.sequelize) {
    app.locals.sequelize = options.sequelize;
  }
  if (options.movementWorker) {
    app.locals.movementWorker = options.movementWorker;
  }
  if (typeof options.isShuttingDown === 'function') {
    app.locals.isShuttingDown = options.isShuttingDown;
  }

  // Security Headers via Helmet
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          imgSrc: ["'self'", 'data:']
        }
      },
      crossOriginResourcePolicy: { policy: 'cross-origin' }
    })
  );

  // CORS configuration
  const allowedOrigins = env.CORS_ORIGIN ? env.CORS_ORIGIN.split(',') : [];
  const corsOptions = {
    origin(origin, callback) {
      if (!origin) {
        return callback(null, true);
      }
      const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
      if (allowedOrigins.includes(origin) || isLocalhost) {
        return callback(null, true);
      }
      const err = new Error('Not allowed by CORS');
      err.name = 'CORS_ERROR';
      err.origin = origin;
      return callback(err, false);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true
  };
  app.use(cors(corsOptions));

  // Request parsing and request ID tracking
  app.use(express.json({ limit: '1mb' }));
  app.use(requestIdMiddleware);

  // Routes
  app.use('/health', healthRouter);
  app.use('/api/v1/auth', adminAuthRouter);
  app.use('/api/v1/public', publicGameRouter);
  app.use('/api/v1/games', gameSetupRouter);

  // Static Frontend Serving (Optional)
  if (options.staticPath) {
    app.use(express.static(options.staticPath));
    app.use((req, res, next) => {
      if (req.method === 'GET' && !req.path.startsWith('/api') && !req.path.startsWith('/health')) {
        return res.sendFile(path.resolve(options.staticPath, 'index.html'));
      }
      next();
    });
  }

  // 404 Handler
  app.use((req, res) => {
    res.status(404).json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: `Route not found: ${req.method} ${req.originalUrl}`
      }
    });
  });

  // Centralized Error Handler
  app.use(errorHandler);

  return app;
}

