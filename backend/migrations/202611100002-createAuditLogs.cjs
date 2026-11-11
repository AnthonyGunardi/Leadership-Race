const { DataTypes } = require('sequelize');

const tableOptions = { engine: 'InnoDB', charset: 'utf8mb4', collate: 'utf8mb4_unicode_ci' };
const uuidType = 'CHAR(36) CHARACTER SET ascii COLLATE ascii_bin';
const identity = () => ({ type: uuidType, allowNull: false, primaryKey: true });
const timestamps = () => ({
  created_at: { type: DataTypes.DATE(3), allowNull: false },
  updated_at: { type: DataTypes.DATE(3), allowNull: false }
});
const reference = (table, allowNull = false) => ({
  type: uuidType,
  allowNull,
  ...(allowNull ? { defaultValue: null } : {}),
  references: { model: table, key: 'id' },
  onDelete: 'RESTRICT',
  onUpdate: 'RESTRICT'
});

/**
 * Adds the additive audit_logs table for auth and system audit trails (ADR-003).
 * game_id is nullable without FK to games because games are introduced in G3.
 *
 * Source: https://sequelize.org/docs/v6/other-topics/migrations/
 */
async function up(queryInterface) {
  await queryInterface.createTable('audit_logs', {
    id: identity(),
    game_id: {
      type: uuidType,
      allowNull: true,
      defaultValue: null
    },
    actor_type: {
      type: DataTypes.ENUM('USER', 'SYSTEM'),
      allowNull: false,
      defaultValue: 'USER'
    },
    actor_user_id: reference('users', true),
    action: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    before_json: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: null
    },
    after_json: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: null
    },
    reason: {
      type: DataTypes.STRING(255),
      allowNull: true,
      defaultValue: null
    },
    request_id: {
      type: uuidType,
      allowNull: true,
      defaultValue: null
    },
    occurred_at: {
      type: DataTypes.DATE(3),
      allowNull: false
    },
    ...timestamps()
  }, tableOptions);

  await queryInterface.addIndex('audit_logs', ['game_id', 'occurred_at', 'id']);
  await queryInterface.addIndex('audit_logs', ['actor_user_id', 'occurred_at', 'id']);
  await queryInterface.addIndex('audit_logs', ['request_id']);
  await queryInterface.addIndex('audit_logs', ['game_id', 'action', 'occurred_at', 'id']);
}

/** Refuses destructive rollback outside an explicitly disposable test schema. */
async function down(queryInterface) {
  if (!/^lr_test_[a-zA-Z0-9_]+$/.test(queryInterface.sequelize.getDatabaseName())) {
    throw new Error('Audit rollback requires an isolated lr_test_* database');
  }
  await queryInterface.dropTable('audit_logs');
}

module.exports = { up, down };

