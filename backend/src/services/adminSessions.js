import { defineAdminIdentity } from '../models/adminIdentity.js';
import { hashToken, AuthError } from './adminAuth.js';

/**
 * Authorizes against current durable state on every call, without sliding any expiry.
 * Shared REST/G4 boundary: no cached identity may authorize a later command or outbound delivery.
 * Database failures deny access with a sanitized error; credentials and query details never escape.
 *
 * @param {{sequelize: import('sequelize').Sequelize, accessToken: string}} params
 * @returns {Promise<{user: object, session: object, accessTokenRecord: object}>}
 */
export async function authorizeAdminAccess({ sequelize, accessToken }) {
  if (typeof accessToken !== 'string' || !accessToken.trim()) {
    throw new AuthError('Authorization bearer token is required');
  }
  const models = defineAdminIdentity(sequelize);
  let accessRecord;
  try {
    accessRecord = await models.AdminAccessToken.findOne({
      where: { tokenHash: hashToken(accessToken.trim()) },
      include: [{ model: models.AdminSession, as: 'session',
        include: [{ model: models.User, as: 'user' }] }]
    });
  } catch {
    throw new AuthError('Session authorization is unavailable', 'SERVICE_UNAVAILABLE', 503);
  }
  if (!accessRecord) {
    throw new AuthError('Invalid access token');
  }
  if (accessRecord.revokedAt) {
    throw new AuthError('Access token has been revoked');
  }
  const now = Date.now();
  if (!(new Date(accessRecord.expiresAt).getTime() > now)) {
    throw new AuthError('Access token has expired');
  }
  const session = accessRecord.session;
  if (!session) {
    throw new AuthError('Session not found');
  }
  if (session.revokedAt) {
    throw new AuthError('Admin session has been revoked');
  }
  if (!(new Date(session.expiresAt).getTime() > now)) {
    throw new AuthError('Admin session has expired');
  }
  const user = session.user;
  if (!user || !user.isActive) {
    throw new AuthError('Admin account is inactive or not found');
  }
  if (user.role !== 'SUPER_ADMIN') {
    throw new AuthError('Insufficient permissions', 'FORBIDDEN', 403);
  }
  return {
    user: { id: user.id, email: user.email, role: user.role },
    session: { id: session.id, expiresAt: session.expiresAt },
    accessTokenRecord: accessRecord
  };
}
