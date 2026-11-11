const { DataTypes } = require('sequelize');

const tableOptions = { engine: 'InnoDB', charset: 'utf8mb4', collate: 'utf8mb4_unicode_ci' };
// Sequelize 6 does not expose per-column charset options; static DDL keeps every UUID FK identical (ADR-003).
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
const nullableDate = () => ({ type: DataTypes.DATE(3), allowNull: true, defaultValue: null });

/**
 * Adds only G2 identity stores; DDL is deliberately sequential because MySQL implicitly commits it.
 * Source: https://sequelize.org/docs/v6/other-topics/migrations/
 */
async function up(queryInterface) {
  await queryInterface.createTable('users', {
    id: identity(),
    email: { type: DataTypes.STRING(254), allowNull: false, unique: true },
    password_hash: { type: DataTypes.CHAR(60), allowNull: false },
    role: { type: DataTypes.ENUM('SUPER_ADMIN'), allowNull: false, defaultValue: 'SUPER_ADMIN' },
    is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    ...timestamps()
  }, tableOptions);

  await queryInterface.createTable('admin_sessions', {
    id: identity(),
    user_id: reference('users'),
    expires_at: { type: DataTypes.DATE(3), allowNull: false },
    revoked_at: nullableDate(),
    revoked_reason: { type: DataTypes.STRING(100), allowNull: true, defaultValue: null },
    refresh_generation: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 0 },
    ...timestamps()
  }, tableOptions);
  await queryInterface.addIndex('admin_sessions', ['user_id', 'expires_at']);

  await queryInterface.createTable('admin_refresh_tokens', {
    id: identity(),
    session_id: reference('admin_sessions'),
    token_hash: { type: DataTypes.CHAR(64), allowNull: false, unique: true },
    generation: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 0 },
    expires_at: { type: DataTypes.DATE(3), allowNull: false },
    used_at: nullableDate(),
    replaced_by: reference('admin_refresh_tokens', true),
    ...timestamps()
  }, tableOptions);
  await queryInterface.addIndex('admin_refresh_tokens', ['session_id', 'generation'], { unique: true });
  await queryInterface.addIndex('admin_refresh_tokens', ['expires_at']);
  await queryInterface.addIndex('admin_refresh_tokens', ['replaced_by']);

  await queryInterface.createTable('admin_access_tokens', {
    id: identity(),
    session_id: reference('admin_sessions'),
    token_hash: { type: DataTypes.CHAR(64), allowNull: false, unique: true },
    expires_at: { type: DataTypes.DATE(3), allowNull: false },
    revoked_at: nullableDate(),
    ...timestamps()
  }, tableOptions);
  await queryInterface.addIndex('admin_access_tokens', ['session_id', 'expires_at']);
}

/** Refuses destructive rollback outside an explicitly disposable test schema. */
async function down(queryInterface) {
  if (!/^lr_test_[a-zA-Z0-9_]+$/.test(queryInterface.sequelize.getDatabaseName())) {
    throw new Error('Identity rollback requires an isolated lr_test_* database');
  }
  await queryInterface.dropTable('admin_access_tokens');
  await queryInterface.dropTable('admin_refresh_tokens');
  await queryInterface.dropTable('admin_sessions');
  await queryInterface.dropTable('users');
}

module.exports = { up, down };
