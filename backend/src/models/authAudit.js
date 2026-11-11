import { DataTypes } from 'sequelize';

const identity = () => ({
  type: DataTypes.CHAR(36),
  allowNull: false,
  primaryKey: true,
  defaultValue: DataTypes.UUIDV4,
  validate: { isUUID: 4, is: /^[a-f0-9-]{36}$/ }
});

const nullableUuid = (references) => ({
  type: DataTypes.CHAR(36),
  allowNull: true,
  defaultValue: null,
  ...(references ? { references: { model: references, key: 'id' } } : {}),
  validate: {
    isNullableUuid(value) {
      if (value !== null && value !== undefined && !/^[a-f0-9-]{36}$/.test(value)) {
        throw new Error('Value must be a valid lowercase UUID v4');
      }
    }
  }
});

const requiredDate = () => ({ type: DataTypes.DATE(3), allowNull: false });

/**
 * Defines persistence for audit_logs (ADR-003).
 * Captures actor, action, before/after JSON, reason, request_id, and occurred_at.
 * Redaction is enforced at caller/service boundaries; models define persistence constraints only.
 *
 * Source: https://sequelize.org/docs/v6/core-concepts/model-basics/
 */
export function defineAuthAudit(sequelize) {
  if (sequelize.models.AuditLog) {
    return { AuditLog: sequelize.models.AuditLog };
  }
  const options = {
    timestamps: true,
    underscored: true,
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };
  const timestamps = { createdAt: requiredDate(), updatedAt: requiredDate() };

  const AuditLog = sequelize.define('AuditLog', {
    id: identity(),
    gameId: nullableUuid(),
    actorType: {
      type: DataTypes.ENUM('USER', 'SYSTEM'),
      allowNull: false,
      defaultValue: 'USER',
      validate: { isIn: [['USER', 'SYSTEM']] }
    },
    actorUserId: nullableUuid('users'),
    action: {
      type: DataTypes.STRING(100),
      allowNull: false,
      validate: { notEmpty: true }
    },
    beforeJson: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: null,
      get() {
        const raw = this.getDataValue('beforeJson');
        if (typeof raw === 'string') {
          try {
            return JSON.parse(raw);
          } catch {
            return raw;
          }
        }
        return raw;
      }
    },
    afterJson: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: null,
      get() {
        const raw = this.getDataValue('afterJson');
        if (typeof raw === 'string') {
          try {
            return JSON.parse(raw);
          } catch {
            return raw;
          }
        }
        return raw;
      }
    },
    reason: {
      type: DataTypes.STRING(255),
      allowNull: true,
      defaultValue: null
    },
    requestId: nullableUuid(),
    occurredAt: requiredDate(),
    ...timestamps
  }, {
    ...options,
    tableName: 'audit_logs',
    indexes: [
      { fields: ['game_id', 'occurred_at', 'id'] },
      { fields: ['actor_user_id', 'occurred_at', 'id'] },
      { fields: ['request_id'] },
      { fields: ['game_id', 'action', 'occurred_at', 'id'] }
    ],
    validate: {
      actorConsistency() {
        if (this.actorType === 'SYSTEM' && this.actorUserId !== null && this.actorUserId !== undefined) {
          throw new Error('SYSTEM actor must have null actor_user_id');
        }
        if (this.actorType === 'USER' && (this.actorUserId === null || this.actorUserId === undefined)) {
          throw new Error('USER actor must specify actor_user_id');
        }
      }
    }
  });

  if (sequelize.models.User) {
    AuditLog.belongsTo(sequelize.models.User, {
      foreignKey: 'actorUserId',
      as: 'actorUser',
      onDelete: 'RESTRICT',
      onUpdate: 'RESTRICT'
    });
  }

  return { AuditLog };
}
