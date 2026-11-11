import { randomUUID } from 'node:crypto';
import { defineAdminIdentity } from '../models/adminIdentity.js';
import { defineAuthAudit } from '../models/authAudit.js';
import { validateCredentials, hashPassword } from './adminCredentials.js';

/**
 * Bootstraps a local Super Admin account and an accompanying audit record in an atomic transaction.
 * Enforces email normalization, password bounds (8..72 bytes), uniqueness, and secret redaction.
 *
 * @param {object} params
 * @param {import('sequelize').Sequelize} params.sequelize
 * @param {string} params.email
 * @param {string} params.password
 * @param {string} [params.requestId]
 * @returns {Promise<{ id: string, email: string, role: string }>}
 * @throws {Error} If credentials are invalid, email exists, or persistence fails
 */
export async function bootstrapAdminUser({ sequelize, email, password, requestId }) {
  if (!sequelize) {
    throw new Error('Sequelize instance is required for bootstrap');
  }

  const validated = validateCredentials({ email, password });
  const models = {
    ...defineAdminIdentity(sequelize),
    ...defineAuthAudit(sequelize)
  };

  const passwordHash = await hashPassword(validated.password);

  return sequelize.transaction(async (transaction) => {
    const existing = await models.User.findOne({
      where: { email: validated.email },
      transaction
    });

    if (existing) {
      throw new Error(`Admin user with email "${validated.email}" already exists`);
    }

    const userId = randomUUID();
    const user = await models.User.create({
      id: userId,
      email: validated.email,
      passwordHash,
      role: 'SUPER_ADMIN',
      isActive: true
    }, { transaction });

    await models.AuditLog.create({
      id: randomUUID(),
      actorType: 'USER',
      actorUserId: user.id,
      action: 'ADMIN_BOOTSTRAP',
      afterJson: {
        email: validated.email,
        role: 'SUPER_ADMIN'
      },
      reason: 'Initial local administrator bootstrap',
      requestId: requestId || randomUUID(),
      occurredAt: new Date()
    }, { transaction });

    return {
      id: user.id,
      email: user.email,
      role: user.role
    };
  });
}

