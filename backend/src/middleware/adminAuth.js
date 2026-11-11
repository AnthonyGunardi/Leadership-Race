import { getEnv } from '../config/environment.js';
import { getSequelize } from '../config/database.js';
import { AuthError } from '../services/adminAuth.js';
import { authorizeAdminAccess } from '../services/adminSessions.js';

/**
 * Asserts that the request origin matches allowed CORS origin or localhost.
 * Throws 403 FORBIDDEN if cross-origin request is from an unauthorized origin.
 *
 * @param {import('express').Request} req
 * @throws {Error} If origin is present and unauthorized
 */
export function assertValidOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) {
    return;
  }
  const env = getEnv();
  const allowedOrigins = env.CORS_ORIGIN ? env.CORS_ORIGIN.split(',') : [];
  const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (!allowedOrigins.includes(origin) && !isLocalhost) {
    const err = new Error('Cross-origin request prohibited from this origin');
    err.status = 403;
    err.code = 'FORBIDDEN';
    throw err;
  }
}

/**
 * Parses HTTP Cookie header string into key-value map.
 *
 * @param {import('express').Request} req
 * @returns {Record<string, string>}
 */
export function parseCookies(req) {
  const list = {};
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) {
    return list;
  }
  const items = cookieHeader.split(';');
  for (const item of items) {
    const parts = item.split('=');
    const key = parts[0]?.trim();
    if (key) {
      list[key] = decodeURIComponent(parts.slice(1).join('=').trim());
    }
  }
  return list;
}

/**
 * Middleware enforcing Bearer access token authorization for Super Admin routes.
 * Looks up SHA-256 token hash and validates session status, expiry, user status, and role.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} _res
 * @param {import('express').NextFunction} next
 */
export async function requireAdminAuth(req, _res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AuthError('Authorization bearer token is required', 'UNAUTHENTICATED', 401);
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      throw new AuthError('Authorization bearer token is required', 'UNAUTHENTICATED', 401);
    }

    const sequelize = req.app?.locals?.sequelize || getSequelize();
    req.admin = await authorizeAdminAccess({ sequelize, accessToken: token });

    next();
  } catch (err) {
    next(err);
  }
}

