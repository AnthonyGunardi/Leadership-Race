/** Links games(id, active_turn_id) to turns(game_id, id) for cross-game isolation. */
async function up(queryInterface) {
  await queryInterface.addConstraint('games', {
    fields: ['id', 'active_turn_id'],
    type: 'foreign key',
    name: 'games_active_turn_scope',
    references: { table: 'turns', fields: ['game_id', 'id'] },
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT'
  });
}

/** Rollback requires an isolated disposable lr_test_* database to preserve event history. */
async function down(queryInterface) {
  if (!/^lr_test_[a-zA-Z0-9_]+$/.test(queryInterface.sequelize.getDatabaseName())) {
    throw new Error('Active turn constraint rollback requires an isolated lr_test_* database');
  }
  await queryInterface.removeConstraint('games', 'games_active_turn_scope');
}

module.exports = { up, down };

