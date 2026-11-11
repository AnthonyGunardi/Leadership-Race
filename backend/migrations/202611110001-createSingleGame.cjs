const { DataTypes } = require('sequelize');

const options = { engine: 'InnoDB', charset: 'utf8mb4', collate: 'utf8mb4_unicode_ci' };
const reference = (table, allowNull = false) => ({
  type: 'CHAR(36) CHARACTER SET ascii COLLATE ascii_bin', allowNull,
  references: { model: table, key: 'id' }, onDelete: 'RESTRICT', onUpdate: 'RESTRICT'
});

/** Adds an operational pointer and immutable archive links without deleting any existing game data. */
async function up(queryInterface) {
  await queryInterface.createTable('single_game', {
    id: { type: DataTypes.TINYINT.UNSIGNED, primaryKey: true, allowNull: false },
    game_id: { ...reference('games', true), unique: true }
  }, options);
  await queryInterface.createTable('game_archives', {
    game_id: { ...reference('games'), primaryKey: true },
    next_game_id: { ...reference('games'), unique: true },
    archived_by: reference('users'),
    archived_at: { type: DataTypes.DATE(3), allowNull: false }
  }, options);
  await queryInterface.addIndex('game_archives', ['archived_by']);
  await queryInterface.addIndex('game_archives', ['archived_at']);
  // Adoption is deterministic; all other pre-existing games remain available to authenticated administrators.
  await queryInterface.sequelize.query(`INSERT INTO single_game (id, game_id)
    VALUES (1, (SELECT id FROM games ORDER BY updated_at DESC, id ASC LIMIT 1))`);
}

async function down(queryInterface) {
  await queryInterface.dropTable('game_archives');
  await queryInterface.dropTable('single_game');
}

module.exports = { up, down };
