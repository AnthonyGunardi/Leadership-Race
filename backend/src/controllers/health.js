import { checkLiveness, checkReadiness, getSystemMetrics } from '../services/health.js';

/**
 * Handles HTTP requests for process liveness probe.
 *
 * @param {import('express').Request} req Express request.
 * @param {import('express').Response} res Express response.
 * @param {import('express').NextFunction} next Express next callback.
 */
export function getLiveness(req, res, next) {
  try {
    const data = checkLiveness();
    return res.status(200).json({
      success: true,
      data
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * Handles HTTP requests for application and dependency readiness probe.
 *
 * @param {import('express').Request} req Express request.
 * @param {import('express').Response} res Express response.
 * @param {import('express').NextFunction} next Express next callback.
 */
export async function getReadiness(req, res, next) {
  try {
    const isShuttingDown = req.app && req.app.locals && typeof req.app.locals.isShuttingDown === 'function'
      ? req.app.locals.isShuttingDown()
      : false;

    if (isShuttingDown) {
      return res.status(503).json({
        success: false,
        data: {
          status: 'not_ready',
          database: {
            status: 'disconnected'
          },
          timestamp: new Date().toISOString()
        },
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Server is shutting down'
        }
      });
    }

    const sequelizeInstance = req.app && req.app.locals ? req.app.locals.sequelize : undefined;
    const isWorkerReady = req.app?.locals?.isWorkerReady ||
      (req.app?.locals?.movementWorker?.isReady ? () => req.app.locals.movementWorker.isReady() : undefined);

    const data = await checkReadiness(
      sequelizeInstance,
      req.app?.locals?.isRealtimeReady,
      isWorkerReady
    );

    if (data.status === 'ready') {
      return res.status(200).json({
        success: true,
        data
      });
    }

    return res.status(503).json({
      success: false,
      data,
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Service not ready'
      }
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * Handles HTTP requests for operational system metrics.
 *
 * @param {import('express').Request} req Express request.
 * @param {import('express').Response} res Express response.
 * @param {import('express').NextFunction} next Express next callback.
 */
export async function getMetrics(req, res, next) {
  try {
    const sequelizeInstance = req.app && req.app.locals ? req.app.locals.sequelize : undefined;
    const data = await getSystemMetrics(sequelizeInstance);
    return res.status(200).json({
      success: true,
      data
    });
  } catch (err) {
    return next(err);
  }
}
