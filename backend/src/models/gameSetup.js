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

/** Defines schema only; migration owns FK DDL, including the scoped circular game/team pointer. */
export function defineGameSetup(sequelize) {
  if (sequelize.models.Game) return sequelize.models;
  const common = { underscored: true, timestamps: true };
  sequelize.define('Game', {
    id: identity(), name: { type: DataTypes.STRING(160), allowNull: false },
    boardSource: { type: DataTypes.ENUM('CUSTOM', 'PRD_APPENDIX_A', 'JSON_IMPORT'),
      allowNull: false, defaultValue: 'CUSTOM' },
    status: { type: DataTypes.ENUM('DRAFT', 'READY', 'RUNNING', 'PAUSED', 'FINISHED'),
      allowNull: false, defaultValue: 'DRAFT' },
    currentTeamId: uuid(true), activeTurnId: uuid(true), turnNumber: counter(),
    stateVersion: counter(), eventSequence: counter(), eventRetentionFloor: counter(),
    startedAt: date(true), finishedAt: date(true), finishedBy: uuid(true), ...timestamps()
  }, { ...common, tableName: 'games', indexes: [
    { fields: ['status'] }, { fields: ['current_team_id'] }, { fields: ['active_turn_id'] },
    { fields: ['finished_by'] }
  ] });
  sequelize.define('Team', {
    id: identity(), gameId: uuid(), name: { type: DataTypes.STRING(100), allowNull: false },
    sortOrder: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false },
    color: { type: DataTypes.CHAR(7), allowNull: false },
    position: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false, defaultValue: 0 },
    totalScore: counter(), ...timestamps()
  }, { ...common, tableName: 'teams', indexes: [
    { fields: ['game_id', 'id'], unique: true }, { fields: ['game_id', 'sort_order'], unique: true },
    { fields: ['game_id', 'name'], unique: true }
  ] });
  sequelize.define('BoardCell', {
    id: identity(), gameId: uuid(), number: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false },
    category: { type: DataTypes.ENUM('ACTION', 'REWARD', 'RACE_STRENGTH', 'PIT_STOP', 'INDISIPLINER'),
      allowNull: false },
    title: { type: DataTypes.STRING(160), allowNull: false },
    instruction: { type: DataTypes.TEXT, allowNull: true, defaultValue: null },
    backupText: { type: DataTypes.TEXT, allowNull: true, defaultValue: null },
    durationText: { type: DataTypes.STRING(255), allowNull: true, defaultValue: null },
    successPoints: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    allowManualPoints: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    defaultScoringMethod: { type: DataTypes.ENUM('BUTTON', 'MANUAL'), allowNull: false, defaultValue: 'BUTTON' },
    pointsPerUnit: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, defaultValue: null },
    penaltySteps: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false, defaultValue: 0 }, ...timestamps()
  }, { ...common, tableName: 'board_cells', indexes: [{ fields: ['game_id', 'number'], unique: true }] });
  sequelize.define('CommandLog', {
    id: identity(), gameId: uuid(), actorUserId: uuid(), idempotencyKey: uuid(),
    scopeKey: { type: DataTypes.STRING(80), allowNull: false },
    commandType: { type: DataTypes.STRING(80), allowNull: false },
    requestHash: { type: DataTypes.CHAR(64), allowNull: false },
    status: { type: DataTypes.ENUM('IN_PROGRESS', 'SUCCEEDED'), allowNull: false, defaultValue: 'IN_PROGRESS' },
    httpStatus: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: true, defaultValue: null },
    responseJson: jsonField('responseJson', true),
    responseSecretCiphertext: { type: DataTypes.TEXT, allowNull: true, defaultValue: null },
    responseSecretNonce: { type: DataTypes.STRING(32), allowNull: true, defaultValue: null },
    responseSecretTag: { type: DataTypes.STRING(32), allowNull: true, defaultValue: null },
    responseSecretKeyId: { type: DataTypes.STRING(100), allowNull: true, defaultValue: null }, ...timestamps()
  }, { ...common, tableName: 'command_log', indexes: [
    { fields: ['game_id', 'idempotency_key'], unique: true },
    { fields: ['scope_key', 'idempotency_key'], unique: true }, { fields: ['actor_user_id'] }
  ] });
  sequelize.define('GameEvent', {
    id: identity(), gameId: uuid(), sequence: counter(), stateVersion: counter(),
    type: { type: DataTypes.STRING(100), allowNull: false }, payloadJson: jsonField('payloadJson'),
    actorType: { type: DataTypes.ENUM('USER', 'SYSTEM'), allowNull: false }, actorUserId: uuid(true),
    requestId: uuid(true), occurredAt: date(), ...timestamps()
  }, { ...common, tableName: 'game_events', indexes: [
    { fields: ['game_id', 'sequence'], unique: true }, { fields: ['game_id', 'type', 'sequence'] },
    { fields: ['actor_user_id'] }, { fields: ['request_id'] }
  ] });
  sequelize.define('OutboxEvent', {
    id: identity(), gameId: uuid(), gameEventId: uuid(), publishedAt: date(true),
    attemptCount: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    nextAttemptAt: date(), ...timestamps()
  }, { ...common, tableName: 'outbox_events', indexes: [
    { fields: ['game_event_id'], unique: true }, { fields: ['game_id'] }, { fields: ['next_attempt_at', 'id'] }
  ] });
  return sequelize.models;
}
