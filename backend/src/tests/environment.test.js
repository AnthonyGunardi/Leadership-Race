import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, vi } from 'vitest';
import { validateEnvironment, getEnv, loadBackendEnv, resetCachedEnv } from '../config/environment.js';

describe('validateEnvironment', () => {
  it('validates a retained controller key ring and rejects malformed or missing active keys without exposing input', () => {
    const key = 'ab'.repeat(32);
    const keys = JSON.stringify({ v1: key, v2: 'cd'.repeat(32) });
    expect(validateEnvironment({ CONTROLLER_RECEIPT_KEYS: keys, CONTROLLER_RECEIPT_KEY_ID: 'v2' }))
      .toMatchObject({ CONTROLLER_RECEIPT_KEYS: { v1: key }, CONTROLLER_RECEIPT_KEY_ID: 'v2' });
    expect(validateEnvironment({ CONTROLLER_RECEIPT_KEYS: '{}' }).CONTROLLER_RECEIPT_KEYS).toEqual({});
    for (const invalid of ['secret-invalid-json', JSON.stringify({ v2: key }), JSON.stringify({ v1: 'too-short' })]) {
      let failure;
      try { validateEnvironment({ CONTROLLER_RECEIPT_KEYS: invalid }); } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(Error);
      expect(failure.message).not.toContain(invalid);
      expect(failure.message).not.toContain(key);
    }
  });
  it('parses valid environment with default values', () => {
    const env = validateEnvironment({
      NODE_ENV: 'development',
      DB_NAME: 'lr_development'
    });

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.CORS_ORIGIN).toBe('http://localhost:5173');
    expect(env.DB_HOST).toBe('127.0.0.1');
    expect(env.DB_PORT).toBe(3306);
    expect(env.DB_NAME).toBe('lr_development');
    expect(env.DB_USER).toBe('root');
    expect(env.DB_PASSWORD).toBe('');
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.SERVER_SHUTDOWN_TIMEOUT_MS).toBe(10000);
  });

  it('parses custom valid values', () => {
    const env = validateEnvironment({
      NODE_ENV: 'production',
      PORT: '8080',
      CORS_ORIGIN: 'https://race.example.com',
      DB_HOST: 'db.example.internal',
      DB_PORT: '3307',
      DB_NAME: 'lr_production',
      DB_USER: 'admin',
      DB_PASSWORD: 'super-secret-password',
      LOG_LEVEL: 'warn',
      SERVER_SHUTDOWN_TIMEOUT_MS: '15000',
      SERVER_HEADERS_TIMEOUT_MS: '70000',
      SERVER_REQUEST_TIMEOUT_MS: '65000',
      SERVER_KEEPALIVE_TIMEOUT_MS: '66000'
    });

    expect(env.NODE_ENV).toBe('production');
    expect(env.PORT).toBe(8080);
    expect(env.CORS_ORIGIN).toBe('https://race.example.com');
    expect(env.DB_HOST).toBe('db.example.internal');
    expect(env.DB_PORT).toBe(3307);
    expect(env.DB_NAME).toBe('lr_production');
    expect(env.DB_USER).toBe('admin');
    expect(env.DB_PASSWORD).toBe('super-secret-password');
    expect(env.LOG_LEVEL).toBe('warn');
    expect(env.SERVER_SHUTDOWN_TIMEOUT_MS).toBe(15000);
  });

  it('throws descriptive error on invalid PORT without leaking secrets', () => {
    expect(() => {
      validateEnvironment({
        PORT: 'not-a-port',
        DB_PASSWORD: 'sensitive-super-secret'
      });
    }).toThrowError(/Invalid environment configuration: PORT/);

    try {
      validateEnvironment({
        PORT: 'not-a-port',
        DB_PASSWORD: 'sensitive-super-secret'
      });
    } catch (err) {
      expect(err.message).not.toContain('sensitive-super-secret');
    }
  });

  it('throws on invalid NODE_ENV', () => {
    expect(() => {
      validateEnvironment({
        NODE_ENV: 'invalid_mode'
      });
    }).toThrowError(/Invalid environment configuration: NODE_ENV/);
  });

  it('throws on invalid timeout configurations', () => {
    expect(() => {
      validateEnvironment({
        SERVER_SHUTDOWN_TIMEOUT_MS: '-5'
      });
    }).toThrowError(/Invalid environment configuration: SERVER_SHUTDOWN_TIMEOUT_MS/);
  });

  it('rejects development/production database name when NODE_ENV is test', () => {
    expect(() => {
      validateEnvironment({
        NODE_ENV: 'test',
        DB_NAME: 'lr_development'
      });
    }).toThrowError(/Test environment must not use development or production database name/);

    expect(() => {
      validateEnvironment({
        NODE_ENV: 'test',
        DB_NAME: 'lr_production'
      });
    }).toThrowError(/Test environment must not use development or production database name/);
  });

  it('handles non-object input gracefully', () => {
    expect(() => {
      validateEnvironment(null);
    }).not.toThrow();
  });

  it('validates default envSource when no argument is passed', () => {
    const env = validateEnvironment();
    expect(env).toBeDefined();
  });

  it('accepts valid test database name when NODE_ENV is test', () => {
    const env = validateEnvironment({
      NODE_ENV: 'test',
      DB_NAME: 'lr_test_unit'
    });

    expect(env.NODE_ENV).toBe('test');
    expect(env.DB_NAME).toBe('lr_test_unit');
  });

  it('returns cached environment via getEnv() and allows reset via resetCachedEnv()', () => {
    resetCachedEnv();
    const first = getEnv();
    const second = getEnv();
    expect(first).toBe(second);

    resetCachedEnv();
    const third = getEnv();
    expect(third).toEqual(first);
  });

  it('loadBackendEnv safely loads environment file and ignores missing file', () => {
    expect(() => loadBackendEnv('non_existent_env_path_12345.env')).not.toThrow();

    const tempDir = os.tmpdir();
    const tempEnvPath = path.join(tempDir, `test_env_${Date.now()}.env`);
    fs.writeFileSync(tempEnvPath, 'TEST_ENV_KEY_123=loaded_value\nDB_NAME=lr_development\n');

    const prevNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'test';
      loadBackendEnv(tempEnvPath);
      expect(process.env.TEST_ENV_KEY_123).toBe('loaded_value');
      // In test mode, lr_development must not leak
      expect(process.env.DB_NAME).not.toBe('lr_development');

      // Test with pre-existing DB_NAME in test mode
      process.env.DB_NAME = 'lr_test_custom_existing';
      loadBackendEnv(tempEnvPath);
      expect(process.env.DB_NAME).toBe('lr_test_custom_existing');
    } finally {
      process.env.NODE_ENV = prevNodeEnv;
      delete process.env.TEST_ENV_KEY_123;
      delete process.env.DB_NAME;
      if (fs.existsSync(tempEnvPath)) {
        fs.unlinkSync(tempEnvPath);
      }
    }
  });

  it('loadBackendEnv handles process.loadEnvFile throw gracefully', () => {
    const tempDir = os.tmpdir();
    const tempEnvPath = path.join(tempDir, `test_env_err_${Date.now()}.env`);
    fs.writeFileSync(tempEnvPath, 'INVALID=true\n');

    const spy = vi.spyOn(process, 'loadEnvFile').mockImplementationOnce(() => {
      throw new Error('Disk read failure');
    });

    expect(() => loadBackendEnv(tempEnvPath)).not.toThrow();
    spy.mockRestore();

    if (fs.existsSync(tempEnvPath)) {
      fs.unlinkSync(tempEnvPath);
    }
  });
});
