import { DataTypes } from 'sequelize';

/** Persistence schema only; the migration owns FK constraints and the game primary key enforces one holder. */
export function defineControllerLease(sequelize) {
  if (!sequelize.models.ControllerLease) {
    sequelize.define('ControllerLease', {
      gameId: { type: DataTypes.CHAR(36), primaryKey: true, allowNull: false },
      holderUserId: { type: DataTypes.CHAR(36), allowNull: false },
      leaseTokenHash: { type: DataTypes.CHAR(64), allowNull: false },
      expiresAt: { type: DataTypes.DATE(3), allowNull: false },
      version: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 1 },
      createdAt: { type: DataTypes.DATE(3), allowNull: false },
      updatedAt: { type: DataTypes.DATE(3), allowNull: false }
    }, { tableName: 'controller_leases', underscored: true, timestamps: true,
      indexes: [{ fields: ['holder_user_id'] }, { fields: ['expires_at'] }] });
  }
  return sequelize.models.ControllerLease;
}
