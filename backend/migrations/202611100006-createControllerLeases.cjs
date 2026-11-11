const { DataTypes } = require('sequelize');
const uuid = 'CHAR(36) CHARACTER SET ascii COLLATE ascii_bin';

/** One persistent row per game; game lock serializes even the initial claim when no lease row exists. */
async function up(queryInterface) {
  await queryInterface.createTable('controller_leases', {
    game_id: { type: uuid, primaryKey: true, allowNull: false,
      references: { model: 'games', key: 'id' }, onDelete: 'RESTRICT', onUpdate: 'RESTRICT' },
    holder_user_id: { type: uuid, allowNull: false,
      references: { model: 'users', key: 'id' }, onDelete: 'RESTRICT', onUpdate: 'RESTRICT' },
    lease_token_hash: { type: DataTypes.CHAR(64), allowNull: false },
    expires_at: { type: DataTypes.DATE(3), allowNull: false },
    version: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 1 },
    created_at: { type: DataTypes.DATE(3), allowNull: false },
    updated_at: { type: DataTypes.DATE(3), allowNull: false }
  }, { engine: 'InnoDB', charset: 'utf8mb4', collate: 'utf8mb4_unicode_ci' });
  await queryInterface.addIndex('controller_leases', ['holder_user_id']);
  await queryInterface.addIndex('controller_leases', ['expires_at']);
}

/** Event/development schema rollback must retain controller state and command history. */
async function down(queryInterface) {
  if (!/^lr_test_[a-zA-Z0-9_]+$/.test(queryInterface.sequelize.getDatabaseName())) {
    throw new Error('Controller lease rollback requires an isolated lr_test_* database');
  }
  await queryInterface.dropTable('controller_leases');
}

module.exports = { up, down };
