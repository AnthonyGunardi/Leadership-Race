const { DataTypes } = require('sequelize');

const options = { engine: 'InnoDB', charset: 'utf8mb4', collate: 'utf8mb4_unicode_ci' };
const uuid = 'CHAR(36) CHARACTER SET ascii COLLATE ascii_bin';
const id = () => ({ type: uuid, allowNull: false, primaryKey: true });
const reference = (table, allowNull = false) => ({
  type: uuid, allowNull, ...(allowNull ? { defaultValue: null } : {}),
  references: { model: table, key: 'id' }, onDelete: 'RESTRICT', onUpdate: 'RESTRICT'
});
const counter = () => ({ type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 0 });
const date = (allowNull = false) => ({
  type: DataTypes.DATE(3), allowNull, ...(allowNull ? { defaultValue: null } : {})
});
const json = (allowNull = false) => ({ type: DataTypes.JSON, allowNull });
const timestamps = () => ({ created_at: date(), updated_at: date() });

/** Adds only G3 setup and durable command/event infrastructure; DDL is intentionally additive. */
async function up(queryInterface) {
  await queryInterface.createTable('games', {
    id: id(), name: { type: DataTypes.STRING(160), allowNull: false },
    status: { type: DataTypes.ENUM('DRAFT', 'READY', 'RUNNING', 'PAUSED', 'FINISHED'),
      allowNull: false, defaultValue: 'DRAFT' },
    current_team_id: { type: uuid, allowNull: true, defaultValue: null },
    active_turn_id: { type: uuid, allowNull: true, defaultValue: null },
    turn_number: counter(), state_version: counter(), event_sequence: counter(), event_retention_floor: counter(),
    started_at: date(true), finished_at: date(true), finished_by: reference('users', true),
    ...timestamps()
  }, options);
  await queryInterface.addIndex('games', ['status']);
  await queryInterface.addIndex('games', ['current_team_id']);
  await queryInterface.addIndex('games', ['active_turn_id']);
  await queryInterface.addIndex('games', ['finished_by']);

  await queryInterface.createTable('teams', {
    id: id(), game_id: reference('games'), name: { type: DataTypes.STRING(100), allowNull: false },
    sort_order: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false },
    color: { type: DataTypes.CHAR(7), allowNull: false },
    position: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false, defaultValue: 0 }, total_score: counter(),
    ...timestamps()
  }, options);
  await queryInterface.addIndex('teams', ['game_id', 'id'], { unique: true });
  await queryInterface.addIndex('teams', ['game_id', 'sort_order'], { unique: true });
  await queryInterface.addIndex('teams', ['game_id', 'name'], { unique: true });
  await queryInterface.addConstraint('teams', {
    fields: ['position'], type: 'check', where: { position: { [require('sequelize').Op.between]: [0, 50] } },
    name: 'teams_position_range'
  });
  await queryInterface.addConstraint('games', {
    fields: ['id', 'current_team_id'], type: 'foreign key', name: 'games_current_team_scope',
    references: { table: 'teams', fields: ['game_id', 'id'] }, onDelete: 'RESTRICT', onUpdate: 'RESTRICT'
  });

  await queryInterface.createTable('board_cells', {
    id: id(), game_id: reference('games'), number: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false },
    category: { type: DataTypes.ENUM('ACTION', 'REWARD', 'RACE_STRENGTH', 'PIT_STOP', 'INDISIPLINER'),
      allowNull: false },
    title: { type: DataTypes.STRING(160), allowNull: false },
    instruction: { type: DataTypes.TEXT, allowNull: true, defaultValue: null },
    backup_text: { type: DataTypes.TEXT, allowNull: true, defaultValue: null },
    duration_text: { type: DataTypes.STRING(255), allowNull: true, defaultValue: null },
    success_points: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    allow_manual_points: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    default_scoring_method: { type: DataTypes.ENUM('BUTTON', 'MANUAL'), allowNull: false, defaultValue: 'BUTTON' },
    points_per_unit: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, defaultValue: null },
    penalty_steps: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false, defaultValue: 0 },
    ...timestamps()
  }, options);
  await queryInterface.addIndex('board_cells', ['game_id', 'number'], { unique: true });
  await queryInterface.addConstraint('board_cells', {
    fields: ['number'], type: 'check', where: { number: { [require('sequelize').Op.between]: [1, 50] } },
    name: 'board_cells_number_range'
  });
  await queryInterface.addConstraint('audit_logs', {
    fields: ['game_id'], type: 'foreign key', name: 'audit_logs_game_fk',
    references: { table: 'games', field: 'id' }, onDelete: 'RESTRICT', onUpdate: 'RESTRICT'
  });

  await queryInterface.createTable('command_log', {
    id: id(), game_id: reference('games'), actor_user_id: reference('users'),
    idempotency_key: { type: uuid, allowNull: false },
    scope_key: { type: DataTypes.STRING(80), allowNull: false },
    command_type: { type: DataTypes.STRING(80), allowNull: false },
    request_hash: { type: DataTypes.CHAR(64), allowNull: false },
    status: { type: DataTypes.ENUM('IN_PROGRESS', 'SUCCEEDED'), allowNull: false, defaultValue: 'IN_PROGRESS' },
    http_status: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: true, defaultValue: null },
    response_json: json(true),
    response_secret_ciphertext: { type: DataTypes.TEXT, allowNull: true, defaultValue: null },
    response_secret_nonce: { type: DataTypes.STRING(32), allowNull: true, defaultValue: null },
    response_secret_tag: { type: DataTypes.STRING(32), allowNull: true, defaultValue: null },
    response_secret_key_id: { type: DataTypes.STRING(100), allowNull: true, defaultValue: null },
    ...timestamps()
  }, options);
  await queryInterface.addIndex('command_log', ['game_id', 'idempotency_key'], { unique: true });
  await queryInterface.addIndex('command_log', ['scope_key', 'idempotency_key'], { unique: true });
  await queryInterface.addIndex('command_log', ['actor_user_id']);

  await queryInterface.createTable('game_events', {
    id: id(), game_id: reference('games'), sequence: counter(), state_version: counter(),
    type: { type: DataTypes.STRING(100), allowNull: false }, payload_json: json(),
    actor_type: { type: DataTypes.ENUM('USER', 'SYSTEM'), allowNull: false },
    actor_user_id: reference('users', true), request_id: { type: uuid, allowNull: true, defaultValue: null },
    occurred_at: date(), ...timestamps()
  }, options);
  await queryInterface.addIndex('game_events', ['game_id', 'sequence'], { unique: true });
  await queryInterface.addIndex('game_events', ['game_id', 'type', 'sequence']);
  await queryInterface.addIndex('game_events', ['actor_user_id']);
  await queryInterface.addIndex('game_events', ['request_id']);

  await queryInterface.createTable('outbox_events', {
    id: id(), game_id: reference('games'), game_event_id: reference('game_events'),
    published_at: date(true), attempt_count: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    next_attempt_at: date(), ...timestamps()
  }, options);
  await queryInterface.addIndex('outbox_events', ['game_event_id'], { unique: true });
  await queryInterface.addIndex('outbox_events', ['game_id']);
  await queryInterface.addIndex('outbox_events', ['next_attempt_at', 'id']);
}

/** Destructive down is restricted to disposable test schemas; event data is retained elsewhere. */
async function down(queryInterface) {
  if (!/^lr_test_[a-zA-Z0-9_]+$/.test(queryInterface.sequelize.getDatabaseName())) {
    throw new Error('Game setup rollback requires an isolated lr_test_* database');
  }
  await queryInterface.dropTable('outbox_events');
  await queryInterface.dropTable('game_events');
  await queryInterface.dropTable('command_log');
  await queryInterface.removeConstraint('audit_logs', 'audit_logs_game_fk');
  await queryInterface.dropTable('board_cells');
  await queryInterface.removeConstraint('games', 'games_current_team_scope');
  await queryInterface.dropTable('teams');
  await queryInterface.dropTable('games');
}

module.exports = { up, down };
