import { randomUUID } from 'node:crypto';
import { Sequelize } from 'sequelize';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { defineAdminIdentity } from '../models/adminIdentity.js';

const bcryptHashFixture = `$2b$12$${'a'.repeat(53)}`;
const dates = { createdAt: new Date(), updatedAt: new Date(), expiresAt: new Date() };

describe('Admin identity persistence validation without I/O', () => {
  let sequelize;
  let models;

  beforeAll(() => {
    sequelize = new Sequelize('lr_test_models', 'unused', '', { dialect: 'mysql', logging: false });
    models = defineAdminIdentity(sequelize);
  });

  afterAll(async () => {
    await sequelize.close();
  });

  it('accepts an active Super Admin with normalized email and a bcrypt hash', async () => {
    const user = models.User.build({ ...dates, email: 'admin@example.test', passwordHash: bcryptHashFixture });
    await expect(user.validate()).resolves.toBe(user);
    expect(user).toMatchObject({ role: 'SUPER_ADMIN', isActive: true });
    expect(user.id).toMatch(/^[a-f0-9-]{36}$/);
  });

  it.each([
    { email: 'ADMIN@example.test' }, { email: ' admin@example.test' }, { email: 'invalid' },
    { passwordHash: 'plaintext' }, { passwordHash: bcryptHashFixture.replace('$12$', '$10$') },
    { role: 'DISPLAY' }, { id: 'not-a-uuid' }, { email: null },
    { id: 'ABCDEF00-0000-4000-8000-000000000001' }
  ])('rejects invalid identity data %#', async (overrides) => {
    await expect(models.User.build({
      ...dates, email: 'admin@example.test', passwordHash: bcryptHashFixture, ...overrides
    }).validate()).rejects.toMatchObject({ name: 'SequelizeValidationError' });
  });

  it('accepts nullable revocation and rotation metadata on newly issued records', async () => {
    const session = models.AdminSession.build({ ...dates, userId: randomUUID() });
    const refresh = models.AdminRefreshToken.build({
      ...dates, sessionId: session.id, tokenHash: 'a'.repeat(64), generation: 0
    });
    const access = models.AdminAccessToken.build({ ...dates, sessionId: session.id, tokenHash: 'b'.repeat(64) });
    await expect(session.validate()).resolves.toBe(session);
    await expect(refresh.validate()).resolves.toBe(refresh);
    await expect(access.validate()).resolves.toBe(access);
    expect(session).toMatchObject({ refreshGeneration: 0, revokedAt: null, revokedReason: null });
    expect(refresh).toMatchObject({ usedAt: null, replacedBy: null });
    expect(access.revokedAt).toBeNull();
  });

  it.each(['AdminSession', 'AdminRefreshToken', 'AdminAccessToken'])('requires expiry and a parent for %s', async (name) => {
    await expect(models[name].build(dates).validate()).rejects.toMatchObject({ name: 'SequelizeValidationError' });
    const valid = { ...dates, userId: randomUUID(), sessionId: randomUUID(), tokenHash: 'a'.repeat(64), generation: 0 };
    await expect(models[name].build({ ...valid, expiresAt: null }).validate())
      .rejects.toMatchObject({ name: 'SequelizeValidationError' });
  });

  it.each(['AdminRefreshToken', 'AdminAccessToken'])('rejects raw credential material as a %s hash', async (name) => {
    await expect(models[name].build({
      ...dates, sessionId: randomUUID(), tokenHash: 'opaque-token-instead-of-hash', generation: 0
    }).validate()).rejects.toMatchObject({ name: 'SequelizeValidationError' });
  });

  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1])('rejects unsafe refresh generation %s', async (value) => {
    await expect(models.AdminSession.build({ ...dates, userId: randomUUID(), refreshGeneration: value }).validate())
      .rejects.toMatchObject({ name: 'SequelizeValidationError' });
    await expect(models.AdminRefreshToken.build({
      ...dates, sessionId: randomUUID(), tokenHash: 'a'.repeat(64), generation: value
    }).validate()).rejects.toMatchObject({ name: 'SequelizeValidationError' });
  });

  it('accepts the maximum safe generation without converting BIGINT storage to a lossy number', async () => {
    const generation = String(Number.MAX_SAFE_INTEGER);
    const refresh = models.AdminRefreshToken.build({
      ...dates, sessionId: randomUUID(), tokenHash: 'a'.repeat(64), generation
    });
    await expect(refresh.validate()).resolves.toBe(refresh);
    expect(refresh.generation).toBe(generation);
  });
});
