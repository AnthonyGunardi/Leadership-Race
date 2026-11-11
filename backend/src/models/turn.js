import { DataTypes } from 'sequelize';

const identity = () => ({
  type: DataTypes.CHAR(36), primaryKey: true, allowNull: false, defaultValue: DataTypes.UUIDV4
});
const uuid = (allowNull = false) => ({
  type: DataTypes.CHAR(36), allowNull, ...(allowNull ? { defaultValue: null } : {})
});
const date = (allowNull = false) => ({
  type: DataTypes.DATE(3), allowNull, ...(allowNull ? { defaultValue: null } : {})
});
const counter = () => ({ type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 0 });
const timestamps = () => ({ createdAt: date(), updatedAt: date() });

/** MariaDB's mysql2 compatibility returns JSON strings; normalize at the persistence boundary. */
function jsonField(field, allowNull = false) {
  return {
    type: DataTypes.JSON, allowNull, ...(allowNull ? { defaultValue: null } : {}),
    get() {
      const value = this.getDataValue(field);
      return typeof value === 'string' ? JSON.parse(value) : value;
    }
  };
}

/** Defines the Turn persistence model with pure engine paths and database UTC deadlines. */
export function defineTurn(sequelize) {
  if (sequelize.models.Turn) return sequelize.models.Turn;
  const common = { underscored: true, timestamps: true };
  return sequelize.define('Turn', {
    id: identity(),
    gameId: uuid(),
    turnNumber: counter(),
    teamId: uuid(),
    diceValue: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false },
    fromPosition: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false },
    landingCell: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false },
    finalPosition: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false },
    status: {
      type: DataTypes.ENUM('ANIMATING', 'AWAITING_RESULT', 'RESOLVING_PENALTY', 'COMPLETED', 'VOIDED'),
      allowNull: false, defaultValue: 'ANIMATING'
    },
    requiresChallenge: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    dicePath: jsonField('dicePath'),
    penaltyPath: jsonField('penaltyPath'),
    fullPath: jsonField('fullPath'),
    stepDurationMs: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 450 },
    movementStartedAt: date(),
    movementEndsAt: date(),
    resolvedAt: date(true),
    voidedAt: date(true),
    voidedBy: uuid(true),
    voidReason: { type: DataTypes.TEXT, allowNull: true, defaultValue: null },
    ...timestamps()
  }, {
    ...common,
    tableName: 'turns',
    indexes: [
      { fields: ['game_id', 'id'], unique: true },
      { fields: ['game_id', 'turn_number'], unique: true },
      { fields: ['status', 'movement_ends_at', 'game_id'] },
      { fields: ['game_id', 'team_id'] }
    ]
  });
}

