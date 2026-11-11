import { Sequelize } from 'sequelize';
import { describe, it, expect, vi } from 'vitest';
import {
  assertValidOrigin,
  parseCookies,
  requireAdminAuth
} from '../middleware/adminAuth.js';
import {
  postLogin,
  getMe,
  postRefresh,
  postLogout
} from '../controllers/adminAuth.js';
import { loginLimiterKeyGenerator, loginLimiterHandler } from '../routes/adminAuth.js';
import { defineAdminIdentity } from '../models/adminIdentity.js';
import { defineAuthAudit } from '../models/authAudit.js';
import * as adminAuthService from '../services/adminAuth.js';

function createUnitSequelize() {
  const sequelize = new Sequelize('lr_test_auth_http_unit', 'unused', '', {
    dialect: 'mysql',
    logging: false
  });
  defineAdminIdentity(sequelize);
  defineAuthAudit(sequelize);
  return sequelize;
}

describe('Admin HTTP Middleware and Controllers Unit', () => {
  describe('assertValidOrigin', () => {
    it('allows requests without origin header', () => {
      expect(() => assertValidOrigin({ headers: {} })).not.toThrow();
    });

    it('allows localhost origin', () => {
      expect(() => assertValidOrigin({ headers: { origin: 'http://localhost:5173' } })).not.toThrow();
      expect(() => assertValidOrigin({ headers: { origin: 'http://127.0.0.1:3000' } })).not.toThrow();
      expect(() => assertValidOrigin({ headers: { origin: 'https://localhost:8443' } })).not.toThrow();
      expect(() => assertValidOrigin({ headers: { origin: 'https://127.0.0.1:8443' } })).not.toThrow();
    });

    it('rejects unauthorized cross-origin', () => {
      expect(() => assertValidOrigin({ headers: { origin: 'http://attacker.com' } })).toThrow(/Cross-origin/i);
    });
  });

  describe('parseCookies', () => {
    it('returns empty object when cookie header is missing or empty', () => {
      expect(parseCookies({ headers: {} })).toEqual({});
      expect(parseCookies({ headers: { cookie: '' } })).toEqual({});
    });

    it('parses cookie string correctly', () => {
      const req = {
        headers: {
          cookie: '__Host-lr_admin_refresh=xyz123; other=hello%20world'
        }
      };
      expect(parseCookies(req)).toEqual({
        '__Host-lr_admin_refresh': 'xyz123',
        other: 'hello world'
      });
    });
  });

  describe('requireAdminAuth middleware', () => {
    it('rejects at the exact access expiry boundary (LR-027)', async () => {
      const sequelize = createUnitSequelize();
      const now = new Date();
      vi.useFakeTimers({ now });
      try {
        vi.spyOn(sequelize.models.AdminAccessToken, 'findOne').mockResolvedValue({
          revokedAt: null, expiresAt: now,
          session: { revokedAt: null, expiresAt: new Date(now.getTime() + 60000),
            user: { isActive: true, role: 'SUPER_ADMIN' } }
        });
        const next = vi.fn();
        const req = { headers: { authorization: 'Bearer boundary-token' }, app: { locals: { sequelize } } };
        await requireAdminAuth(req, {}, next);
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'UNAUTHENTICATED' }));
        expect(req.admin).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });

    it('denies access on a database failure without exposing database details (LR-027)', async () => {
      const sequelize = createUnitSequelize();
      vi.spyOn(sequelize.models.AdminAccessToken, 'findOne').mockRejectedValue(new Error('Private database detail'));
      const req = { headers: { authorization: 'Bearer outage-token' }, app: { locals: { sequelize } } };
      const next = vi.fn();
      await requireAdminAuth(req, {}, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'SERVICE_UNAVAILABLE', statusCode: 503 }));
      expect(next.mock.calls[0][0].message).not.toContain('Private database detail');
      expect(req.admin).toBeUndefined();
    });

    it('calls next with error if Authorization header is missing or non-Bearer', async () => {
      const next1 = vi.fn();
      await requireAdminAuth({ headers: {} }, {}, next1);
      expect(next1).toHaveBeenCalledWith(expect.objectContaining({ code: 'UNAUTHENTICATED' }));

      const next2 = vi.fn();
      await requireAdminAuth({ headers: { authorization: 'Basic 123' } }, {}, next2);
      expect(next2).toHaveBeenCalledWith(expect.objectContaining({ code: 'UNAUTHENTICATED' }));

      const next3 = vi.fn();
      await requireAdminAuth({ headers: { authorization: 'Bearer   ' } }, {}, next3);
      expect(next3).toHaveBeenCalledWith(expect.objectContaining({ code: 'UNAUTHENTICATED' }));
    });

    it('rejects when access token is not found in database', async () => {
      const sequelize = createUnitSequelize();
      vi.spyOn(sequelize.models.AdminAccessToken, 'findOne').mockResolvedValue(null);

      const req = {
        headers: { authorization: 'Bearer my-token' },
        app: { locals: { sequelize } }
      };
      const next = vi.fn();

      await requireAdminAuth(req, {}, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Invalid access token' }));
    });

    it('rejects when access token is revoked or expired', async () => {
      const sequelize = createUnitSequelize();
      const mockRecordRevoked = {
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 10000)
      };
      vi.spyOn(sequelize.models.AdminAccessToken, 'findOne').mockResolvedValue(mockRecordRevoked);

      const next1 = vi.fn();
      await requireAdminAuth({ headers: { authorization: 'Bearer tok' }, app: { locals: { sequelize } } }, {}, next1);
      expect(next1).toHaveBeenCalledWith(expect.objectContaining({ message: 'Access token has been revoked' }));

      const mockRecordExpired = {
        revokedAt: null,
        expiresAt: new Date(Date.now() - 10000)
      };
      vi.spyOn(sequelize.models.AdminAccessToken, 'findOne').mockResolvedValue(mockRecordExpired);

      const next2 = vi.fn();
      await requireAdminAuth({ headers: { authorization: 'Bearer tok' }, app: { locals: { sequelize } } }, {}, next2);
      expect(next2).toHaveBeenCalledWith(expect.objectContaining({ message: 'Access token has expired' }));
    });

    it('rejects when session is missing, revoked, or expired', async () => {
      const sequelize = createUnitSequelize();
      const mockNoSession = { revokedAt: null, expiresAt: new Date(Date.now() + 10000), session: null };
      vi.spyOn(sequelize.models.AdminAccessToken, 'findOne').mockResolvedValue(mockNoSession);
      const nextNoSession = vi.fn();
      await requireAdminAuth({ headers: { authorization: 'Bearer tok' }, app: { locals: { sequelize } } }, {}, nextNoSession);
      expect(nextNoSession).toHaveBeenCalledWith(expect.objectContaining({ message: 'Session not found' }));

      const mockRevoked = {
        revokedAt: null,
        expiresAt: new Date(Date.now() + 10000),
        session: { revokedAt: new Date(), expiresAt: new Date(Date.now() + 10000) }
      };
      vi.spyOn(sequelize.models.AdminAccessToken, 'findOne').mockResolvedValue(mockRevoked);
      const nextRevoked = vi.fn();
      await requireAdminAuth({ headers: { authorization: 'Bearer tok' }, app: { locals: { sequelize } } }, {}, nextRevoked);
      expect(nextRevoked).toHaveBeenCalledWith(expect.objectContaining({ message: 'Admin session has been revoked' }));

      const mockExpired = {
        revokedAt: null,
        expiresAt: new Date(Date.now() + 10000),
        session: { revokedAt: null, expiresAt: new Date(Date.now() - 10000) }
      };
      vi.spyOn(sequelize.models.AdminAccessToken, 'findOne').mockResolvedValue(mockExpired);
      const nextExpired = vi.fn();
      await requireAdminAuth({ headers: { authorization: 'Bearer tok' }, app: { locals: { sequelize } } }, {}, nextExpired);
      expect(nextExpired).toHaveBeenCalledWith(expect.objectContaining({ message: 'Admin session has expired' }));
    });

    it('rejects when user is inactive or not SUPER_ADMIN', async () => {
      const sequelize = createUnitSequelize();
      const mockRecordInactive = {
        revokedAt: null,
        expiresAt: new Date(Date.now() + 10000),
        session: {
          revokedAt: null,
          expiresAt: new Date(Date.now() + 10000),
          user: { isActive: false, role: 'SUPER_ADMIN' }
        }
      };
      vi.spyOn(sequelize.models.AdminAccessToken, 'findOne').mockResolvedValue(mockRecordInactive);
      const next1 = vi.fn();
      await requireAdminAuth({ headers: { authorization: 'Bearer tok' }, app: { locals: { sequelize } } }, {}, next1);
      expect(next1).toHaveBeenCalledWith(expect.objectContaining({ message: 'Admin account is inactive or not found' }));

      const mockRecordWrongRole = {
        revokedAt: null,
        expiresAt: new Date(Date.now() + 10000),
        session: {
          revokedAt: null,
          expiresAt: new Date(Date.now() + 10000),
          user: { isActive: true, role: 'OTHER_ROLE' }
        }
      };
      vi.spyOn(sequelize.models.AdminAccessToken, 'findOne').mockResolvedValue(mockRecordWrongRole);
      const next2 = vi.fn();
      await requireAdminAuth({ headers: { authorization: 'Bearer tok' }, app: { locals: { sequelize } } }, {}, next2);
      expect(next2).toHaveBeenCalledWith(expect.objectContaining({ code: 'FORBIDDEN' }));
    });

    it('attaches req.admin and calls next on successful authentication', async () => {
      const sequelize = createUnitSequelize();
      const mockRecord = {
        revokedAt: null,
        expiresAt: new Date(Date.now() + 10000),
        session: {
          id: 'sess-123',
          revokedAt: null,
          expiresAt: new Date(Date.now() + 10000),
          user: { id: 'u-123', email: 'admin@test.com', role: 'SUPER_ADMIN', isActive: true }
        }
      };
      vi.spyOn(sequelize.models.AdminAccessToken, 'findOne').mockResolvedValue(mockRecord);

      const req = {
        headers: { authorization: 'Bearer valid-tok' },
        app: { locals: { sequelize } }
      };
      const next = vi.fn();

      await requireAdminAuth(req, {}, next);
      expect(next).toHaveBeenCalledWith();
      expect(req.admin).toEqual({
        user: { id: 'u-123', email: 'admin@test.com', role: 'SUPER_ADMIN' },
        session: { id: 'sess-123', expiresAt: mockRecord.session.expiresAt },
        accessTokenRecord: mockRecord
      });
    });
  });

  describe('postLogin controller', () => {
    it('sets cache control, sets __Host- cookie, and returns 200 envelope', async () => {
      const req = {
        headers: { origin: 'http://localhost:5173' },
        body: { email: 'admin@test.com', password: 'ValidPassword123!' },
        id: 'req-123',
        app: { locals: { sequelize: {} } }
      };
      const res = {
        setHeader: vi.fn(),
        cookie: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      };
      const next = vi.fn();

      vi.spyOn(adminAuthService, 'loginAdminUser').mockResolvedValue({
        accessToken: 'access-123',
        accessExpiresAt: '2026-11-10T12:30:00.000Z',
        refreshToken: 'refresh-123',
        refreshExpiresAt: '2026-11-17T12:00:00.000Z',
        user: { id: 'u-1', email: 'admin@test.com', role: 'SUPER_ADMIN' }
      });

      await postLogin(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
      expect(res.cookie).toHaveBeenCalledWith('__Host-lr_admin_refresh', 'refresh-123', expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/'
      }));
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: {
          accessToken: 'access-123',
          accessExpiresAt: '2026-11-10T12:30:00.000Z',
          user: { id: 'u-1', email: 'admin@test.com', role: 'SUPER_ADMIN' }
        }
      });
    });

    it('delegates errors to next', async () => {
      const req = {
        headers: { origin: 'http://attacker.com' },
        body: {},
        app: { locals: { sequelize: {} } }
      };
      const next = vi.fn();
      await postLogin(req, {}, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'FORBIDDEN' }));
    });
  });

  describe('getMe controller', () => {
    it('returns req.admin user and session info', () => {
      const req = {
        admin: {
          user: { id: 'u-1', email: 'admin@test.com', role: 'SUPER_ADMIN' },
          session: { id: 'sess-1', expiresAt: new Date() }
        }
      };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      };

      getMe(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: {
          user: req.admin.user,
          session: { id: 'sess-1', expiresAt: req.admin.session.expiresAt }
        }
      });
    });
  });

  describe('postRefresh controller', () => {
    it('rotates refresh token, sets new cookie, and returns envelope', async () => {
      const req = {
        headers: {
          cookie: '__Host-lr_admin_refresh=old-refresh-token'
        },
        id: 'req-ref-123',
        app: { locals: { sequelize: {} } }
      };
      const res = {
        setHeader: vi.fn(),
        cookie: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      };
      const next = vi.fn();

      vi.spyOn(adminAuthService, 'refreshAdminSession').mockResolvedValue({
        accessToken: 'new-access-token',
        accessExpiresAt: '2026-11-10T12:45:00.000Z',
        refreshToken: 'new-refresh-token',
        refreshExpiresAt: '2026-11-17T12:30:00.000Z',
        user: { id: 'u-1', email: 'admin@test.com', role: 'SUPER_ADMIN' }
      });

      await postRefresh(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
      expect(res.cookie).toHaveBeenCalledWith('__Host-lr_admin_refresh', 'new-refresh-token', expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/'
      }));
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: {
          accessToken: 'new-access-token',
          accessExpiresAt: '2026-11-10T12:45:00.000Z',
          user: { id: 'u-1', email: 'admin@test.com', role: 'SUPER_ADMIN' }
        }
      });
    });

    it('delegates refresh errors to next', async () => {
      const req = {
        headers: { origin: 'http://attacker.com' },
        app: { locals: { sequelize: {} } }
      };
      const next = vi.fn();
      await postRefresh(req, {}, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'FORBIDDEN' }));
    });
  });

  describe('postLogout controller', () => {
    it('revokes session, clears __Host- cookie, and returns loggedOut: true', async () => {
      const req = {
        headers: {
          authorization: 'Bearer current-access-token',
          cookie: '__Host-lr_admin_refresh=current-refresh-token'
        },
        id: 'req-logout-123',
        app: { locals: { sequelize: {} } }
      };
      const res = {
        setHeader: vi.fn(),
        cookie: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      };
      const next = vi.fn();

      vi.spyOn(adminAuthService, 'logoutAdminSession').mockResolvedValue({ loggedOut: true });

      await postLogout(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
      expect(res.cookie).toHaveBeenCalledWith('__Host-lr_admin_refresh', '', expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 0
      }));
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: { loggedOut: true }
      });
    });

    it('delegates logout errors to next', async () => {
      const req = {
        headers: { origin: 'http://attacker.com' },
        app: { locals: { sequelize: {} } }
      };
      const next = vi.fn();
      await postLogout(req, {}, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'FORBIDDEN' }));
    });
  });

  describe('loginLimiter rate limiter helpers', () => {
    it('generates composite key from IP and email', () => {
      expect(loginLimiterKeyGenerator({ ip: '127.0.0.1', body: { email: 'Admin@Test.Com ' } })).toBe('127.0.0.1:admin@test.com');
      expect(loginLimiterKeyGenerator({ ip: null, socket: { remoteAddress: '10.0.0.1' }, body: {} })).toBe('10.0.0.1:');
    });

    it('returns 429 RATE_LIMITED on rate limit handler', () => {
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      };
      loginLimiterHandler({}, res);
      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          code: 'RATE_LIMITED',
          message: expect.stringContaining('Too many failed login attempts')
        }
      });
    });
  });
});
