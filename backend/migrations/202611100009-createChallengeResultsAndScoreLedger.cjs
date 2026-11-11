const { DataTypes } = require('sequelize');

const options = { engine: 'InnoDB', charset: 'utf8mb4', collate: 'utf8mb4_unicode_ci' };
const uuid = 'CHAR(36) CHARACTER SET ascii COLLATE ascii_bin';
const id = () => ({ type: uuid, allowNull: false, primaryKey: true });
const reference = (table, allowNull = false) => ({
  type: uuid, allowNull, ...(allowNull ? { defaultValue: null } : {}),
  references: { model: table, key: 'id' }, onDelete: 'RESTRICT', onUpdate: 'RESTRICT'
});
const date = (allowNull = false) => ({
  type: DataTypes.DATE(3), allowNull, ...(allowNull ? { defaultValue: null } : {})
});
const timestamps = () => ({ created_at: date(), updated_at: date() });

/**
 * G9 challenge_results and score_ledger persistence.
 *
 * Requirements:
 * - Exactly one challenge_results per turn (enforced by UNIQUE(turn_id)).
 * - Outcome is NULL for MANUAL; manual_points is NULL for BUTTON.
 * - Score ledger stores immutable delta points for awarded_points > 0.
 * - Result with 0 awarded points does NOT write a zero delta ledger.
 * - Ledger entries are never updated or deleted; corrections create compensatory entries.
 */
async function up(queryInterface) {
  await queryInterface.createTable('challenge_results', {
    id: id(),
    game_id: reference('games'),
    turn_id: reference('turns'),
    board_cell_id: reference('board_cells', true),
    team_id: reference('teams'),
    scoring_method: { type: DataTypes.ENUM('BUTTON', 'MANUAL'), allowNull: false },
    outcome: { type: DataTypes.ENUM('SUCCESS', 'FAIL'), allowNull: true, defaultValue: null },
    manual_points: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, defaultValue: null },
    awarded_points: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    note: { type: DataTypes.TEXT, allowNull: true, defaultValue: null },
    actor_user_id: reference('users'),
    ...timestamps()
  }, options);

  await queryInterface.addIndex('challenge_results', ['turn_id'], { unique: true });
  await queryInterface.addIndex('challenge_results', ['game_id', 'id']);
  await queryInterface.addIndex('challenge_results', ['game_id', 'team_id']);
  await queryInterface.addIndex('challenge_results', ['actor_user_id']);

  await queryInterface.createTable('score_ledger', {
    id: id(),
    game_id: reference('games'),
    team_id: reference('teams'),
    turn_id: reference('turns', true),
    challenge_result_id: reference('challenge_results', true),
    delta_points: { type: DataTypes.INTEGER, allowNull: false },
    source: {
      type: DataTypes.ENUM('CHALLENGE_BUTTON', 'CHALLENGE_MANUAL', 'CORRECTION'),
      allowNull: false
    },
    reason: { type: DataTypes.STRING(255), allowNull: true, defaultValue: null },
    actor_user_id: reference('users'),
    compensates_entry_id: reference('score_ledger', true),
    ...timestamps()
  }, options);

  await queryInterface.addIndex('score_ledger', ['game_id', 'team_id', 'created_at', 'id']);
  await queryInterface.addIndex('score_ledger', ['challenge_result_id'], { unique: true });
  await queryInterface.addIndex('score_ledger', ['turn_id']);
  await queryInterface.addIndex('score_ledger', ['actor_user_id']);
  await queryInterface.addIndex('score_ledger', ['compensates_entry_id']);
}

/** Rollback requires an isolated disposable lr_test_* database to preserve event history. */
async function down(queryInterface) {
  if (!/^lr_test_[a-zA-Z0-9_]+$/.test(queryInterface.sequelize.getDatabaseName())) {
    throw new Error('Scoring rollback requires an isolated lr_test_* database');
  }
  await queryInterface.dropTable('score_ledger');
  await queryInterface.dropTable('challenge_results');
}

module.exports = { up, down };

