import { globSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { QueryTypes } from 'sequelize';
import { getEnv } from '../../config/environment.js';
import { defineAdminIdentity } from '../../models/adminIdentity.js';
import { setupIsolatedTestDatabase } from '../helpers/testDatabase.js';

const require = createRequire(import.meta.url);
const migration = require('../../../migrations/202611100001-createAdminIdentity.cjs');
const runFile = promisify(execFile);
const migrationDirectory = fileURLToPath(new URL('../../../migrations/', import.meta.url));
const bcryptHashFixture = `$2b$12$${'a'.repeat(53)}`;

describe('Admin identity migrations on isolated MySQL', () => {
  let testDb;
  let models;
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
        ...process.env, NODE_ENV: 'test', DB_NAME: testDb.schemaName, DB_HOST: env.DB_HOST,
        DB_PORT: String(env.DB_PORT), DB_USER: env.DB_USER, DB_PASSWORD: env.DB_PASSWORD
      }
    });
    await migrate();
    models = defineAdminIdentity(testDb.sequelize);
  });

  afterAll(async () => {
    await testDb?.cleanup();
  });

  it('creates the four identity stores required for durable admin sessions', async () => {
    const tables = await testDb.sequelize.getQueryInterface().showAllTables();
    expect(tables).toEqual(expect.arrayContaining([
      'users', 'admin_sessions', 'admin_refresh_tokens', 'admin_access_tokens'
    ]));
  });

  it('tracks the migration once and re-running preserves existing data', async () => {
    const user = await models.User.create({ email: 'rerun@example.test', passwordHash: bcryptHashFixture });
    await migrate();
    const records = await testDb.sequelize.getQueryInterface().select(null, 'SequelizeMeta');
    expect(records.map((row) => row.name)).toEqual(globSync('*.cjs', { cwd: migrationDirectory }).sort());
    expect((await models.User.findByPk(user.id)).email).toBe('rerun@example.test');
  });

  it('persists UUID columns as CHAR(36) ASCII/ascii_bin and dates with millisecond precision', async () => {
    // Sequelize has no portable ORM API for per-column charset/precision metadata; values remain bound.
    const columns = await testDb.sequelize.query(`
      SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH,
        CHARACTER_SET_NAME, COLLATION_NAME, DATETIME_PRECISION
      FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = :schema
    `, { replacements: { schema: testDb.schemaName }, type: QueryTypes.SELECT });
    const idColumns = columns.filter((column) => (
      ['users', 'admin_sessions', 'admin_refresh_tokens', 'admin_access_tokens'].includes(column.TABLE_NAME)
      && ['id', 'user_id', 'session_id', 'replaced_by'].includes(column.COLUMN_NAME)
    ));
    expect(idColumns).toHaveLength(8);
    for (const column of idColumns) {
      expect(column).toMatchObject({
        DATA_TYPE: 'char', CHARACTER_MAXIMUM_LENGTH: 36, CHARACTER_SET_NAME: 'ascii', COLLATION_NAME: 'ascii_bin'
      });
    }
    const dateColumns = columns.filter((column) => /_at$/.test(column.COLUMN_NAME));
    expect(dateColumns.length).toBeGreaterThan(8);
    for (const column of dateColumns) {
      expect(column).toMatchObject({ DATA_TYPE: 'datetime', DATETIME_PRECISION: 3 });
    }
  });

  it('enforces unique emails at the database boundary, including case variants', async () => {
    await models.User.create({ email: 'unique@example.test', passwordHash: bcryptHashFixture });
    await expect(models.User.create({
      email: 'UNIQUE@example.test', passwordHash: bcryptHashFixture
    }, { validate: false })).rejects.toMatchObject({ name: 'SequelizeUniqueConstraintError' });
  });

  it('indexes every foreign key used by session authorization and rotation', async () => {
    const queryInterface = testDb.sequelize.getQueryInterface();
    for (const [table, fields] of [
      ['admin_sessions', ['user_id']],
      ['admin_refresh_tokens', ['session_id', 'replaced_by']],
      ['admin_access_tokens', ['session_id']]
    ]) {
      const indexes = await queryInterface.showIndex(table);
      for (const field of fields) {
        expect(indexes.some((index) => index.fields[0].attribute === field)).toBe(true);
      }
    }
  });

  it('rejects missing required credentials and orphan sessions even without model validation', async () => {
    await expect(models.User.create({ email: 'missing@example.test', passwordHash: null }, { validate: false }))
      .rejects.toMatchObject({ name: 'SequelizeDatabaseError' });
    await expect(models.AdminSession.create({
      userId: randomUUID(), expiresAt: new Date('2026-11-17T00:00:00.123Z')
    }, { validate: false })).rejects.toMatchObject({ name: 'SequelizeForeignKeyConstraintError' });
  });

  it('stores only hashes, preserves spent refresh tokens and relates their replacements', async () => {
    const user = await models.User.create({ email: 'rotation@example.test', passwordHash: bcryptHashFixture });
    const expiresAt = new Date('2026-11-17T00:00:00.123Z');
    const session = await models.AdminSession.create({ userId: user.id, expiresAt });
    const first = await models.AdminRefreshToken.create({
      sessionId: session.id, tokenHash: '1'.repeat(64), generation: 0, expiresAt
    });
    const replacement = await models.AdminRefreshToken.create({
      sessionId: session.id, tokenHash: '2'.repeat(64), generation: 1, expiresAt
    });
    await first.update({ usedAt: new Date('2026-11-10T00:00:00.456Z'), replacedBy: replacement.id });
    const access = await models.AdminAccessToken.create({ sessionId: session.id, tokenHash: '3'.repeat(64), expiresAt });
    await first.reload();
    expect(first.usedAt.toISOString()).toBe('2026-11-10T00:00:00.456Z');
    expect((await first.getReplacement()).id).toBe(replacement.id);
    expect((await session.getUser()).id).toBe(user.id);
    expect((await first.getSession()).id).toBe(session.id);
    expect((await access.getSession()).id).toBe(session.id);
    expect((await access.reload()).expiresAt.toISOString()).toBe(expiresAt.toISOString());
    expect(await models.AdminRefreshToken.count({ where: { sessionId: session.id } })).toBe(2);
    expect((await testDb.sequelize.getQueryInterface().describeTable('admin_access_tokens')).token).toBeUndefined();
    expect((await testDb.sequelize.getQueryInterface().describeTable('admin_refresh_tokens')).token).toBeUndefined();
    await expect(models.AdminRefreshToken.create({
      sessionId: session.id, tokenHash: '4'.repeat(64), generation: 1, expiresAt
    })).rejects.toMatchObject({ name: 'SequelizeUniqueConstraintError' });
    await expect(models.AdminRefreshToken.create({
      sessionId: session.id, tokenHash: '1'.repeat(64), generation: 2, expiresAt
    })).rejects.toMatchObject({ name: 'SequelizeUniqueConstraintError' });
    await expect(models.AdminAccessToken.create({ sessionId: session.id, tokenHash: access.tokenHash, expiresAt }))
      .rejects.toMatchObject({ name: 'SequelizeUniqueConstraintError' });
    await expect(session.destroy()).rejects.toMatchObject({ name: 'SequelizeForeignKeyConstraintError' });
  });

  it('rolls back multi-table writes together on a real transaction failure', async () => {
    const id = randomUUID();
    await expect(testDb.sequelize.transaction(async (transaction) => {
      await models.User.create({ id, email: 'rollback@example.test', passwordHash: bcryptHashFixture }, { transaction });
      await models.AdminSession.create({ userId: id, expiresAt: new Date() }, { transaction });
      throw new Error('abort identity write');
    })).rejects.toThrow('abort identity write');
    expect(await models.User.findByPk(id)).toBeNull();
    expect(await models.AdminSession.count({ where: { userId: id } })).toBe(0);
  });

  it('refuses rollback outside a disposable schema before issuing any DDL', async () => {
    await expect(migration.down({ sequelize: { getDatabaseName: () => 'lr_production' } }))
      .rejects.toThrow('Identity rollback requires an isolated lr_test_* database');
  });

  it('can remove and re-apply the migration only inside its owned isolated schema', async () => {
    const migrations = [
      require('../../../migrations/202611100010-createFinalResults.cjs'),
      require('../../../migrations/202611100009-createChallengeResultsAndScoreLedger.cjs'),
      require('../../../migrations/202611100008-addGameActiveTurnConstraint.cjs'),
      require('../../../migrations/202611100007-createTurns.cjs'),
      require('../../../migrations/202611100006-createControllerLeases.cjs'),
      require('../../../migrations/202611100005-addBoardSource.cjs'),
      require('../../../migrations/202611100004-createDisplayAccess.cjs'),
      require('../../../migrations/202611100003-createGameSetup.cjs'),
      require('../../../migrations/202611100002-createAuditLogs.cjs'),
      migration
    ];
    for (const m of migrations) {
      await m.down(testDb.sequelize.getQueryInterface());
    }
    const remainingTables = await testDb.sequelize.getQueryInterface().showAllTables();
    expect(remainingTables.map((name) => name.toLowerCase())).toEqual(['sequelizemeta']);
    for (const m of [...migrations].reverse()) {
      await m.up(testDb.sequelize.getQueryInterface());
    }
    expect(await models.User.count()).toBe(0);
  });
});
