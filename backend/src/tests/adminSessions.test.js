import { Sequelize } from 'sequelize';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineAdminIdentity } from '../models/adminIdentity.js';
import { authorizeAdminAccess } from '../services/adminSessions.js';

afterEach(() => { vi.restoreAllMocks(); });

describe('Shared admin authorization boundary (LR-027)', () => {
  it.each([undefined, '', '   ', 123])('rejects missing/non-string credentials: %s', async (accessToken) => {
    await expect(authorizeAdminAccess({ sequelize: null, accessToken })).rejects.toMatchObject({
      code: 'UNAUTHENTICATED', statusCode: 401
    });
  });

  it('rejects an exactly expired session and invalid dates without a sliding write', async () => {
    const sequelize = new Sequelize('lr_test_session_unit', 'unused', '', { dialect: 'mysql', logging: false });
    const models = defineAdminIdentity(sequelize);
    const now = new Date();
    const find = vi.spyOn(models.AdminAccessToken, 'findOne');
    const write = vi.spyOn(models.AdminSession, 'update');
    vi.useFakeTimers({ now });
    try {
      const record = { revokedAt: null, expiresAt: new Date(now.getTime() + 60000),
        session: { expiresAt: now, revokedAt: null, user: { isActive: true, role: 'SUPER_ADMIN' } } };
      find.mockResolvedValue(record);
      await expect(authorizeAdminAccess({ sequelize, accessToken: 'boundary' })).rejects.toMatchObject({
        code: 'UNAUTHENTICATED'
      });
      record.session.expiresAt = 'invalid';
      await expect(authorizeAdminAccess({ sequelize, accessToken: 'invalid-date' })).rejects.toMatchObject({
        code: 'UNAUTHENTICATED'
      });
      record.expiresAt = 'invalid';
      await expect(authorizeAdminAccess({ sequelize, accessToken: 'invalid-access-date' })).rejects.toMatchObject({
        code: 'UNAUTHENTICATED'
      });
      expect(write).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
