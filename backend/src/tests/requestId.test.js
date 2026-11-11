import { describe, it, expect, vi } from 'vitest';
import { requestIdMiddleware, isValidUuid } from '../middleware/requestId.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('isValidUuid', () => {
  it('validates proper UUID v4 strings', () => {
    expect(isValidUuid('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
    expect(isValidUuid('9629551d-ca48-4fa6-94e9-e0ab3d0d7751')).toBe(true);
  });

  it('rejects invalid or unsafe strings', () => {
    expect(isValidUuid('invalid-uuid')).toBe(false);
    expect(isValidUuid('<script>alert(1)</script>')).toBe(false);
    expect(isValidUuid('')).toBe(false);
    expect(isValidUuid(null)).toBe(false);
    expect(isValidUuid(12345)).toBe(false);
  });
});

describe('requestIdMiddleware', () => {
  it('generates a fresh UUID when X-Request-Id header is absent', () => {
    const req = { headers: {} };
    const headersSet = {};
    const res = {
      setHeader: vi.fn((key, val) => {
        headersSet[key.toLowerCase()] = val;
      })
    };
    const next = vi.fn();

    requestIdMiddleware(req, res, next);

    expect(req.id).toMatch(UUID_REGEX);
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', req.id);
    expect(headersSet['x-request-id']).toBe(req.id);
    expect(next).toHaveBeenCalledOnce();
  });

  it('preserves valid client-provided X-Request-Id header', () => {
    const clientUuid = '9629551d-ca48-4fa6-94e9-e0ab3d0d7751';
    const req = { headers: { 'x-request-id': clientUuid } };
    const res = { setHeader: vi.fn() };
    const next = vi.fn();

    requestIdMiddleware(req, res, next);

    expect(req.id).toBe(clientUuid);
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', clientUuid);
    expect(next).toHaveBeenCalledOnce();
  });

  it('replaces unsafe or invalid client-provided header with a fresh UUID', () => {
    const req = { headers: { 'x-request-id': 'malicious-injected\r\nHeader: value' } };
    const res = { setHeader: vi.fn() };
    const next = vi.fn();

    requestIdMiddleware(req, res, next);

    expect(req.id).not.toBe('malicious-injected\r\nHeader: value');
    expect(req.id).toMatch(UUID_REGEX);
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', req.id);
    expect(next).toHaveBeenCalledOnce();
  });

  it('handles request object without headers safely', () => {
    const req = {};
    const res = {};
    const next = vi.fn();

    requestIdMiddleware(req, res, next);

    expect(req.id).toMatch(UUID_REGEX);
    expect(next).toHaveBeenCalledOnce();
  });
});
