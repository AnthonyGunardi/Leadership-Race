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
const timestamps = () => ({ createdAt: date(), updatedAt: date() });

/**
 * Defines ChallengeResult and ScoreLedger persistence models.
 *
 * Invariants:
 * - Exactly one ChallengeResult per turn.
 * - ScoreLedger records immutable delta points; zero-point results produce no ledger row.
 * - total_score on Team is synchronized with SUM(delta_points).
 *
 * @param {import('sequelize').Sequelize} sequelize Sequelize instance.
 * @returns {{ ChallengeResult: object, ScoreLedger: object }}
 */
export function defineScoring(sequelize) {
  if (sequelize.models.ChallengeResult && sequelize.models.ScoreLedger && sequelize.models.FinalResult) {
    return {
      ChallengeResult: sequelize.models.ChallengeResult,
      ScoreLedger: sequelize.models.ScoreLedger,
      FinalResult: sequelize.models.FinalResult
    };
  }

  const common = { underscored: true, timestamps: true };

  const ChallengeResult = sequelize.models.ChallengeResult || sequelize.define('ChallengeResult', {
    id: identity(),
    gameId: uuid(),
    turnId: uuid(),
    boardCellId: uuid(true),
    teamId: uuid(),
    scoringMethod: {
      type: DataTypes.ENUM('BUTTON', 'MANUAL'),
      allowNull: false
    },
    outcome: {
      type: DataTypes.ENUM('SUCCESS', 'FAIL'),
      allowNull: true,
      defaultValue: null
    },
    manualPoints: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      defaultValue: null
    },
    awardedPoints: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0
    },
    note: {
      type: DataTypes.TEXT,
      allowNull: true,
      defaultValue: null
    },
    actorUserId: uuid(),
    ...timestamps()
  }, {
    ...common,
    tableName: 'challenge_results',
    indexes: [
      { fields: ['turn_id'], unique: true },
      { fields: ['game_id', 'id'] },
      { fields: ['game_id', 'team_id'] },
      { fields: ['actor_user_id'] }
    ]
  });

  const ScoreLedger = sequelize.models.ScoreLedger || sequelize.define('ScoreLedger', {
    id: identity(),
    gameId: uuid(),
    teamId: uuid(),
    turnId: uuid(true),
    challengeResultId: uuid(true),
    deltaPoints: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    source: {
      type: DataTypes.ENUM('CHALLENGE_BUTTON', 'CHALLENGE_MANUAL', 'CORRECTION'),
      allowNull: false
    },
    reason: {
      type: DataTypes.STRING(255),
      allowNull: true,
      defaultValue: null
    },
    actorUserId: uuid(),
    compensatesEntryId: uuid(true),
    ...timestamps()
  }, {
    ...common,
    tableName: 'score_ledger',
    indexes: [
      { fields: ['game_id', 'team_id', 'created_at', 'id'] },
      { fields: ['challenge_result_id'], unique: true },
      { fields: ['turn_id'] },
      { fields: ['actor_user_id'] },
      { fields: ['compensates_entry_id'] }
    ]
  });

  const FinalResult = sequelize.models.FinalResult || sequelize.define('FinalResult', {
    id: identity(),
    gameId: uuid(),
    teamId: uuid(),
    score: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      defaultValue: 0
    },
    position: {
      type: DataTypes.TINYINT.UNSIGNED,
      allowNull: false,
      defaultValue: 0
    },
    rank: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false
    },
    isWinner: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    ...timestamps()
  }, {
    ...common,
    tableName: 'final_results',
    indexes: [
      { fields: ['game_id', 'team_id'], unique: true },
      { fields: ['game_id', 'rank'] }
    ]
  });

  return { ChallengeResult, ScoreLedger, FinalResult };
}
