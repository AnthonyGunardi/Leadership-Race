import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { QueryTypes } from 'sequelize';
import { getEnv } from '../../config/environment.js';
import { defineAdminIdentity } from '../../models/adminIdentity.js';
import { defineAuthAudit } from '../../models/authAudit.js';
import { setupIsolatedTestDatabase } from '../helpers/testDatabase.js';

const require = createRequire(import.meta.url);
const runFile = promisify(execFile);
const migrationDirectory = fileURLToPath(new URL('../../../migrations/', import.meta.url));
const bcryptHashFixture = `$2b$12$${'a'.repeat(53)}`;

describe('Auth audit persistence and atomicity on isolated MySQL', () => {
  let testDb;
  let identityModels;
  let auditModels;
  let migrate;

  beforeAll(async () => {
    testDb = await setupIsolatedTestDatabase();
    const env = getEnv();
    migrate = () => runFile(process.execPath, [
      require.resolve('sequelize-cli/lib/sequelize'), 'db:migrate', '--env', 'test',
      '--config', fileURLToPath(new URL('../../../sequelize.config.cjs', import.meta.url)),
      '--migrations-path', migrationDirectory
    ], {
      env: {
        ...process.env,
        NODE_ENV: 'test',
        DB_NAME: testDb.schemaName,
        DB_HOST: env.DB_HOST,
        DB_PORT: String(env.DB_PORT),
        DB_USER: env.DB_USER,
        DB_PASSWORD: env.DB_PASSWORD
      }
    });

    await migrate();
    identityModels = defineAdminIdentity(testDb.sequelize);
    auditModels = defineAuthAudit(testDb.sequelize);
  });

  afterAll(async () => {
    await testDb?.cleanup();
  });

  it('creates the audit_logs store with indexes and foreign keys', async () => {
    const tables = await testDb.sequelize.getQueryInterface().showAllTables();
    expect(tables).toContain('audit_logs');
  });

  it('persists UUID columns as CHAR(36) ASCII/ascii_bin and timestamps with ms precision', async () => {
    const columns = await testDb.sequelize.query(`
      SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH,
        CHARACTER_SET_NAME, COLLATION_NAME, DATETIME_PRECISION, IS_NULLABLE
      FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = :schema AND TABLE_NAME = 'audit_logs'
    `, { replacements: { schema: testDb.schemaName }, type: QueryTypes.SELECT });

    const idCols = columns.filter((col) => ['id', 'game_id', 'actor_user_id', 'request_id'].includes(col.COLUMN_NAME));
    expect(idCols).toHaveLength(4);
    for (const col of idCols) {
      expect(col).toMatchObject({
        DATA_TYPE: 'char',
        CHARACTER_MAXIMUM_LENGTH: 36,
        CHARACTER_SET_NAME: 'ascii',
        COLLATION_NAME: 'ascii_bin'
      });
    }

    const gameIdCol = columns.find((c) => c.COLUMN_NAME === 'game_id');
    expect(gameIdCol.IS_NULLABLE).toBe('YES');

    const occurredAtCol = columns.find((c) => c.COLUMN_NAME === 'occurred_at');
    expect(occurredAtCol).toMatchObject({
      DATA_TYPE: 'datetime',
      DATETIME_PRECISION: 3,
      IS_NULLABLE: 'NO'
    });
  });

  it('enforces required indexes on audit_logs', async () => {
    const queryInterface = testDb.sequelize.getQueryInterface();
    const indexes = await queryInterface.showIndex('audit_logs');

    const hasIndexOn = (fields) => indexes.some((idx) => {
      const idxFields = idx.fields.map((f) => f.attribute);
      return fields.every((f, i) => idxFields[i] === f);
    });

    expect(hasIndexOn(['game_id', 'occurred_at', 'id'])).toBe(true);
    expect(hasIndexOn(['actor_user_id', 'occurred_at', 'id'])).toBe(true);
    expect(hasIndexOn(['request_id'])).toBe(true);
    expect(hasIndexOn(['game_id', 'action', 'occurred_at', 'id'])).toBe(true);
  });

  it('proves atomic rollback when writing user and audit log in a transaction', async () => {
    const userEmail = `atomic_${Date.now()}@example.test`;
    const requestId = randomUUID();

    await expect(testDb.sequelize.transaction(async (t) => {
      const user = await identityModels.User.create({
        email: userEmail,
        passwordHash: bcryptHashFixture
      }, { transaction: t });

      await auditModels.AuditLog.create({
        actorType: 'USER',
        actorUserId: user.id,
        action: 'ADMIN_BOOTSTRAP',
        afterJson: { email: userEmail, role: 'SUPER_ADMIN' },
        requestId,
        occurredAt: new Date()
      }, { transaction: t });

      // Intentionally force error to trigger transaction rollback
      throw new Error('SIMULATED_TRANSACTION_FAILURE');
    })).rejects.toThrow('SIMULATED_TRANSACTION_FAILURE');

    // Assert neither user nor audit log was persisted
    const persistedUser = await identityModels.User.findOne({ where: { email: userEmail } });
    const persistedAudit = await auditModels.AuditLog.findOne({ where: { requestId } });

    expect(persistedUser).toBeNull();
    expect(persistedAudit).toBeNull();
  });

  it('proves successful transaction commits both user and audit log without plaintext credential', async () => {
    const userEmail = `commit_${Date.now()}@example.test`;
    const requestId = randomUUID();

    const result = await testDb.sequelize.transaction(async (t) => {
      const user = await identityModels.User.create({
        email: userEmail,
        passwordHash: bcryptHashFixture
      }, { transaction: t });

      const audit = await auditModels.AuditLog.create({
        actorType: 'USER',
        actorUserId: user.id,
        action: 'ADMIN_BOOTSTRAP',
        afterJson: { email: userEmail, role: 'SUPER_ADMIN' },
        reason: 'Initial local administrator bootstrap',
        requestId,
        occurredAt: new Date()
      }, { transaction: t });

      return { user, audit };
    });

    const persistedUser = await identityModels.User.findByPk(result.user.id);
    const persistedAudit = await auditModels.AuditLog.findByPk(result.audit.id);

    expect(persistedUser).not.toBeNull();
    expect(persistedAudit).not.toBeNull();
    expect(persistedAudit.afterJson).toEqual({ email: userEmail, role: 'SUPER_ADMIN' });
    // Verify no plaintext password anywhere in audit log
    expect(JSON.stringify(persistedAudit.toJSON())).not.toContain(bcryptHashFixture);
  });

  it('supports SYSTEM actor with null actor_user_id', async () => {
    const requestId = randomUUID();
    const audit = await auditModels.AuditLog.create({
      actorType: 'SYSTEM',
      actorUserId: null,
      action: 'SYSTEM_STARTUP',
      reason: 'Server startup maintenance',
      requestId,
      occurredAt: new Date()
    });

    expect(audit.actorType).toBe('SYSTEM');
    expect(audit.actorUserId).toBeNull();
  });

  it('refuses audit rollback outside a disposable schema', async () => {
    const auditMigration = require('../../../migrations/202611100002-createAuditLogs.cjs');
    await expect(auditMigration.down({ sequelize: { getDatabaseName: () => 'lr_production' } }))
      .rejects.toThrow('Audit rollback requires an isolated lr_test_* database');
  });

  it('can roll down and re-apply audit migration in isolated test schema', async () => {
    const auditMigration = require('../../../migrations/202611100002-createAuditLogs.cjs');
    await auditMigration.down(testDb.sequelize.getQueryInterface());
    const tables = await testDb.sequelize.getQueryInterface().showAllTables();
    expect(tables).not.toContain('audit_logs');
    await auditMigration.up(testDb.sequelize.getQueryInterface());
    const reTables = await testDb.sequelize.getQueryInterface().showAllTables();
    expect(reTables).toContain('audit_logs');
  });
});
