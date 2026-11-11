import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getEnv } from '../../config/environment.js';
import { defineAdminIdentity } from '../../models/adminIdentity.js';
import { defineAuthAudit } from '../../models/authAudit.js';
import { setupIsolatedTestDatabase } from '../helpers/testDatabase.js';
import { bootstrapAdminUser } from '../../services/adminBootstrap.js';
import { loginAdminUser } from '../../services/adminAuth.js';

const require = createRequire(import.meta.url);
const runFile = promisify(execFile);
const migrationDirectory = fileURLToPath(new URL('../../../migrations/', import.meta.url));

describe('Admin login service and session issuance on isolated MySQL', () => {
  let testDb;
  let identityModels;
  let auditModels;

  beforeAll(async () => {
    testDb = await setupIsolatedTestDatabase();
    const env = getEnv();
    await runFile(process.execPath, [
      require.resolve('sequelize-cli/lib/sequelize'), 'db:migrate', '--env', 'test',
      '--config', fileURLToPath(new URL('../../../sequelize.config.cjs', import.meta.url)),
      '--migrations-path', migrationDirectory
    ], {
      env: {
        ...process.env,
        NODE_ENV: 'test',
        DB_NAME: testDb.schemaName,
        DB_HOST: env.DB_HOST,
        DB_PORT: String(env.DB_PORT),
        DB_USER: env.DB_USER,
        DB_PASSWORD: env.DB_PASSWORD
      }
    });

    identityModels = defineAdminIdentity(testDb.sequelize);
    auditModels = defineAuthAudit(testDb.sequelize);
  });

  afterAll(async () => {
    await testDb?.cleanup();
  });

  it('authenticates valid credentials and issues opaque access and refresh tokens', async () => {
    const email = `login_success_${Date.now()}@example.test`;
    const password = 'CorrectPassword2026!';
    const user = await bootstrapAdminUser({
      sequelize: testDb.sequelize,
      email,
      password
    });

    const requestId = randomUUID();
    const beforeTime = Date.now();
    const loginResult = await loginAdminUser({
      sequelize: testDb.sequelize,
      email,
      password,
      requestId
    });

    expect(loginResult.user).toMatchObject({
      id: user.id,
      email: email.toLowerCase(),
      role: 'SUPER_ADMIN'
    });

    // Verify token formats (32 bytes base64url = ~43-44 chars)
    expect(loginResult.accessToken).toBeTypeOf('string');
    expect(loginResult.accessToken.length).toBeGreaterThanOrEqual(42);
    expect(loginResult.refreshToken).toBeTypeOf('string');
    expect(loginResult.refreshToken.length).toBeGreaterThanOrEqual(42);

    // Verify TTL
    const accessExpires = new Date(loginResult.accessExpiresAt).getTime();
    const refreshExpires = new Date(loginResult.refreshExpiresAt).getTime();
    // Access token is 15 minutes (~900,000 ms)
    expect(accessExpires - beforeTime).toBeGreaterThanOrEqual(14 * 60 * 1000);
    expect(accessExpires - beforeTime).toBeLessThanOrEqual(16 * 60 * 1000);
    // Refresh token is 7 days (~604,800,000 ms)
    expect(refreshExpires - beforeTime).toBeGreaterThanOrEqual(6 * 24 * 60 * 60 * 1000);

    // Verify database state: only hashes stored, never plaintext tokens
    const session = await identityModels.AdminSession.findOne({
      where: { userId: user.id }
    });
    expect(session).not.toBeNull();
    expect(Number(session.refreshGeneration)).toBe(0);
    expect(session.revokedAt).toBeNull();

    const refreshRecord = await identityModels.AdminRefreshToken.findOne({
      where: { sessionId: session.id }
    });
    expect(refreshRecord).not.toBeNull();
    expect(refreshRecord.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(refreshRecord.tokenHash).not.toBe(loginResult.refreshToken);

    const accessRecord = await identityModels.AdminAccessToken.findOne({
      where: { sessionId: session.id }
    });
    expect(accessRecord).not.toBeNull();
    expect(accessRecord.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(accessRecord.tokenHash).not.toBe(loginResult.accessToken);

    // Verify AuditLog written
    const audit = await auditModels.AuditLog.findOne({
      where: { requestId, action: 'ADMIN_LOGIN_SUCCESS' }
    });
    expect(audit).not.toBeNull();
    expect(audit.actorUserId).toBe(user.id);
    expect(JSON.stringify(audit.toJSON())).not.toContain(password);
    expect(JSON.stringify(audit.toJSON())).not.toContain(loginResult.accessToken);
    expect(JSON.stringify(audit.toJSON())).not.toContain(loginResult.refreshToken);
  });

  it('rejects invalid password with generic error and writes failure audit log', async () => {
    const email = `login_fail_${Date.now()}@example.test`;
    const password = 'RealPassword2026!';
    await bootstrapAdminUser({
      sequelize: testDb.sequelize,
      email,
      password
    });

    const requestId = randomUUID();
    await expect(loginAdminUser({
      sequelize: testDb.sequelize,
      email,
      password: 'WrongPassword2026!',
      requestId
    })).rejects.toMatchObject({
      code: 'UNAUTHENTICATED'
    });

    const failureAudit = await auditModels.AuditLog.findOne({
      where: { requestId, action: 'ADMIN_LOGIN_FAILURE' }
    });
    expect(failureAudit).not.toBeNull();
    expect(failureAudit.actorType).toBe('SYSTEM');
    expect(failureAudit.actorUserId).toBeNull();
  });

  it('rejects inactive admin user with generic error', async () => {
    const email = `inactive_${Date.now()}@example.test`;
    const password = 'SomePassword2026!';
    const user = await bootstrapAdminUser({
      sequelize: testDb.sequelize,
      email,
      password
    });

    // Deactivate user directly
    await identityModels.User.update(
      { isActive: false },
      { where: { id: user.id } }
    );

    await expect(loginAdminUser({
      sequelize: testDb.sequelize,
      email,
      password
    })).rejects.toMatchObject({
      code: 'UNAUTHENTICATED'
    });
  });

  it('rejects non-existent email with generic error', async () => {
    await expect(loginAdminUser({
      sequelize: testDb.sequelize,
      email: 'nonexistent@example.test',
      password: 'SomePassword2026!'
    })).rejects.toMatchObject({
      code: 'UNAUTHENTICATED'
    });
  });
});
