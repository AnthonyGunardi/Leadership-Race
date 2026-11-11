import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getEnv } from '../../config/environment.js';
import { createApp } from '../../app.js';
import { defineAdminIdentity } from '../../models/adminIdentity.js';
import { setupIsolatedTestDatabase } from '../helpers/testDatabase.js';
import { bootstrapAdminUser } from '../../services/adminBootstrap.js';

const require = createRequire(import.meta.url);
const runFile = promisify(execFile);
const migrationDirectory = fileURLToPath(new URL('../../../migrations/', import.meta.url));

describe('Admin HTTP login and protected bearer endpoints on isolated MySQL', () => {
  let testDb;
  let identityModels;
  let app;
  let server;
  let baseUrl;

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
    app = createApp({ sequelize: testDb.sequelize });

    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await testDb?.cleanup();
  });

  it('logs in with valid credentials, sets __Host- cookie and returns access token', async () => {
    const email = `http_login_${Date.now()}@example.test`;
    const password = 'SuperSecurePassword2026!';
    await bootstrapAdminUser({
      sequelize: testDb.sequelize,
      email,
      password
    });

    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:5173'
      },
      body: JSON.stringify({ email, password })
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');

    const body = await res.json();
    expect(body).toMatchObject({
      success: true,
      data: {
        user: {
          email: email.toLowerCase(),
          role: 'SUPER_ADMIN'
        }
      }
    });
    expect(body.data.accessToken).toBeTypeOf('string');
    expect(body.data.accessExpiresAt).toBeTypeOf('string');
    expect(body.data.refreshToken).toBeUndefined(); // Refresh token must NOT be in JSON!

    // Verify __Host- cookie attributes
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toBeDefined();
    expect(setCookie).toContain('__Host-lr_admin_refresh=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).not.toContain('Domain=');
  });

  it('rejects login with wrong password and does not set refresh cookie', async () => {
    const email = `http_fail_${Date.now()}@example.test`;
    const password = 'CorrectPassword2026!';
    await bootstrapAdminUser({
      sequelize: testDb.sequelize,
      email,
      password
    });

    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'WrongPassword2026!' })
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toMatchObject({
      success: false,
      error: {
        code: 'UNAUTHENTICATED'
      }
    });
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('rejects login payload with unexpected fields (strict schema validation)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'test@example.com',
        password: 'Password123!',
        unexpected: 'field'
      })
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({
      success: false,
      error: {
        code: 'VALIDATION_ERROR'
      }
    });
  });

  it('rejects cross-origin login from unauthorized origin', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://malicious-site.attacker'
      },
      body: JSON.stringify({
        email: 'test@example.com',
        password: 'Password123!'
      })
    });

    expect([403, 400]).toContain(res.status);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it('allows access to protected route with valid bearer token', async () => {
    const email = `protected_${Date.now()}@example.test`;
    const password = 'ProtectedPassword123!';
    await bootstrapAdminUser({
      sequelize: testDb.sequelize,
      email,
      password
    });

    const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const loginBody = await loginRes.json();
    const token = loginBody.data.accessToken;

    const meRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    expect(meRes.status).toBe(200);
    const meBody = await meRes.json();
    expect(meBody).toMatchObject({
      success: true,
      data: {
        user: {
          email: email.toLowerCase(),
          role: 'SUPER_ADMIN'
        }
      }
    });
  });

  it('rejects protected route when bearer token is missing or malformed', async () => {
    const res1 = await fetch(`${baseUrl}/api/v1/auth/me`);
    expect(res1.status).toBe(401);
    const body1 = await res1.json();
    expect(body1).toMatchObject({
      success: false,
      error: { code: 'UNAUTHENTICATED' }
    });

    const res2 = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { Authorization: 'Basic 12345' }
    });
    expect(res2.status).toBe(401);
    const body2 = await res2.json();
    expect(body2).toMatchObject({
      success: false,
      error: { code: 'UNAUTHENTICATED' }
    });
  });

  it('rejects protected route when access token is revoked', async () => {
    const email = `revoked_token_${Date.now()}@example.test`;
    const password = 'RevokedPassword123!';
    await bootstrapAdminUser({
      sequelize: testDb.sequelize,
      email,
      password
    });

    const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const loginBody = await loginRes.json();
    const token = loginBody.data.accessToken;

    // Revoke the access token in database directly
    const accessRecords = await identityModels.AdminAccessToken.findAll();
    for (const rec of accessRecords) {
      await rec.update({ revokedAt: new Date() });
    }

    const meRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    expect(meRes.status).toBe(401);
    const body = await meRes.json();
    expect(body).toMatchObject({
      success: false,
      error: { code: 'UNAUTHENTICATED' }
    });
  });

  it('rejects protected route when session is revoked', async () => {
    const email = `revoked_session_${Date.now()}@example.test`;
    const password = 'SessionRevokedPassword123!';
    const user = await bootstrapAdminUser({
      sequelize: testDb.sequelize,
      email,
      password
    });

    const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const loginBody = await loginRes.json();
    const token = loginBody.data.accessToken;

    // Revoke the session in database
    await identityModels.AdminSession.update(
      { revokedAt: new Date(), revokedReason: 'Administrative revocation' },
      { where: { userId: user.id } }
    );

    const meRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    expect(meRes.status).toBe(401);
    const body = await meRes.json();
    expect(body).toMatchObject({
      success: false,
      error: { code: 'UNAUTHENTICATED' }
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    it('rotates refresh token, preserves spent hash, and returns new access token', async () => {
      const email = `refresh_success_${Date.now()}@example.test`;
      const password = 'RefreshPassword123!';
      await bootstrapAdminUser({
        sequelize: testDb.sequelize,
        email,
        password
      });

      const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const setCookie = loginRes.headers.get('set-cookie');
      const cookieVal = setCookie.match(/__Host-lr_admin_refresh=([^;]+)/)[1];

      // Call refresh
      const refreshRes = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: {
          Cookie: `__Host-lr_admin_refresh=${cookieVal}`,
          Origin: 'http://localhost:5173'
        }
      });

      expect(refreshRes.status).toBe(200);
      expect(refreshRes.headers.get('cache-control')).toContain('no-store');

      const refreshBody = await refreshRes.json();
      expect(refreshBody.success).toBe(true);
      expect(refreshBody.data.accessToken).toBeTypeOf('string');
      expect(refreshBody.data.user.email).toBe(email.toLowerCase());

      const newSetCookie = refreshRes.headers.get('set-cookie');
      expect(newSetCookie).toContain('__Host-lr_admin_refresh=');
      const newCookieVal = newSetCookie.match(/__Host-lr_admin_refresh=([^;]+)/)[1];
      expect(newCookieVal).not.toBe(cookieVal);

      // Verify that the new access token works on protected route
      const meRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
        headers: { Authorization: `Bearer ${refreshBody.data.accessToken}` }
      });
      expect(meRes.status).toBe(200);
    });

    it('detects token reuse and revokes entire session family', async () => {
      const email = `reuse_${Date.now()}@example.test`;
      const password = 'ReusePassword123!';
      const user = await bootstrapAdminUser({
        sequelize: testDb.sequelize,
        email,
        password
      });

      const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const setCookie = loginRes.headers.get('set-cookie');
      const firstRefreshToken = setCookie.match(/__Host-lr_admin_refresh=([^;]+)/)[1];

      // First refresh: consumes firstRefreshToken and issues secondRefreshToken
      const refreshRes1 = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { Cookie: `__Host-lr_admin_refresh=${firstRefreshToken}` }
      });
      expect(refreshRes1.status).toBe(200);
      const refresh1Body = await refreshRes1.json();
      const activeAccessToken = refresh1Body.data.accessToken;

      // Second refresh using the ALREADY-SPENT firstRefreshToken: REUSE ATTEMPT!
      const reuseRes = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { Cookie: `__Host-lr_admin_refresh=${firstRefreshToken}` }
      });

      expect(reuseRes.status).toBe(401);
      const reuseBody = await reuseRes.json();
      expect(reuseBody).toMatchObject({
        success: false,
        error: { code: 'UNAUTHENTICATED' }
      });

      // Assert session is revoked in database
      const session = await identityModels.AdminSession.findOne({ where: { userId: user.id } });
      expect(session.revokedAt).not.toBeNull();
      expect(session.revokedReason).toBe('REFRESH_TOKEN_REUSE_DETECTED');

      // Assert previously active access token is now rejected because session was revoked
      const meRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
        headers: { Authorization: `Bearer ${activeAccessToken}` }
      });
      expect(meRes.status).toBe(401);
    });

    it('rejects refresh when cookie is missing', async () => {
      const res = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
        method: 'POST'
      });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toMatchObject({
        success: false,
        error: { code: 'UNAUTHENTICATED' }
      });
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    it('revokes session, clears refresh cookie, and operates idempotently', async () => {
      const email = `logout_${Date.now()}@example.test`;
      const password = 'LogoutPassword123!';
      const user = await bootstrapAdminUser({
        sequelize: testDb.sequelize,
        email,
        password
      });

      const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const loginBody = await loginRes.json();
      const token = loginBody.data.accessToken;
      const setCookie = loginRes.headers.get('set-cookie');
      const cookieVal = setCookie.match(/__Host-lr_admin_refresh=([^;]+)/)[1];

      // Logout with Bearer and Cookie
      const logoutRes = await fetch(`${baseUrl}/api/v1/auth/logout`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Cookie: `__Host-lr_admin_refresh=${cookieVal}`
        }
      });

      expect(logoutRes.status).toBe(200);
      const logoutBody = await logoutRes.json();
      expect(logoutBody).toMatchObject({
        success: true,
        data: { loggedOut: true }
      });

      // Verify cookie cleared
      const clearCookie = logoutRes.headers.get('set-cookie');
      expect(clearCookie).toContain('__Host-lr_admin_refresh=');
      expect(clearCookie).toMatch(/Max-Age=0|expires=/i);

      // Verify session revoked in database
      const session = await identityModels.AdminSession.findOne({ where: { userId: user.id } });
      expect(session.revokedAt).not.toBeNull();

      // Verify subsequent access token attempt rejected
      const meRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      expect(meRes.status).toBe(401);

      // Verify idempotent repeat logout succeeds
      const repeatLogoutRes = await fetch(`${baseUrl}/api/v1/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      expect(repeatLogoutRes.status).toBe(200);
    });
  });
});
