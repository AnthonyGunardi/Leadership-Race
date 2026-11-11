import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getEnv } from '../../config/environment.js';
import { createApp } from '../../app.js';
import { defineAdminIdentity } from '../../models/adminIdentity.js';
import { bootstrapAdminUser } from '../../services/adminBootstrap.js';
import { hashToken, loginAdminUser, logoutAdminSession, refreshAdminSession } from '../../services/adminAuth.js';
import { setupIsolatedTestDatabase } from '../helpers/testDatabase.js';

const require = createRequire(import.meta.url);
const runFile = promisify(execFile);

describe('Cross-request revocation on isolated MySQL (LR-027)', () => {
  let testDb;
  let models;
  let server;
  let url;
  const email = `sessions-${randomUUID()}@example.test`;
  const password = randomUUID();

  beforeAll(async () => {
    testDb = await setupIsolatedTestDatabase();
    const env = getEnv();
    await runFile(process.execPath, [require.resolve('sequelize-cli/lib/sequelize'), 'db:migrate', '--env', 'test',
      '--config', fileURLToPath(new URL('../../../sequelize.config.cjs', import.meta.url)),
      '--migrations-path', fileURLToPath(new URL('../../../migrations/', import.meta.url))
    ], { env: { ...process.env, NODE_ENV: 'test', DB_NAME: testDb.schemaName,
      DB_HOST: env.DB_HOST, DB_PORT: String(env.DB_PORT), DB_USER: env.DB_USER, DB_PASSWORD: env.DB_PASSWORD } });
    models = defineAdminIdentity(testDb.sequelize);
    await bootstrapAdminUser({ sequelize: testDb.sequelize, email, password });
    const app = createApp({ sequelize: testDb.sequelize });
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    url = `http://127.0.0.1:${server.address().port}/api/v1/auth/me`;
  });

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => { server.close(resolve); });
    }
    await testDb?.cleanup();
  });

  /** All credentials are generated per run and used only against this disposable schema. */
  async function login() {
    return loginAdminUser({ sequelize: testDb.sequelize, email, password });
  }

  /** Exercises the real REST middleware rather than authorizing a cached principal. */
  async function me(accessToken) {
    return fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  }

  it('normal requests do not slide access/session expiry; logout invalidates all family access tokens', async () => {
    const first = await login();
    const rotated = await refreshAdminSession({ sequelize: testDb.sequelize, refreshToken: first.refreshToken });
    const before = await models.AdminSession.findOne({
      where: { userId: first.user.id }, order: [['createdAt', 'DESC']]
    });
    const accessBefore = await models.AdminAccessToken.findOne({
      where: { tokenHash: hashToken(rotated.accessToken) }
    });
    expect((await me(first.accessToken)).status).toBe(200);
    expect((await me(rotated.accessToken)).status).toBe(200);
    const after = await models.AdminSession.findByPk(before.id);
    const accessAfter = await models.AdminAccessToken.findByPk(accessBefore.id);
    expect(after.expiresAt.getTime()).toBe(before.expiresAt.getTime());
    expect(accessAfter.expiresAt.getTime()).toBe(accessBefore.expiresAt.getTime());
    await logoutAdminSession({ sequelize: testDb.sequelize, accessToken: first.accessToken });
    expect((await me(first.accessToken)).status).toBe(401);
    expect((await me(rotated.accessToken)).status).toBe(401);
    await expect(refreshAdminSession({ sequelize: testDb.sequelize, refreshToken: rotated.refreshToken }))
      .rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('committed refresh reuse invalidates both old and rotated access on the next request', async () => {
    const first = await login();
    const rotated = await refreshAdminSession({ sequelize: testDb.sequelize, refreshToken: first.refreshToken });
    await expect(refreshAdminSession({ sequelize: testDb.sequelize, refreshToken: first.refreshToken }))
      .rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect((await me(first.accessToken)).status).toBe(401);
    expect((await me(rotated.accessToken)).status).toBe(401);
  });

  it('rejects disabled accounts and session expiry across independently established sessions', async () => {
    const first = await login();
    const second = await login();
    await models.User.update({ isActive: false }, { where: { id: first.user.id } });
    expect((await me(first.accessToken)).status).toBe(401);
    expect((await me(second.accessToken)).status).toBe(401);
    await expect(refreshAdminSession({ sequelize: testDb.sequelize, refreshToken: second.refreshToken }))
      .rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await models.User.update({ isActive: true }, { where: { id: first.user.id } });
    const token = await models.AdminAccessToken.findOne({ where: { tokenHash: hashToken(first.accessToken) } });
    await models.AdminSession.update({ expiresAt: new Date(Date.now() - 1) }, { where: { id: token.sessionId } });
    expect((await me(first.accessToken)).status).toBe(401);
    expect((await me(second.accessToken)).status).toBe(200);
  });

  it('rejects expired access and fails closed when the database connection becomes unavailable', async () => {
    const first = await login();
    await models.AdminAccessToken.update({ expiresAt: new Date(Date.now() - 1) },
      { where: { tokenHash: hashToken(first.accessToken) } });
    expect((await me(first.accessToken)).status).toBe(401);
    const valid = await login();
    await testDb.sequelize.close();
    const result = await me(valid.accessToken);
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ success: false,
      error: { code: 'SERVICE_UNAVAILABLE', message: 'Session authorization is unavailable' } });
  });
});
