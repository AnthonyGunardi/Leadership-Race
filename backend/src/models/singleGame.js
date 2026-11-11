import { DataTypes } from 'sequelize';

/** The singleton pointer chooses the only public game; archive links preserve each reset's original records. */
export function defineSingleGame(sequelize) {
  if (sequelize.models.SingleGame) return sequelize.models;
  const uuid = () => ({ type: DataTypes.CHAR(36), allowNull: false });
  sequelize.define('SingleGame', {
    id: { type: DataTypes.TINYINT.UNSIGNED, primaryKey: true, allowNull: false },
    gameId: { type: DataTypes.CHAR(36), allowNull: true, defaultValue: null, unique: true }
  }, { tableName: 'single_game', underscored: true, timestamps: false });
  sequelize.define('GameArchive', {
    gameId: { ...uuid(), primaryKey: true }, nextGameId: { ...uuid(), unique: true }, archivedBy: uuid(),
    archivedAt: { type: DataTypes.DATE(3), allowNull: false }
  }, { tableName: 'game_archives', underscored: true, timestamps: false,
    indexes: [{ fields: ['archived_by'] }, { fields: ['archived_at'] }] });
  return sequelize.models;
}
