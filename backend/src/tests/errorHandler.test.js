import { describe, it, expect, vi } from 'vitest';
import { errorHandler } from '../middleware/errorHandler.js';

function createMockResponse() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    setHeader(key, val) {
      this.headers[key.toLowerCase()] = val;
      return this;
    }
  };
  return res;
}

describe('errorHandler middleware', () => {
  it('handles CORS errors with 403 and envelope structure', () => {
    const err = new Error('CORS origin blocked');
    err.name = 'CORS_ERROR';
    err.origin = 'https://malicious.example.com';

    const req = { originalUrl: '/api/v1/games', method: 'GET', id: 'req-1' };
    const res = createMockResponse();
    const next = vi.fn();

    errorHandler(err, req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({
      success: false,
      error: {
        code: 'CORS_ERROR',
        message: 'Request blocked by CORS policy'
      }
    });
  });

  it('handles Sequelize validation errors with 400', () => {
    const err = new Error('Validation failed');
    err.name = 'SequelizeValidationError';
    err.errors = [
      { path: 'name', message: 'Name is required' },
      { path: 'score', message: 'Score must be positive' }
    ];

    const req = { originalUrl: '/api/v1/games', method: 'POST', id: 'req-2' };
    const res = createMockResponse();
    const next = vi.fn();

    errorHandler(err, req, res, next);

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toContain('Name is required');
    expect(res.body.error.message).toContain('Score must be positive');
  });

  it('handles Sequelize unique constraint error specifically for username', () => {
    const err = new Error('Unique constraint error');
    err.name = 'SequelizeUniqueConstraintError';
    err.errors = [{ path: 'username', message: 'username must be unique' }];

    const req = { url: '/api/v1/auth/register', method: 'POST' };
    const res = createMockResponse();
    const next = vi.fn();

    errorHandler(err, req, res, next);

    expect(res.statusCode).toBe(400);
    expect(res.body.error.message).toBe('Username is already registered');
  });

  it('handles Sequelize validation error with non-array errors property', () => {
    const err = new Error('Direct validation message');
    err.name = 'SequelizeValidationError';

    const req = { method: 'POST' };
    const res = createMockResponse();
    const next = vi.fn();

    errorHandler(err, req, res, next);

    expect(res.statusCode).toBe(400);
    expect(res.body.error.message).toBe('Direct validation message');
  });

  it('handles Sequelize database errors with 500 without leaking raw SQL in production', () => {
    const err = new Error('SQL syntax error: select * from users where secret');
    err.name = 'SequelizeDatabaseError';

    const req = { originalUrl: '/api/v1/users', method: 'GET', id: 'req-3' };
    const res = createMockResponse();
    const next = vi.fn();

    // With env.NODE_ENV = 'production'
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      errorHandler(err, req, res, next);
      expect(res.statusCode).toBe(500);
      expect(res.body.error.code).toBe('DATABASE_ERROR');
      expect(res.body.error.message).toBe('Database error occurred');
      expect(JSON.stringify(res.body)).not.toContain('SQL syntax error');
    } finally {
      process.env.NODE_ENV = prevEnv;
    }
  });

  it('handles custom application errors with explicit status and code', () => {
    const err = new Error('Giliran belum siap untuk input dadu');
    err.status = 409;
    err.code = 'TURN_NOT_READY';

    const req = { originalUrl: '/api/v1/games/1/roll', method: 'POST', id: 'req-4' };
    const res = createMockResponse();
    const next = vi.fn();

    errorHandler(err, req, res, next);

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      success: false,
      error: {
        code: 'TURN_NOT_READY',
        message: 'Giliran belum siap untuk input dadu'
      }
    });
  });

  it('handles unexpected unknown errors with 500 and redaction in production', () => {
    const err = new Error('Unexpected null reference in engine');

    const req = { originalUrl: '/api/v1/games', method: 'GET', id: 'req-5' };
    const res = createMockResponse();
    const next = vi.fn();

    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      errorHandler(err, req, res, next);
      expect(res.statusCode).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_SERVER_ERROR');
      expect(res.body.error.message).toBe('Internal Server Error');
      expect(res.body.stack).toBeUndefined();
    } finally {
      process.env.NODE_ENV = prevEnv;
    }
  });
});
