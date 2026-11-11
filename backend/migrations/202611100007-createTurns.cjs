const { DataTypes } = require('sequelize');

const options = { engine: 'InnoDB', charset: 'utf8mb4', collate: 'utf8mb4_unicode_ci' };
const uuid = 'CHAR(36) CHARACTER SET ascii COLLATE ascii_bin';
const id = () => ({ type: uuid, allowNull: false, primaryKey: true });
const reference = (table, allowNull = false) => ({
  type: uuid, allowNull, ...(allowNull ? { defaultValue: null } : {}),
  references: { model: table, key: 'id' }, onDelete: 'RESTRICT', onUpdate: 'RESTRICT'
});
const counter = () => ({ type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 0 });
const date = (allowNull = false) => ({
  type: DataTypes.DATE(3), allowNull, ...(allowNull ? { defaultValue: null } : {})
});
const json = () => ({ type: DataTypes.JSON, allowNull: false });
const timestamps = () => ({ created_at: date(), updated_at: date() });

/** G7 turns persistence stores pure engine movement paths, database UTC timing, and worker settlement index. */
async function up(queryInterface) {
  await queryInterface.createTable('turns', {
    id: id(),
    game_id: reference('games'),
    turn_number: counter(),
    team_id: reference('teams'),
    dice_value: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false },
    from_position: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false },
    landing_cell: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false },
    final_position: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false },
    status: {
      type: DataTypes.ENUM('ANIMATING', 'AWAITING_RESULT', 'RESOLVING_PENALTY', 'COMPLETED', 'VOIDED'),
      allowNull: false, defaultValue: 'ANIMATING'
    },
    requires_challenge: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    dice_path: json(),
    penalty_path: json(),
    full_path: json(),
    step_duration_ms: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 450 },
    movement_started_at: date(),
    movement_ends_at: date(),
    resolved_at: date(true),
    voided_at: date(true),
    voided_by: reference('users', true),
    void_reason: { type: DataTypes.TEXT, allowNull: true, defaultValue: null },
    ...timestamps()
  }, options);

  await queryInterface.addIndex('turns', ['game_id', 'id'], { unique: true });
  await queryInterface.addIndex('turns', ['game_id', 'turn_number'], { unique: true });
  await queryInterface.addIndex('turns', ['status', 'movement_ends_at', 'game_id']);
  await queryInterface.addIndex('turns', ['game_id', 'team_id']);

  await queryInterface.addConstraint('turns', {
    fields: ['game_id', 'team_id'],
    type: 'foreign key',
    name: 'turns_game_team_scope',
    references: { table: 'teams', fields: ['game_id', 'id'] },
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT'
  });
}

/** Rollback requires an isolated disposable lr_test_* database to preserve event history. */
async function down(queryInterface) {
  if (!/^lr_test_[a-zA-Z0-9_]+$/.test(queryInterface.sequelize.getDatabaseName())) {
    throw new Error('Turns rollback requires an isolated lr_test_* database');
  }
  await queryInterface.dropTable('turns');
}

module.exports = { up, down };

