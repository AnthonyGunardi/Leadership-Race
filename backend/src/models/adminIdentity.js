import { DataTypes } from 'sequelize';

const identity = () => ({
  type: DataTypes.CHAR(36),
  allowNull: false,
  primaryKey: true,
  defaultValue: DataTypes.UUIDV4,
  validate: { isUUID: 4, is: /^[a-f0-9-]{36}$/ }
});
const requiredDate = () => ({ type: DataTypes.DATE(3), allowNull: false });
const nullableDate = () => ({ type: DataTypes.DATE(3), allowNull: true, defaultValue: null });
const generation = () => ({
  type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 0,
  validate: { min: 0, max: Number.MAX_SAFE_INTEGER, isInt: true }
});
const reference = (table, allowNull = false) => ({
  type: DataTypes.CHAR(36),
  allowNull,
  ...(allowNull ? { defaultValue: null } : {}),
  references: { model: table, key: 'id' },
  validate: { isUUID: 4, is: /^[a-f0-9-]{36}$/ }
});
const tokenHash = () => ({
  type: DataTypes.CHAR(64), allowNull: false, unique: true, validate: { is: /^[a-f0-9]{64}$/ }
});

/**
 * Defines persistence only: auth services own normalization, hashing, expiry, and transaction policy.
 * No sync/alter or hooks run here; deployed tables are managed by additive migrations.
 * Source: https://sequelize.org/docs/v6/core-concepts/model-basics/#model-definition
 */
export function defineAdminIdentity(sequelize) {
  if (sequelize.models.User && sequelize.models.AdminSession
    && sequelize.models.AdminRefreshToken && sequelize.models.AdminAccessToken) {
    return {
      User: sequelize.models.User,
      AdminSession: sequelize.models.AdminSession,
      AdminRefreshToken: sequelize.models.AdminRefreshToken,
      AdminAccessToken: sequelize.models.AdminAccessToken
    };
  }
  const options = { timestamps: true, underscored: true, createdAt: 'createdAt', updatedAt: 'updatedAt' };
  const timestamps = { createdAt: requiredDate(), updatedAt: requiredDate() };
  const User = sequelize.define('User', {
    id: identity(),
    email: {
      type: DataTypes.STRING(254), allowNull: false, unique: true,
      validate: { isEmail: true, is: /^[^\sA-Z]+$/ }
    },
    passwordHash: {
      type: DataTypes.CHAR(60), allowNull: false,
      validate: { is: /^\$2[aby]\$(1[2-9]|2\d|3[01])\$[./A-Za-z0-9]{53}$/ }
    },
    role: {
      type: DataTypes.ENUM('SUPER_ADMIN'), allowNull: false, defaultValue: 'SUPER_ADMIN',
      validate: { isIn: [['SUPER_ADMIN']] }
    },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    ...timestamps
  }, { ...options, tableName: 'users' });

  const AdminSession = sequelize.define('AdminSession', {
    id: identity(),
    userId: reference('users'),
    expiresAt: requiredDate(),
    revokedAt: nullableDate(),
    revokedReason: { type: DataTypes.STRING(100), allowNull: true, defaultValue: null },
    refreshGeneration: { ...generation(), defaultValue: 0 },
    ...timestamps
  }, { ...options, tableName: 'admin_sessions', indexes: [{ fields: ['user_id', 'expires_at'] }] });

  const AdminRefreshToken = sequelize.define('AdminRefreshToken', {
    id: identity(),
    sessionId: reference('admin_sessions'),
    tokenHash: tokenHash(),
    generation: generation(),
    expiresAt: requiredDate(),
    usedAt: nullableDate(),
    replacedBy: reference('admin_refresh_tokens', true),
    ...timestamps
  }, {
    ...options, tableName: 'admin_refresh_tokens',
    indexes: [
      { unique: true, fields: ['session_id', 'generation'] },
      { fields: ['expires_at'] },
      { fields: ['replaced_by'] }
    ]
  });

  const AdminAccessToken = sequelize.define('AdminAccessToken', {
    id: identity(),
    sessionId: reference('admin_sessions'),
    tokenHash: tokenHash(),
    expiresAt: requiredDate(),
    revokedAt: nullableDate(),
    ...timestamps
  }, { ...options, tableName: 'admin_access_tokens', indexes: [{ fields: ['session_id', 'expires_at'] }] });

  const foreignKeyOptions = { onDelete: 'RESTRICT', onUpdate: 'RESTRICT' };
  AdminSession.belongsTo(User, { ...foreignKeyOptions, foreignKey: 'userId', as: 'user' });
  AdminRefreshToken.belongsTo(AdminSession, { ...foreignKeyOptions, foreignKey: 'sessionId', as: 'session' });
  AdminAccessToken.belongsTo(AdminSession, { ...foreignKeyOptions, foreignKey: 'sessionId', as: 'session' });
  AdminRefreshToken.belongsTo(AdminRefreshToken, {
    ...foreignKeyOptions, foreignKey: 'replacedBy', as: 'replacement'
  });

  return { User, AdminSession, AdminRefreshToken, AdminAccessToken };
}
