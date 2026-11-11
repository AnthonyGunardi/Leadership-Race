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
 * G11 final_results persistence.
 *
 * Requirements:
 * - Immutable final standing snapshot upon Finish Game.
 * - Score, position, rank, and is_winner per team.
 * - Enforces UNIQUE(game_id, team_id).
 * - Standard competition ranking: highest score tie results in shared rank 1 and is_winner=true.
 */
async function up(queryInterface) {
  await queryInterface.createTable('final_results', {
    id: id(),
    game_id: reference('games'),
    team_id: reference('teams'),
    score: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 0 },
    position: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false, defaultValue: 0 },
    rank: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    is_winner: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    ...timestamps()
  }, options);

  await queryInterface.addIndex('final_results', ['game_id', 'team_id'], { unique: true });
  await queryInterface.addIndex('final_results', ['game_id', 'rank']);
}

async function down(queryInterface) {
  await queryInterface.dropTable('final_results');
}

module.exports = { up, down };

