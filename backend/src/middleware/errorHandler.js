import { logger } from '../config/logger.js';
import { getEnv } from '../config/environment.js';

/**
 * Centralized Express error handler middleware.
 *
 * Constraints:
 * - Emits standardized response envelope { success: false, error: { code, message } }.
 * - Logs errors with level error and contextual metadata (status, path, method, stack, requestId).
 * - Masks internal database queries and stack traces in production.
 *
 * @param {Error & {
 *   status?: number,
 *   statusCode?: number,
 *   code?: string,
 *   origin?: string,
 *   errors?: Array<{ path: string, message: string }>
 * }} err The handled error.
 * @param {import('express').Request} req Express request.
 * @param {import('express').Response} res Express response.
 * @param {import('express').NextFunction} _next Express next callback.
 */
export function errorHandler(err, req, res, _next) {
  const isProduction = process.env.NODE_ENV === 'production' || getEnv().NODE_ENV === 'production';

  const status = err.status || err.statusCode || (err.name === 'CORS_ERROR' ? 403 : 500);

  logger.error(err.message, {
    stack: err.stack,
    name: err.name,
    status,
    path: req.originalUrl || req.url,
    method: req.method,
    requestId: req.id
  });

  if (err.name === 'CORS_ERROR') {
    return res.status(403).json({
      success: false,
      error: {
        code: 'CORS_ERROR',
        message: 'Request blocked by CORS policy'
      }
    });
  }

  if (err.name === 'SequelizeValidationError' || err.name === 'SequelizeUniqueConstraintError') {
    const messages = Array.isArray(err.errors)
      ? err.errors.map((e) => (e.path === 'username' ? 'Username is already registered' : e.message))
      : [err.message];
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: messages.join(', ')
      }
    });
  }

  if (err.name === 'SequelizeDatabaseError') {
    const message = isProduction ? 'Database error occurred' : `Database Error: ${err.message}`;
    return res.status(500).json({
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message
      }
    });
  }

  if (err.name === 'ZodError') {
    const messages = Array.isArray(err.errors)
      ? err.errors.map((e) => e.message)
      : [err.message];
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: messages.join(', ')
      }
    });
  }

  const finalStatus = err.status || err.statusCode;
  if (finalStatus && err.message) {
    return res.status(finalStatus).json({
      success: false,
      error: {
        code: err.code || (finalStatus === 401 ? 'UNAUTHENTICATED' : finalStatus === 403 ? 'FORBIDDEN' : 'CUSTOM_ERROR'),
        message: err.message
      }
    });
  }

  const fallbackMessage = isProduction
    ? 'Internal Server Error'
    : `Internal Server Error: ${err.message}`;

  return res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: fallbackMessage.trim()
    }
  });
}
