import { randomUUID } from 'node:crypto';
import { Sequelize } from 'sequelize';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { defineAdminIdentity } from '../models/adminIdentity.js';
import { defineAuthAudit } from '../models/authAudit.js';

const dates = {
  createdAt: new Date(),
  updatedAt: new Date(),
  occurredAt: new Date()
};

describe('Auth audit persistence validation without I/O', () => {
  let sequelize;
  let models;

  beforeAll(() => {
    sequelize = new Sequelize('lr_test_audit_models', 'unused', '', {
      dialect: 'mysql',
      logging: false
    });
    defineAdminIdentity(sequelize);
    models = defineAuthAudit(sequelize);
  });

  afterAll(async () => {
    await sequelize.close();
  });

  it('accepts a valid USER audit log entry and associates with User model', async () => {
    const entry = models.AuditLog.build({
      ...dates,
      actorType: 'USER',
      actorUserId: randomUUID(),
      action: 'ADMIN_LOGIN_SUCCESS',
      afterJson: { ip: '127.0.0.1' },
      requestId: randomUUID()
    });

    await expect(entry.validate()).resolves.toBe(entry);
    expect(entry.id).toMatch(/^[a-f0-9-]{36}$/);
    expect(entry.actorType).toBe('USER');
    expect(entry.gameId).toBeNull();
    expect(models.AuditLog.associations.actorUser).toBeDefined();
  });

  it('accepts a valid SYSTEM audit log entry with null actorUserId', async () => {
    const entry = models.AuditLog.build({
      ...dates,
      actorType: 'SYSTEM',
      actorUserId: null,
      action: 'SERVER_STARTUP',
      reason: 'Scheduled maintenance',
      requestId: randomUUID()
    });

    await expect(entry.validate()).resolves.toBe(entry);
    expect(entry.actorType).toBe('SYSTEM');
    expect(entry.actorUserId).toBeNull();
  });

  it('rejects SYSTEM actor with a non-null actorUserId', async () => {
    const entry = models.AuditLog.build({
      ...dates,
      actorType: 'SYSTEM',
      actorUserId: randomUUID(),
      action: 'SERVER_STARTUP'
    });

    await expect(entry.validate()).rejects.toThrow('SYSTEM actor must have null actor_user_id');
  });

  it('rejects USER actor with a null actorUserId', async () => {
    const entry = models.AuditLog.build({
      ...dates,
      actorType: 'USER',
      actorUserId: null,
      action: 'ADMIN_LOGIN'
    });

    await expect(entry.validate()).rejects.toThrow('USER actor must specify actor_user_id');
  });

  it('rejects empty action string', async () => {
    const entry = models.AuditLog.build({
      ...dates,
      actorType: 'USER',
      actorUserId: randomUUID(),
      action: ''
    });

    await expect(entry.validate()).rejects.toMatchObject({
      name: 'SequelizeValidationError'
    });
  });

  it('rejects invalid UUID fields', async () => {
    const entry = models.AuditLog.build({
      ...dates,
      actorType: 'USER',
      actorUserId: 'invalid-uuid',
      action: 'ADMIN_LOGIN'
    });

    await expect(entry.validate()).rejects.toThrow('Value must be a valid lowercase UUID v4');
  });

  it('accepts valid gameId and rejects invalid gameId', async () => {
    const validEntry = models.AuditLog.build({
      ...dates,
      actorType: 'SYSTEM',
      actorUserId: null,
      action: 'GAME_ACTION',
      gameId: randomUUID()
    });
    await expect(validEntry.validate()).resolves.toBe(validEntry);

    const invalidEntry = models.AuditLog.build({
      ...dates,
      actorType: 'SYSTEM',
      actorUserId: null,
      action: 'GAME_ACTION',
      gameId: 'invalid-game-uuid'
    });
    await expect(invalidEntry.validate()).rejects.toThrow('Value must be a valid lowercase UUID v4');
  });

  it('parses beforeJson and afterJson properly whether provided as object, valid JSON string, or malformed string', () => {
    const entry = models.AuditLog.build({
      ...dates,
      actorType: 'SYSTEM',
      actorUserId: null,
      action: 'TEST_GETTERS',
      beforeJson: { count: 1 },
      afterJson: '{"count":2}'
    });

    expect(entry.beforeJson).toEqual({ count: 1 });
    expect(entry.afterJson).toEqual({ count: 2 });

    // Test malformed string fallback
    entry.setDataValue('afterJson', '{invalid json');
    expect(entry.afterJson).toBe('{invalid json');

    entry.setDataValue('beforeJson', '{invalid json');
    expect(entry.beforeJson).toBe('{invalid json');

    // Test null
    entry.setDataValue('afterJson', null);
    expect(entry.afterJson).toBeNull();
  });
});
