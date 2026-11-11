import { describe, it, expect } from 'vitest';
import { Writable } from 'stream';
import winston from 'winston';
import { createLogger, redactSensitiveData } from '../config/logger.js';

function createMemoryTransport() {
  const logs = [];
  const stream = new Writable({
    write(chunk, encoding, callback) {
      logs.push(chunk.toString());
      callback();
    }
  });
  const transport = new winston.transports.Stream({ stream });
  return { transport, logs };
}

describe('redactSensitiveData', () => {
  it('redacts top-level sensitive keys', () => {
    const input = {
      user: 'admin',
      password: 'super-secret-password',
      token: 'jwt.token.here',
      code: 'PAIR12',
      cookie: 'session_id=abc',
      authorization: 'Bearer secret_key',
      secret: 'hidden_val'
    };

    const redacted = redactSensitiveData(input);
    expect(redacted.user).toBe('admin');
    expect(redacted.password).toBe('[REDACTED]');
    expect(redacted.token).toBe('[REDACTED]');
    expect(redacted.code).toBe('[REDACTED]');
    expect(redacted.cookie).toBe('[REDACTED]');
    expect(redacted.authorization).toBe('[REDACTED]');
    expect(redacted.secret).toBe('[REDACTED]');
  });

  it('redacts nested sensitive keys and preserves non-sensitive keys', () => {
    const input = {
      meta: {
        requestId: '123e4567-e89b-12d3-a456-426614174000',
        credentials: {
          accessToken: 'sensitive_token',
          nestedSecret: 'deep_secret'
        }
      },
      statusCode: 200,
      errorCode: 'NOT_FOUND',
      count: 5
    };

    const redacted = redactSensitiveData(input);
    expect(redacted.meta.requestId).toBe('123e4567-e89b-12d3-a456-426614174000');
    expect(redacted.meta.credentials.accessToken).toBe('[REDACTED]');
    expect(redacted.meta.credentials.nestedSecret).toBe('[REDACTED]');
    expect(redacted.statusCode).toBe(200);
    expect(redacted.errorCode).toBe('NOT_FOUND');
    expect(redacted.count).toBe(5);
  });

  it('handles primitive types and null/undefined without crashing', () => {
    expect(redactSensitiveData(null)).toBe(null);
    expect(redactSensitiveData(undefined)).toBe(undefined);
    expect(redactSensitiveData('string')).toBe('string');
    expect(redactSensitiveData(123)).toBe(123);
  });

  it('redacts sensitive items inside arrays', () => {
    const list = ['public-item', { token: 'secret-val' }, 'another-item'];
    const redacted = redactSensitiveData(list);
    expect(redacted[0]).toBe('public-item');
    expect(redacted[1].token).toBe('[REDACTED]');
    expect(redacted[2]).toBe('another-item');
  });

  it('handles Error with nested object and non-sensitive properties', () => {
    const error = new Error('Custom error');
    error.context = {
      userToken: 'token123',
      traceId: 'trace-456'
    };
    error.status = 500;

    const redacted = redactSensitiveData(error);
    expect(redacted.message).toBe('Custom error');
    expect(redacted.context.userToken).toBe('[REDACTED]');
    expect(redacted.context.traceId).toBe('trace-456');
    expect(redacted.status).toBe(500);
  });
});

describe('logger', () => {
  it('formats output as JSON with level, message, and timestamp', () => {
    const { transport, logs } = createMemoryTransport();
    const logger = createLogger({
      level: 'info',
      transports: [transport]
    });

    logger.info('Server started', { port: 3000 });

    expect(logs.length).toBeGreaterThan(0);
    const logObj = JSON.parse(logs[0]);

    expect(logObj.level).toBe('info');
    expect(logObj.message).toBe('Server started');
    expect(logObj.port).toBe(3000);
    expect(logObj.timestamp).toBeDefined();
  });

  it('redacts sensitive information in logged metadata', () => {
    const { transport, logs } = createMemoryTransport();
    const logger = createLogger({
      level: 'info',
      transports: [transport]
    });

    logger.info('User login attempt', {
      username: 'superadmin',
      password: 'cleartext_password',
      headers: {
        authorization: 'Bearer secret_token'
      }
    });

    const logObj = JSON.parse(logs[0]);

    expect(logObj.username).toBe('superadmin');
    expect(logObj.password).toBe('[REDACTED]');
    expect(logObj.headers.authorization).toBe('[REDACTED]');
    expect(JSON.stringify(logObj)).not.toContain('cleartext_password');
    expect(JSON.stringify(logObj)).not.toContain('secret_token');
  });

  it('handles Error objects and redacts sensitive error properties', () => {
    const { transport, logs } = createMemoryTransport();
    const logger = createLogger({
      level: 'error',
      transports: [transport]
    });

    const error = new Error('Database connection failed');
    error.password = 'db_secret_pass';

    logger.error('Unhandled failure', { error });

    const logObj = JSON.parse(logs[0]);

    expect(logObj.level).toBe('error');
    expect(logObj.message).toBe('Unhandled failure');
    expect(logObj.error).toBeDefined();
    expect(logObj.error.password).toBe('[REDACTED]');
    expect(JSON.stringify(logObj)).not.toContain('db_secret_pass');
  });

  it('creates default logger using environment configuration', () => {
    const logger = createLogger();
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
  });

  it('configures rotation transports in development/production mode', () => {
    const devLogger = createLogger({
      env: {
        NODE_ENV: 'development',
        LOG_LEVEL: 'info'
      }
    });
    expect(devLogger.transports.length).toBe(3);
    devLogger.close();
  });
});
