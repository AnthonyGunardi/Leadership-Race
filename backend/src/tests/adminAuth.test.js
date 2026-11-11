import { randomUUID } from 'node:crypto';
import { Sequelize } from 'sequelize';
import { describe, it, expect, vi } from 'vitest';
import { defineAdminIdentity } from '../models/adminIdentity.js';
import { defineAuthAudit } from '../models/authAudit.js';
import { hashPassword } from '../services/adminCredentials.js';
import {
  ACCESS_TOKEN_TTL_MS,
  REFRESH_TOKEN_TTL_MS,
  AuthError,
  hashToken,
  generateOpaqueToken,
  loginAdminUser,
  refreshAdminSession,
  logoutAdminSession
} from '../services/adminAuth.js';
import { validateLoginPayload } from '../validation/adminAuth.js';

function createUnitSequelize() {
  const sequelize = new Sequelize('lr_test_auth_unit', 'unused', '', {
    dialect: 'mysql',
    logging: false
  });
  defineAdminIdentity(sequelize);
  defineAuthAudit(sequelize);
  return sequelize;
}

describe('Admin authentication service and validation', () => {
  describe('validateLoginPayload', () => {
    it('accepts valid credentials and normalizes email', () => {
      const result = validateLoginPayload({
        email: ' Admin@Example.COM ',
        password: 'ValidPassword123!'
      });
      expect(result).toEqual({
        email: 'admin@example.com',
        password: 'ValidPassword123!'
      });
    });

    it('rejects unknown fields strictly', () => {
      expect(() => validateLoginPayload({
        email: 'admin@example.com',
        password: 'ValidPassword123!',
        extra: 'not allowed'
      })).toThrow(/unrecognized key/i);
    });

    it('rejects invalid email formats', () => {
      expect(() => validateLoginPayload({
        email: 'not-an-email',
        password: 'ValidPassword123!'
      })).toThrow(/Invalid email/i);
    });

    it('rejects password shorter than 8 characters or longer than 72 bytes', () => {
      expect(() => validateLoginPayload({
        email: 'admin@example.com',
        password: 'short'
      })).toThrow(/at least 8 characters/i);

      expect(() => validateLoginPayload({
        email: 'admin@example.com',
        password: 'a'.repeat(73)
      })).toThrow(/cannot exceed 72 bytes/i);
    });
  });

  describe('Tokens and hashing', () => {
    it('generates opaque 32-byte base64url tokens and computes sha256 hash', () => {
      const token = generateOpaqueToken();
      expect(token).toBeTypeOf('string');
      expect(token.length).toBeGreaterThanOrEqual(42);

      const hash = hashToken(token);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
      expect(hash).not.toBe(token);
    });

    it('enforces expected TTL constants', () => {
      expect(ACCESS_TOKEN_TTL_MS).toBe(15 * 60 * 1000);
      expect(REFRESH_TOKEN_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
    });
  });

  describe('loginAdminUser', () => {
    it('throws error when sequelize is missing', async () => {
      await expect(loginAdminUser({
        email: 'admin@example.test',
        password: 'ValidPassword123!'
      })).rejects.toThrow('Sequelize instance is required for login');
    });

    it('authenticates active user and issues session, access, and refresh tokens', async () => {
      const sequelize = createUnitSequelize();
      const rawPassword = 'ValidPassword123!';
      const passwordHash = await hashPassword(rawPassword);
      const userId = randomUUID();

      const user = {
        id: userId,
        email: 'admin@example.test',
        passwordHash,
        role: 'SUPER_ADMIN',
        isActive: true
      };

      vi.spyOn(sequelize.models.User, 'findOne').mockResolvedValue(user);
      const spySessionCreate = vi.spyOn(sequelize.models.AdminSession, 'create').mockResolvedValue({ id: randomUUID() });
      const spyRefreshCreate = vi.spyOn(sequelize.models.AdminRefreshToken, 'create').mockResolvedValue({});
      const spyAccessCreate = vi.spyOn(sequelize.models.AdminAccessToken, 'create').mockResolvedValue({});
      const spyAuditCreate = vi.spyOn(sequelize.models.AuditLog, 'create').mockResolvedValue({});
      vi.spyOn(sequelize, 'transaction').mockImplementation(async (cb) => cb(null));

      const result = await loginAdminUser({
        sequelize,
        email: 'admin@example.test',
        password: rawPassword,
        requestId: '11111111-2222-4333-8444-555555555555'
      });

      expect(result.user).toEqual({
        id: userId,
        email: 'admin@example.test',
        role: 'SUPER_ADMIN'
      });
      expect(result.accessToken).toBeTypeOf('string');
      expect(result.refreshToken).toBeTypeOf('string');
      expect(spySessionCreate).toHaveBeenCalled();
      expect(spyRefreshCreate).toHaveBeenCalled();
      expect(spyAccessCreate).toHaveBeenCalled();
      expect(spyAuditCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'ADMIN_LOGIN_SUCCESS',
          actorUserId: userId
        }),
        { transaction: null }
      );
    });

    it('rejects with AuthError when user is not found', async () => {
      const sequelize = createUnitSequelize();
      vi.spyOn(sequelize.models.User, 'findOne').mockResolvedValue(null);
      const spyAuditCreate = vi.spyOn(sequelize.models.AuditLog, 'create').mockResolvedValue({});

      await expect(loginAdminUser({
        sequelize,
        email: 'missing@example.test',
        password: 'ValidPassword123!'
      })).rejects.toBeInstanceOf(AuthError);

      expect(spyAuditCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'ADMIN_LOGIN_FAILURE',
          actorUserId: null
        })
      );
    });

    it('rejects with AuthError when user is inactive', async () => {
      const sequelize = createUnitSequelize();
      const rawPassword = 'ValidPassword123!';
      const passwordHash = await hashPassword(rawPassword);

      vi.spyOn(sequelize.models.User, 'findOne').mockResolvedValue({
        id: randomUUID(),
        email: 'inactive@example.test',
        passwordHash,
        role: 'SUPER_ADMIN',
        isActive: false
      });
      const spyAuditCreate = vi.spyOn(sequelize.models.AuditLog, 'create').mockResolvedValue({});

      await expect(loginAdminUser({
        sequelize,
        email: 'inactive@example.test',
        password: rawPassword
      })).rejects.toBeInstanceOf(AuthError);

      expect(spyAuditCreate).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ADMIN_LOGIN_FAILURE' })
      );
    });

    it('rejects with AuthError and handles audit failure logging error gracefully', async () => {
      const sequelize = createUnitSequelize();
      vi.spyOn(sequelize.models.User, 'findOne').mockResolvedValue(null);
      // Simulate audit write failure on failure logging
      vi.spyOn(sequelize.models.AuditLog, 'create').mockRejectedValue(new Error('Audit DB down'));

      await expect(loginAdminUser({
        sequelize,
        email: 'missing@example.test',
        password: 'ValidPassword123!'
      })).rejects.toBeInstanceOf(AuthError);
    });
  });

  describe('refreshAdminSession', () => {
    it('throws error when sequelize is missing', async () => {
      await expect(refreshAdminSession({
        refreshToken: 'valid-refresh-token'
      })).rejects.toThrow('Sequelize instance is required for session refresh');
    });

    it('rejects when refreshToken is missing or invalid type', async () => {
      const sequelize = createUnitSequelize();
      await expect(refreshAdminSession({
        sequelize,
        refreshToken: ''
      })).rejects.toBeInstanceOf(AuthError);

      await expect(refreshAdminSession({
        sequelize,
        refreshToken: null
      })).rejects.toBeInstanceOf(AuthError);
    });

    it('rejects when refresh token record is not found', async () => {
      const sequelize = createUnitSequelize();
      vi.spyOn(sequelize, 'transaction').mockImplementation(async (cb) => {
        return cb({});
      });
      vi.spyOn(sequelize.models.AdminRefreshToken, 'findOne').mockResolvedValue(null);

      await expect(refreshAdminSession({
        sequelize,
        refreshToken: 'non-existent-token'
      })).rejects.toThrow('Session expired, revoked, or invalid');
    });

    it('detects token reuse, revokes session, and throws unauthenticated error', async () => {
      const sequelize = createUnitSequelize();
      const mockSession = {
        id: 'sess-123',
        userId: 'u-123',
        revokedAt: null,
        revokedReason: null,
        save: vi.fn().mockResolvedValue({})
      };
      const mockTokenRecord = {
        id: 'tok-1',
        usedAt: new Date(Date.now() - 60000), // already spent
        session: mockSession
      };

      vi.spyOn(sequelize, 'transaction').mockImplementation(async (cb) => {
        return cb({});
      });
      vi.spyOn(sequelize.models.AdminRefreshToken, 'findOne').mockResolvedValue(mockTokenRecord);
      const spyAccessTokenUpdate = vi.spyOn(sequelize.models.AdminAccessToken, 'update').mockResolvedValue([1]);
      const spyAuditCreate = vi.spyOn(sequelize.models.AuditLog, 'create').mockResolvedValue({});

      await expect(refreshAdminSession({
        sequelize,
        refreshToken: 'spent-token'
      })).rejects.toThrow('Refresh token reuse detected; session has been revoked');

      expect(mockSession.revokedReason).toBe('REFRESH_TOKEN_REUSE_DETECTED');
      expect(mockSession.save).toHaveBeenCalled();
      expect(spyAccessTokenUpdate).toHaveBeenCalled();
      expect(spyAuditCreate).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ADMIN_SESSION_REVOKED_REUSE' }),
        expect.anything()
      );
    });

    it('rejects when session is revoked or expired', async () => {
      const sequelize = createUnitSequelize();
      const mockTokenRecord = {
        id: 'tok-1',
        usedAt: null,
        expiresAt: new Date(Date.now() + 60000),
        session: {
          id: 'sess-123',
          revokedAt: new Date(),
          expiresAt: new Date(Date.now() + 60000)
        }
      };

      vi.spyOn(sequelize, 'transaction').mockImplementation(async (cb) => cb({}));
      vi.spyOn(sequelize.models.AdminRefreshToken, 'findOne').mockResolvedValue(mockTokenRecord);

      await expect(refreshAdminSession({
        sequelize,
        refreshToken: 'valid-token'
      })).rejects.toThrow('Session expired, revoked, or invalid');
    });

    it.each(['session', 'refresh'])('rejects at the exact %s expiry boundary (LR-027)', async (expired) => {
      const sequelize = createUnitSequelize();
      const now = new Date();
      const future = new Date(now.getTime() + 60000);
      const session = { id: 'session-boundary', expiresAt: expired === 'session' ? now : future,
        revokedAt: null, refreshGeneration: 0,
        user: { id: 'u-boundary', isActive: true, role: 'SUPER_ADMIN' }, save: vi.fn() };
      const record = { id: 'refresh-boundary', session, usedAt: null,
        expiresAt: expired === 'refresh' ? now : future, save: vi.fn() };
      vi.spyOn(sequelize, 'transaction').mockImplementation(async (cb) => cb({}));
      vi.spyOn(sequelize.models.AdminRefreshToken, 'findOne').mockResolvedValue(record);
      const issueRefresh = vi.spyOn(sequelize.models.AdminRefreshToken, 'create').mockResolvedValue({ id: 'new' });
      vi.spyOn(sequelize.models.AdminAccessToken, 'create').mockResolvedValue({});
      vi.spyOn(sequelize.models.AuditLog, 'create').mockResolvedValue({});
      vi.useFakeTimers({ now });
      try {
        let rejection;
        try {
          await refreshAdminSession({ sequelize, refreshToken: 'boundary' });
        } catch (error) {
          rejection = error.code;
        }
        expect(rejection).toBe('UNAUTHENTICATED');
        expect(issueRefresh).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('rejects when refresh token itself has expired', async () => {
      const sequelize = createUnitSequelize();
      const mockTokenRecord = {
        id: 'tok-1',
        usedAt: null,
        expiresAt: new Date(Date.now() - 1000), // expired
        session: {
          id: 'sess-123',
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60000),
          user: { isActive: true, role: 'SUPER_ADMIN' }
        }
      };

      vi.spyOn(sequelize, 'transaction').mockImplementation(async (cb) => cb({}));
      vi.spyOn(sequelize.models.AdminRefreshToken, 'findOne').mockResolvedValue(mockTokenRecord);

      await expect(refreshAdminSession({
        sequelize,
        refreshToken: 'expired-token'
      })).rejects.toThrow('Session expired, revoked, or invalid');
    });

    it('rejects when user is inactive or not SUPER_ADMIN', async () => {
      const sequelize = createUnitSequelize();
      const mockTokenRecord = {
        id: 'tok-1',
        usedAt: null,
        expiresAt: new Date(Date.now() + 60000),
        session: {
          id: 'sess-123',
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60000),
          user: { isActive: false, role: 'SUPER_ADMIN' }
        }
      };

      vi.spyOn(sequelize, 'transaction').mockImplementation(async (cb) => cb({}));
      vi.spyOn(sequelize.models.AdminRefreshToken, 'findOne').mockResolvedValue(mockTokenRecord);

      await expect(refreshAdminSession({
        sequelize,
        refreshToken: 'valid-token'
      })).rejects.toThrow('Session expired, revoked, or invalid');
    });

    it('successfully rotates refresh token and issues new access token', async () => {
      const sequelize = createUnitSequelize();
      const mockSession = {
        id: 'sess-123',
        refreshGeneration: 1,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60000),
        user: { id: 'u-123', email: 'admin@test.com', role: 'SUPER_ADMIN', isActive: true },
        save: vi.fn().mockResolvedValue({})
      };
      const mockTokenRecord = {
        id: 'tok-1',
        usedAt: null,
        expiresAt: new Date(Date.now() + 60000),
        session: mockSession,
        save: vi.fn().mockResolvedValue({})
      };

      vi.spyOn(sequelize, 'transaction').mockImplementation(async (cb) => cb({}));
      vi.spyOn(sequelize.models.AdminRefreshToken, 'findOne').mockResolvedValue(mockTokenRecord);
      const spyNewRefresh = vi.spyOn(sequelize.models.AdminRefreshToken, 'create').mockResolvedValue({ id: 'new-tok-id' });
      const spyNewAccess = vi.spyOn(sequelize.models.AdminAccessToken, 'create').mockResolvedValue({});
      const spyAuditCreate = vi.spyOn(sequelize.models.AuditLog, 'create').mockResolvedValue({});

      const result = await refreshAdminSession({
        sequelize,
        refreshToken: 'valid-refresh-token',
        requestId: 'req-456'
      });

      expect(mockSession.refreshGeneration).toBe(2);
      expect(mockSession.save).toHaveBeenCalled();
      expect(mockTokenRecord.usedAt).not.toBeNull();
      expect(mockTokenRecord.replacedBy).toBe('new-tok-id');
      expect(mockTokenRecord.save).toHaveBeenCalled();
      expect(spyNewRefresh).toHaveBeenCalled();
      expect(spyNewAccess).toHaveBeenCalled();
      expect(spyAuditCreate).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ADMIN_TOKEN_REFRESH' }),
        expect.anything()
      );
      expect(result.accessToken).toBeTypeOf('string');
      expect(result.refreshToken).toBeTypeOf('string');
      expect(result.user).toEqual({
        id: 'u-123',
        email: 'admin@test.com',
        role: 'SUPER_ADMIN'
      });
    });
  });

  describe('logoutAdminSession', () => {
    it('throws error when sequelize is missing', async () => {
      await expect(logoutAdminSession({})).rejects.toThrow('Sequelize instance is required for logout');
    });

    it('revokes session and access tokens when accessToken is provided', async () => {
      const sequelize = createUnitSequelize();
      const mockSession = {
        id: 'sess-123',
        userId: 'u-123',
        revokedAt: null,
        revokedReason: null,
        save: vi.fn().mockResolvedValue({})
      };
      vi.spyOn(sequelize.models.AdminAccessToken, 'findOne').mockResolvedValue({
        session: mockSession
      });
      vi.spyOn(sequelize, 'transaction').mockImplementation(async (cb) => cb({}));
      const spyTokenUpdate = vi.spyOn(sequelize.models.AdminAccessToken, 'update').mockResolvedValue([1]);
      const spyAuditCreate = vi.spyOn(sequelize.models.AuditLog, 'create').mockResolvedValue({});

      const result = await logoutAdminSession({
        sequelize,
        accessToken: 'access-token-123'
      });

      expect(result).toEqual({ loggedOut: true });
      expect(mockSession.revokedAt).not.toBeNull();
      expect(mockSession.revokedReason).toBe('LOGOUT');
      expect(mockSession.save).toHaveBeenCalled();
      expect(spyTokenUpdate).toHaveBeenCalled();
      expect(spyAuditCreate).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ADMIN_LOGOUT' }),
        expect.anything()
      );
    });

    it('revokes session when only refreshToken is provided', async () => {
      const sequelize = createUnitSequelize();
      const mockSession = {
        id: 'sess-456',
        userId: 'u-456',
        revokedAt: null,
        revokedReason: null,
        save: vi.fn().mockResolvedValue({})
      };
      vi.spyOn(sequelize.models.AdminAccessToken, 'findOne').mockResolvedValue(null);
      vi.spyOn(sequelize.models.AdminRefreshToken, 'findOne').mockResolvedValue({
        session: mockSession
      });
      vi.spyOn(sequelize, 'transaction').mockImplementation(async (cb) => cb({}));
      vi.spyOn(sequelize.models.AdminAccessToken, 'update').mockResolvedValue([1]);
      vi.spyOn(sequelize.models.AuditLog, 'create').mockResolvedValue({});

      const result = await logoutAdminSession({
        sequelize,
        refreshToken: 'refresh-token-456'
      });

      expect(result).toEqual({ loggedOut: true });
      expect(mockSession.revokedAt).not.toBeNull();
    });

    it('returns { loggedOut: true } idempotently when session is already revoked or token not found', async () => {
      const sequelize = createUnitSequelize();
      vi.spyOn(sequelize.models.AdminAccessToken, 'findOne').mockResolvedValue(null);
      vi.spyOn(sequelize.models.AdminRefreshToken, 'findOne').mockResolvedValue(null);

      const result = await logoutAdminSession({
        sequelize,
        accessToken: 'invalid-token'
      });

      expect(result).toEqual({ loggedOut: true });
    });
  });
});
