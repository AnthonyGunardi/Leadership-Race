import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { defineAdminIdentity } from '../models/adminIdentity.js';
import { defineAuthAudit } from '../models/authAudit.js';
import { verifyPassword } from './adminCredentials.js';
import { validateLoginPayload } from '../validation/adminAuth.js';

export const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Standard domain auth error indicating invalid credentials or session rejection.
 */
export class AuthError extends Error {
  constructor(message = 'Invalid email or password', code = 'UNAUTHENTICATED', statusCode = 401) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * Computes SHA-256 hash of an opaque token for secure database storage.
 *
 * @param {string} token
 * @returns {string} 64-char lowercase hex
 */
export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Generates an opaque, cryptographically secure 32-byte base64url token.
 *
 * @returns {string}
 */
export function generateOpaqueToken() {
  return randomBytes(32).toString('base64url');
}

/**
 * Authenticates an admin user, establishes a session family, issues opaque access and refresh tokens,
 * and records an audit log entry in an atomic transaction.
 *
 * @param {object} params
 * @param {import('sequelize').Sequelize} params.sequelize
 * @param {string} params.email
 * @param {string} params.password
 * @param {string} [params.requestId]
 * @returns {Promise<{
 *   accessToken: string,
 *   accessExpiresAt: string,
 *   refreshToken: string,
 *   refreshExpiresAt: string,
 *   user: { id: string, email: string, role: string }
 * }>}
 * @throws {AuthError} If credentials or account status are invalid
 */
export async function loginAdminUser({ sequelize, requestId, ...credentials }) {
  if (!sequelize) {
    throw new Error('Sequelize instance is required for login');
  }

  const validated = validateLoginPayload(credentials);
  const identityModels = defineAdminIdentity(sequelize);
  const auditModels = defineAuthAudit(sequelize);

  const user = await identityModels.User.findOne({
    where: { email: validated.email }
  });

  const isPasswordValid = user && user.isActive
    ? await verifyPassword(validated.password, user.passwordHash)
    : false;

  if (!user || !user.isActive || !isPasswordValid) {
    // Record login failure audit log outside transaction
    try {
      await auditModels.AuditLog.create({
        id: randomUUID(),
        actorType: 'SYSTEM',
        actorUserId: null,
        action: 'ADMIN_LOGIN_FAILURE',
        afterJson: { email: validated.email },
        reason: 'Invalid credentials or inactive account',
        requestId: requestId || randomUUID(),
        occurredAt: new Date()
      });
    } catch {
      // Best-effort audit logging on failure; never hide authentication rejection
    }

    throw new AuthError('Invalid email or password', 'UNAUTHENTICATED', 401);
  }

  const now = Date.now();
  const accessExpiresAt = new Date(now + ACCESS_TOKEN_TTL_MS);
  const refreshExpiresAt = new Date(now + REFRESH_TOKEN_TTL_MS);

  const accessToken = generateOpaqueToken();
  const refreshToken = generateOpaqueToken();

  return sequelize.transaction(async (transaction) => {
    const sessionId = randomUUID();
    const session = await identityModels.AdminSession.create({
      id: sessionId,
      userId: user.id,
      expiresAt: refreshExpiresAt,
      revokedAt: null,
      revokedReason: null,
      refreshGeneration: 0
    }, { transaction });

    await identityModels.AdminRefreshToken.create({
      id: randomUUID(),
      sessionId: session.id,
      tokenHash: hashToken(refreshToken),
      generation: 0,
      expiresAt: refreshExpiresAt,
      usedAt: null,
      replacedBy: null
    }, { transaction });

    await identityModels.AdminAccessToken.create({
      id: randomUUID(),
      sessionId: session.id,
      tokenHash: hashToken(accessToken),
      expiresAt: accessExpiresAt,
      revokedAt: null
    }, { transaction });

    await auditModels.AuditLog.create({
      id: randomUUID(),
      actorType: 'USER',
      actorUserId: user.id,
      action: 'ADMIN_LOGIN_SUCCESS',
      afterJson: {
        email: user.email,
        sessionId: session.id
      },
      reason: 'Admin login session established',
      requestId: requestId || randomUUID(),
      occurredAt: new Date()
    }, { transaction });

    return {
      accessToken,
      accessExpiresAt: accessExpiresAt.toISOString(),
      refreshToken,
      refreshExpiresAt: refreshExpiresAt.toISOString(),
      user: {
        id: user.id,
        email: user.email,
        role: user.role
      }
    };
  });
}

/**
 * Rotates an admin refresh token and issues a new access token in an atomic locked transaction.
 * Detects token reuse; on reuse, revokes the entire session family, commits the revocation,
 * and throws an unauthenticated error.
 *
 * @param {object} params
 * @param {import('sequelize').Sequelize} params.sequelize
 * @param {string} params.refreshToken
 * @param {string} [params.requestId]
 * @returns {Promise<{
 *   accessToken: string,
 *   accessExpiresAt: string,
 *   refreshToken: string,
 *   refreshExpiresAt: string,
 *   user: { id: string, email: string, role: string }
 * }>}
 */
export async function refreshAdminSession({ sequelize, refreshToken, requestId }) {
  if (!sequelize) {
    throw new Error('Sequelize instance is required for session refresh');
  }
  if (!refreshToken || typeof refreshToken !== 'string') {
    throw new AuthError('Refresh token is required', 'UNAUTHENTICATED', 401);
  }

  const tokenHash = hashToken(refreshToken.trim());
  const identityModels = defineAdminIdentity(sequelize);
  const auditModels = defineAuthAudit(sequelize);

  const txResult = await sequelize.transaction(async (transaction) => {
    const tokenRecord = await identityModels.AdminRefreshToken.findOne({
      where: { tokenHash },
      lock: transaction.LOCK ? transaction.LOCK.UPDATE : undefined,
      transaction,
      include: [
        {
          model: identityModels.AdminSession,
          as: 'session',
          include: [{ model: identityModels.User, as: 'user' }]
        }
      ]
    });

    if (!tokenRecord) {
      return { status: 'INVALID_TOKEN' };
    }

    const session = tokenRecord.session;

    if (tokenRecord.usedAt !== null) {
      if (session) {
        session.revokedAt = new Date();
        session.revokedReason = 'REFRESH_TOKEN_REUSE_DETECTED';
        await session.save({ transaction });

        await identityModels.AdminAccessToken.update(
          { revokedAt: new Date() },
          { where: { sessionId: session.id, revokedAt: null }, transaction }
        );

        await auditModels.AuditLog.create({
          id: randomUUID(),
          actorType: 'SYSTEM',
          actorUserId: null,
          action: 'ADMIN_SESSION_REVOKED_REUSE',
          afterJson: {
            sessionId: session.id,
            userId: session.userId || null,
            reusedTokenHash: tokenHash
          },
          reason: 'Refresh token reuse detected; entire session family revoked',
          requestId: requestId || randomUUID(),
          occurredAt: new Date()
        }, { transaction });
      }
      return { status: 'REUSE_COMMITTED' };
    }

    if (!session || session.revokedAt || !(new Date(session.expiresAt).getTime() > Date.now())) {
      return { status: 'SESSION_EXPIRED_OR_REVOKED' };
    }

    if (!(new Date(tokenRecord.expiresAt).getTime() > Date.now())) {
      return { status: 'TOKEN_EXPIRED' };
    }

    const user = session.user;
    if (!user || !user.isActive || user.role !== 'SUPER_ADMIN') {
      return { status: 'USER_INACTIVE' };
    }

    const now = Date.now();
    const newAccessExpiresAt = new Date(now + ACCESS_TOKEN_TTL_MS);
    const newRefreshExpiresAt = new Date(now + REFRESH_TOKEN_TTL_MS);

    const newAccessToken = generateOpaqueToken();
    const newRefreshToken = generateOpaqueToken();

    const nextGeneration = Number(session.refreshGeneration) + 1;
    session.refreshGeneration = nextGeneration;
    session.expiresAt = newRefreshExpiresAt;
    await session.save({ transaction });

    const newRefreshRecord = await identityModels.AdminRefreshToken.create({
      id: randomUUID(),
      sessionId: session.id,
      tokenHash: hashToken(newRefreshToken),
      generation: nextGeneration,
      expiresAt: newRefreshExpiresAt,
      usedAt: null,
      replacedBy: null
    }, { transaction });

    tokenRecord.usedAt = new Date();
    tokenRecord.replacedBy = newRefreshRecord.id;
    await tokenRecord.save({ transaction });

    await identityModels.AdminAccessToken.create({
      id: randomUUID(),
      sessionId: session.id,
      tokenHash: hashToken(newAccessToken),
      expiresAt: newAccessExpiresAt,
      revokedAt: null
    }, { transaction });

    await auditModels.AuditLog.create({
      id: randomUUID(),
      actorType: 'USER',
      actorUserId: user.id,
      action: 'ADMIN_TOKEN_REFRESH',
      afterJson: {
        email: user.email,
        sessionId: session.id,
        generation: nextGeneration
      },
      reason: 'Admin refresh token rotated',
      requestId: requestId || randomUUID(),
      occurredAt: new Date()
    }, { transaction });

    return {
      status: 'SUCCESS',
      accessToken: newAccessToken,
      accessExpiresAt: newAccessExpiresAt.toISOString(),
      refreshToken: newRefreshToken,
      refreshExpiresAt: newRefreshExpiresAt.toISOString(),
      user: {
        id: user.id,
        email: user.email,
        role: user.role
      }
    };
  });

  if (txResult.status === 'REUSE_COMMITTED') {
    throw new AuthError('Refresh token reuse detected; session has been revoked', 'UNAUTHENTICATED', 401);
  }

  if (txResult.status !== 'SUCCESS') {
    throw new AuthError('Session expired, revoked, or invalid', 'UNAUTHENTICATED', 401);
  }

  return {
    accessToken: txResult.accessToken,
    accessExpiresAt: txResult.accessExpiresAt,
    refreshToken: txResult.refreshToken,
    refreshExpiresAt: txResult.refreshExpiresAt,
    user: txResult.user
  };
}

/**
 * Idempotently revokes an admin session and associated access tokens.
 *
 * @param {object} params
 * @param {import('sequelize').Sequelize} params.sequelize
 * @param {string} [params.accessToken]
 * @param {string} [params.refreshToken]
 * @param {string} [params.requestId]
 * @returns {Promise<{ loggedOut: boolean }>}
 */
export async function logoutAdminSession({ sequelize, accessToken, refreshToken, requestId }) {
  if (!sequelize) {
    throw new Error('Sequelize instance is required for logout');
  }

  const identityModels = defineAdminIdentity(sequelize);
  const auditModels = defineAuthAudit(sequelize);
  let sessionToRevoke = null;

  if (accessToken && typeof accessToken === 'string') {
    const tokenHash = hashToken(accessToken.trim());
    const accessRecord = await identityModels.AdminAccessToken.findOne({
      where: { tokenHash },
      include: [{ model: identityModels.AdminSession, as: 'session' }]
    });
    if (accessRecord?.session) {
      sessionToRevoke = accessRecord.session;
    }
  }

  if (!sessionToRevoke && refreshToken && typeof refreshToken === 'string') {
    const tokenHash = hashToken(refreshToken.trim());
    const refreshRecord = await identityModels.AdminRefreshToken.findOne({
      where: { tokenHash },
      include: [{ model: identityModels.AdminSession, as: 'session' }]
    });
    if (refreshRecord?.session) {
      sessionToRevoke = refreshRecord.session;
    }
  }

  if (sessionToRevoke && !sessionToRevoke.revokedAt) {
    await sequelize.transaction(async (transaction) => {
      sessionToRevoke.revokedAt = new Date();
      sessionToRevoke.revokedReason = 'LOGOUT';
      await sessionToRevoke.save({ transaction });

      await identityModels.AdminAccessToken.update(
        { revokedAt: new Date() },
        { where: { sessionId: sessionToRevoke.id, revokedAt: null }, transaction }
      );

      await auditModels.AuditLog.create({
        id: randomUUID(),
        actorType: 'USER',
        actorUserId: sessionToRevoke.userId,
        action: 'ADMIN_LOGOUT',
        afterJson: { sessionId: sessionToRevoke.id },
        reason: 'Admin explicitly logged out',
        requestId: requestId || randomUUID(),
        occurredAt: new Date()
      }, { transaction });
    });
  }

  return { loggedOut: true };
}
