import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataTypes } from 'sequelize';
import { assertSafeTestSchema, createSequelizeInstance } from '../../config/database.js';
import { setupIsolatedTestDatabase } from '../helpers/testDatabase.js';

describe('Database Integration & Isolation', () => {
  let testDb;

  beforeAll(async () => {
    testDb = await setupIsolatedTestDatabase();
  });

  afterAll(async () => {
    if (testDb && testDb.cleanup) {
      await testDb.cleanup();
    }
  });

  it('enforces safety guard against unsafe schema names', () => {
    expect(() => assertSafeTestSchema('lr_development')).toThrowError(/Unsafe test schema operation/);
    expect(() => assertSafeTestSchema('lr_production')).toThrowError(/Unsafe test schema operation/);
    expect(() => assertSafeTestSchema('mysql')).toThrowError(/Unsafe test schema operation/);
    expect(() => assertSafeTestSchema('test')).toThrowError(/Unsafe test schema operation/);
    expect(() => assertSafeTestSchema('lr_test_run1')).not.toThrow();
  });

  it('authenticates and executes queries against isolated test schema', async () => {
    await expect(testDb.sequelize.authenticate()).resolves.not.toThrow();

    const [results] = await testDb.sequelize.query('SELECT DATABASE() as currentDb, VERSION() as version;');
    expect(results[0].currentDb).toBe(testDb.schemaName);
    expect(results[0].version).toBeDefined();
  });

  it('guarantees atomic transaction commit and rollback', async () => {
    const Item = testDb.sequelize.define('TestItem', {
      name: {
        type: DataTypes.STRING,
        allowNull: false
      }
    }, {
      tableName: 'test_items',
      timestamps: false
    });

    await Item.sync();

    // Rollback scenario
    await expect(
      testDb.sequelize.transaction(async (t) => {
        await Item.create({ name: 'transient_item' }, { transaction: t });
        throw new Error('Simulated failure triggering rollback');
      })
    ).rejects.toThrowError('Simulated failure triggering rollback');

    const countAfterRollback = await Item.count();
    expect(countAfterRollback).toBe(0);

    // Commit scenario
    await testDb.sequelize.transaction(async (t) => {
      await Item.create({ name: 'committed_item' }, { transaction: t });
    });

    const countAfterCommit = await Item.count();
    expect(countAfterCommit).toBe(1);
  });

  it('fails safely without credential leakage on unreachable host or invalid port', async () => {
    const unreachableSequelize = createSequelizeInstance({
      host: '127.0.0.1',
      port: 59999, // Unused port that immediately refuses connection
      database: 'lr_test_unreachable',
      password: 'super-confidential-password'
    });

    try {
      await unreachableSequelize.authenticate();
      expect.unreachable('Should fail on unreachable host');
    } catch (err) {
      expect(err).toBeDefined();
      expect(err.message).not.toContain('super-confidential-password');
    } finally {
      await unreachableSequelize.close().catch(() => {});
    }
  });
});
