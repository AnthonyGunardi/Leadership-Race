const { DataTypes, Op } = require('sequelize');
const options = { engine: 'InnoDB', charset: 'utf8mb4', collate: 'utf8mb4_unicode_ci' };
const uuid = 'CHAR(36) CHARACTER SET ascii COLLATE ascii_bin';
const id = () => ({ type: uuid, primaryKey: true, allowNull: false });
const reference = (table, allowNull = false) => ({
  type: uuid, allowNull, ...(allowNull ? { defaultValue: null } : {}),
  references: { model: table, key: 'id' }, onDelete: 'RESTRICT', onUpdate: 'RESTRICT'
});
const date = (allowNull = false) => ({
  type: DataTypes.DATE(3), allowNull, ...(allowNull ? { defaultValue: null } : {})
});
const timestamps = () => ({ created_at: date(), updated_at: date() });

/** Adds hashed display credentials and durable failed-attempt counters without touching event data. */
async function up(queryInterface) {
  await queryInterface.createTable('display_pairing_codes', {
    id: id(), game_id: reference('games'), issued_by: reference('users'),
    code_hmac: { type: DataTypes.CHAR(64), allowNull: false }, expires_at: date(),
    failed_attempts: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false, defaultValue: 0 },
    consumed_at: date(true), revoked_at: date(true),
    label: { type: DataTypes.STRING(100), allowNull: true, defaultValue: null }, ...timestamps()
  }, options);
  await queryInterface.addIndex('display_pairing_codes', ['game_id', 'created_at']);
  await queryInterface.addIndex('display_pairing_codes', ['issued_by']);
  await queryInterface.addIndex('display_pairing_codes', ['expires_at']);
  await queryInterface.addConstraint('display_pairing_codes', {
    fields: ['failed_attempts'], type: 'check', name: 'display_pairing_attempt_range',
    where: { failed_attempts: { [Op.between]: [0, 5] } }
  });
  await queryInterface.createTable('display_tokens', {
    id: id(), game_id: reference('games'), issued_by: reference('users'),
    token_hash: { type: DataTypes.CHAR(64), allowNull: false, unique: true },
    expires_at: date(), revoked_at: date(true), renewed_at: date(true), renewed_by: reference('users', true),
    label: { type: DataTypes.STRING(100), allowNull: true, defaultValue: null },
    version: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 1 }, ...timestamps()
  }, options);
  for (const fields of [['game_id', 'expires_at'], ['issued_by'], ['renewed_by']]) {
    await queryInterface.addIndex('display_tokens', fields);
  }
  await queryInterface.createTable('display_pairing_limits', {
    key_hash: { type: DataTypes.CHAR(64), primaryKey: true, allowNull: false },
    failed_attempts: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    window_started_at: date(), ...timestamps()
  }, options);
}

/** Rollback is permitted only for disposable tests, never for event credentials or history in use. */
async function down(queryInterface) {
  if (!/^lr_test_[a-zA-Z0-9_]+$/.test(queryInterface.sequelize.getDatabaseName())) {
    throw new Error('Display rollback requires an isolated lr_test_* database');
  }
  await queryInterface.dropTable('display_pairing_limits');
  await queryInterface.dropTable('display_tokens');
  await queryInterface.dropTable('display_pairing_codes');
}

module.exports = { up, down };
