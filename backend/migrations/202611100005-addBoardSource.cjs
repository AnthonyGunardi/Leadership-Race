const { DataTypes } = require('sequelize');

/** Provenance follows each game so a prototype transcription cannot silently appear to be an approved workbook. */
async function up(queryInterface) {
  await queryInterface.addColumn('games', 'board_source', {
    type: DataTypes.ENUM('CUSTOM', 'PRD_APPENDIX_A', 'JSON_IMPORT'), allowNull: false, defaultValue: 'CUSTOM'
  });
}

/** Removing provenance is allowed only while cleaning disposable test data. */
async function down(queryInterface) {
  if (!/^lr_test_[a-zA-Z0-9_]+$/.test(queryInterface.sequelize.getDatabaseName())) {
    throw new Error('Board provenance rollback requires an isolated lr_test_* database');
  }
  await queryInterface.removeColumn('games', 'board_source');
}

module.exports = { up, down };
