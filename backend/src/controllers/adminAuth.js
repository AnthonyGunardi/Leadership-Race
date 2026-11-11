import { getSequelize } from '../config/database.js';
import {
  loginAdminUser,
  refreshAdminSession,
  logoutAdminSession
} from '../services/adminAuth.js';
import { assertValidOrigin, parseCookies } from '../middleware/adminAuth.js';

/**
 * Handles HTTP admin login request.
 * Sets strict __Host- cookie for refresh token and returns access token in JSON envelope.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export async function postLogin(req, res, next) {
  try {
    assertValidOrigin(req);
    const sequelize = req.app?.locals?.sequelize || getSequelize();

    const result = await loginAdminUser({
      sequelize,
      requestId: req.id,
      ...req.body
    });

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');

    res.cookie('__Host-lr_admin_refresh', result.refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    return res.status(200).json({
      success: true,
      data: {
        accessToken: result.accessToken,
        accessExpiresAt: result.accessExpiresAt,
        user: result.user
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Returns authenticated admin session and profile data for protected verification.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export function getMe(req, res) {
  return res.status(200).json({
    success: true,
    data: {
      user: req.admin.user,
      session: {
        id: req.admin.session.id,
        expiresAt: req.admin.session.expiresAt
      }
    }
  });
}

/**
 * Handles HTTP admin refresh token rotation.
 * Rotates the refresh token, sets a new __Host- cookie, and returns a new access token.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export async function postRefresh(req, res, next) {
  try {
    assertValidOrigin(req);
    const cookies = parseCookies(req);
    const refreshToken = cookies['__Host-lr_admin_refresh'];
    const sequelize = req.app?.locals?.sequelize || getSequelize();

    const result = await refreshAdminSession({
      sequelize,
      refreshToken,
      requestId: req.id
    });

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');

    res.cookie('__Host-lr_admin_refresh', result.refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    return res.status(200).json({
      success: true,
      data: {
        accessToken: result.accessToken,
        accessExpiresAt: result.accessExpiresAt,
        user: result.user
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Handles HTTP admin logout.
 * Idempotently revokes the session and clears the __Host- cookie.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export async function postLogout(req, res, next) {
  try {
    assertValidOrigin(req);
    const cookies = parseCookies(req);
    const refreshToken = cookies['__Host-lr_admin_refresh'];
    const authHeader = req.headers.authorization;
    let accessToken = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      accessToken = authHeader.slice(7).trim();
    }
    const sequelize = req.app?.locals?.sequelize || getSequelize();

    await logoutAdminSession({
      sequelize,
      accessToken,
      refreshToken,
      requestId: req.id
    });

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');

    res.cookie('__Host-lr_admin_refresh', '', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 0
    });

    return res.status(200).json({
      success: true,
      data: {
        loggedOut: true
      }
    });
  } catch (err) {
    next(err);
  }
}
