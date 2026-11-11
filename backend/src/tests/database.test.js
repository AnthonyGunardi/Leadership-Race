import { describe, it, expect, vi } from 'vitest';
import { assertSafeTestSchema, createSequelizeInstance, getSequelize, closeSequelize } from '../config/database.js';
import { logger } from '../config/logger.js';

describe('database unit configuration', () => {
  it('validates safe disposable test schema names', () => {
    expect(() => assertSafeTestSchema('lr_test_unit123')).not.toThrow();
    expect(() => assertSafeTestSchema('lr_test_123456_789')).not.toThrow();
  });

  it('rejects unsafe schema names', () => {
    expect(() => assertSafeTestSchema('lr_development')).toThrowError(/Unsafe test schema operation/);
    expect(() => assertSafeTestSchema('lr_production')).toThrowError(/Unsafe test schema operation/);
    expect(() => assertSafeTestSchema('')).toThrowError(/Unsafe test schema operation/);
    expect(() => assertSafeTestSchema(null)).toThrowError(/Unsafe test schema operation/);
  });

  it('creates Sequelize instance with default environment config', () => {
    const sequelize = createSequelizeInstance({
      database: 'lr_test_custom',
      host: '127.0.0.1',
      port: 3306,
      username: 'test_user',
      password: 'test_password'
    });

    expect(sequelize).toBeDefined();
    expect(sequelize.config.database).toBe('lr_test_custom');
    expect(sequelize.config.host).toBe('127.0.0.1');
    expect(sequelize.config.port).toBe(3306);
    expect(sequelize.config.username).toBe('test_user');
  });

  it('configures logging properly in non-test mode', () => {
    const debugSpy = vi.spyOn(logger, 'debug').mockImplementation(() => {});
    const devSequelize = createSequelizeInstance({
      NODE_ENV: 'development'
    });

    expect(devSequelize.options.logging).toBeDefined();
    expect(typeof devSequelize.options.logging).toBe('function');
    devSequelize.options.logging('executing query');
    expect(debugSpy).toHaveBeenCalledWith('executing query');
    debugSpy.mockRestore();
  });

  it('returns singleton instance via getSequelize()', () => {
    const first = getSequelize();
    const second = getSequelize();
    expect(first).toBe(second);
  });

  it('closes shared Sequelize instance and resets singleton via closeSequelize()', async () => {
    const instance = getSequelize();
    expect(instance).toBeDefined();
    await closeSequelize();
    // Calling closeSequelize when already closed does not fail
    await closeSequelize();
    const freshInstance = getSequelize();
    expect(freshInstance).toBeDefined();
    await closeSequelize();
  });
});
