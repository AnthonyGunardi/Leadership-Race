import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { setupIsolatedTestDatabase } from '../helpers/testDatabase.js';
import { getEnv, resetCachedEnv } from '../../config/environment.js';
import { bootstrapAdminUser } from '../../services/adminBootstrap.js';
import { createApp } from '../../app.js';
import { defineAdminIdentity } from '../../models/adminIdentity.js';
import { storedGameFixture } from '../helpers/gameSession.js';
import { createGameGateway } from '../../realtime/gameGateway.js';
import { io } from 'socket.io-client';
import { hashToken } from '../../services/adminAuth.js';

const require = createRequire(import.meta.url);
let database;
let server;
let baseUrl;
let accessToken;
let adminId;
let gateway;
const sockets = [];

beforeAll(async () => {
  resetCachedEnv();
  database = await setupIsolatedTestDatabase();
  const env = getEnv();
  await promisify(execFile)(process.execPath, [
    require.resolve('sequelize-cli/lib/sequelize'), 'db:migrate', '--env', 'test',
    '--config', fileURLToPath(new URL('../../../sequelize.config.cjs', import.meta.url)),
    '--migrations-path', fileURLToPath(new URL('../../../migrations/', import.meta.url))
  ], { env: { ...process.env, NODE_ENV: 'test', DB_NAME: database.schemaName,
    DB_HOST: env.DB_HOST, DB_PORT: String(env.DB_PORT), DB_USER: env.DB_USER, DB_PASSWORD: env.DB_PASSWORD } });
  const email = 'display-smoke@example.test';
  const password = randomUUID();
  adminId = (await bootstrapAdminUser({ sequelize: database.sequelize, email, password })).id;
  server = await new Promise((resolve) => {
    const instance = createApp({ sequelize: database.sequelize }).listen(0, '127.0.0.1', () => resolve(instance));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
  gateway = createGameGateway({ server, sequelize: database.sequelize, scanIntervalMs: 50, publishIntervalMs: 30 });
  const login = await request('/auth/login', { method: 'POST', body: { email, password }, admin: false });
  accessToken = login.body.data.accessToken;
}, 30000);

afterAll(async () => {
  for (const socket of sockets) socket.disconnect();
  await gateway?.stop();
  if (server) await new Promise((resolve) => server.close(resolve));
  await database?.cleanup();
  resetCachedEnv();
});

/** Exercises the real public/admin handshake; cookie-only handshakes must fail. */
async function connectGame(auth, extraHeaders = {}) {
  const { gameId } = auth;
  const socket = io(baseUrl.replace('/api/v1', ''), { autoConnect: false, reconnection: false,
    extraHeaders, auth });
  sockets.push(socket);
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
    socket.connect();
  });
  const joined = await socket.timeout(2000).emitWithAck('game:join', { gameId });
  expect(joined.success).toBe(true);
  return socket;
}

/** Register before committing mutations so the assertion cannot miss an early event or disconnect. */
function nextSocketEvent(socket, type) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), 5000);
    socket.once(type, (event) => { clearTimeout(timer); resolve(event); });
  });
}

/** Raw HTTP exercises cookie transport without exposing opaque credentials in test output. */
async function request(path, { method = 'GET', body, admin = true, cookie, key = randomUUID() } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key,
      ...(admin && accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie') };
}


it('serves public snapshots/replay and two sockets without pairing, with admin reads still protected', async () => {
  const created = await request('/games/current', { method: 'POST', body: { name: 'Public race' } });
  expect(created.status).toBe(200);
  const id = created.body.data.game.id;
  const display = await connectGame({ gameId: id, public: true });
  const secondDisplay = await connectGame({ gameId: id, public: true });
  const adminSocket = await connectGame({ gameId: id, accessToken });
  const denied = await display.timeout(2000).emitWithAck('game:join', { gameId: randomUUID() });
  expect(denied.error.code).toBe('FORBIDDEN');
  const notifications = [display, secondDisplay, adminSocket].map((socket) =>
    nextSocketEvent(socket, 'game:state_changed'));
  const setup = await request(`/games/${id}/setup`, { method: 'PUT', body: {
    name: 'Public race configured', expectedStateVersion: created.body.meta.stateVersion,
    boardCells: created.body.data.boardCells,
    teams: Array.from({ length: 10 }, (_, index) => ({
      name: `Tim ${index + 1}`, color: '#b90500', sortOrder: index + 1
    }))
  } });
  expect(setup.status).toBe(200);
  const [firstEvent, secondEvent, adminEvent] = await Promise.all(notifications);
  expect(firstEvent.gameId).toBe(id);
  expect(firstEvent.payload).toEqual({});
  expect(secondEvent.payload).toEqual({});
  expect(adminEvent.payload).toHaveProperty('status', 'DRAFT');
  const snapshot = await request(`/public/games/${id}/snapshot`, { admin: false });
  expect(snapshot.status).toBe(200);
  expect(snapshot.body.data.boardCells).toHaveLength(50);
  expect(snapshot.body.data.teams).toHaveLength(10);
  expect(snapshot.body.data.teams.every((team) => team.position === 0)).toBe(true);
  expect(snapshot.body.data).not.toHaveProperty('controller');
  expect(snapshot.body.data).not.toHaveProperty('pendingResult');
  const events = await request(`/public/games/${id}/events?afterSequence=0`, { admin: false });
  expect(events.body.data.events.map((event) => event.sequence)).toEqual([1, 2]);
  expect(events.body.data.events.every((event) => Object.keys(event.payload).length === 0)).toBe(true);
  expect((await request(`/games/${id}/snapshot`, { admin: false })).status).toBe(401);
  expect((await request(`/games/${id}/turns/roll`, { method: 'POST', admin: false, body: {} })).status).toBe(401);
  const other = await storedGameFixture(database.sequelize, 'Imported non-public session');
  expect((await request(`/public/games/${other.body.data.game.id}/snapshot`, { admin: false })).status).toBe(404);
  await expect(connectGame({ gameId: other.body.data.game.id, public: true })).rejects.toThrow();
  const page = await request(`/games/${id}/events?afterSequence=0&limit=1`);
  expect(page.body.meta.hasMore).toBe(true);
  expect(page.body.meta.nextAfterSequence).toBe(1);
  expect((await request(`/public/games/${id}/events?afterSequence=0&limit=501`, { admin: false })).status).toBe(400);
  expect((await request(`/games/${id}/events?afterSequence=999`)).body.error.code).toBe('STALE_STATE');
  const { Game } = database.sequelize.models;
  await Game.update({ eventRetentionFloor: 1 }, { where: { id } });
  expect((await request(`/games/${id}/events?afterSequence=0`)).body.error.code).toBe('EVENT_HISTORY_UNAVAILABLE');
});

it('rejects stored legacy cookies and disconnects expired admin sockets while public access remains available', async () => {
  const current = await request('/public/game', { admin: false });
  const id = current.body.data.game.id;
  const token = randomBytes(32).toString('base64url');
  await database.sequelize.getQueryInterface().bulkInsert('display_tokens', [{
    id: randomUUID(), game_id: id, issued_by: adminId, token_hash: hashToken(token), version: 1,
    expires_at: new Date(Date.now() + 3600000), created_at: new Date(), updated_at: new Date()
  }]);
  const cookie = `__Secure-lr_display_${id}=${token}`;
  expect((await request(`/games/${id}/snapshot`, { admin: false, cookie })).status).toBe(401);
  expect((await request(`/games/${id}/events?afterSequence=0`, { admin: false, cookie })).status).toBe(401);
  await expect(connectGame({ gameId: id }, { Cookie: cookie })).rejects.toThrow();
  const adminSocket = await connectGame({ gameId: id, accessToken });
  const publicSocket = await connectGame({ gameId: id, public: true });
  const disconnected = nextSocketEvent(adminSocket, 'disconnect');
  const { AdminAccessToken } = defineAdminIdentity(database.sequelize);
  const row = await AdminAccessToken.findOne({ where: { tokenHash: hashToken(accessToken) } });
  const expiresAt = row.expiresAt;
  try {
    await row.update({ expiresAt: new Date(0) });
    await disconnected;
    expect(adminSocket.connected).toBe(false);
    expect(publicSocket.connected).toBe(true);
    expect((await request(`/games/${id}/snapshot`)).status).toBe(401);
    expect((await request('/public/game', { admin: false })).status).toBe(200);
  } finally {
    await row.update({ expiresAt });
  }
});

it('invalidates public subscriptions after reset and only permits the replacement session', async () => {
  const current = await request('/public/game', { admin: false });
  const id = current.body.data.game.id;
  const display = await connectGame({ gameId: id, public: true });
  const disconnected = nextSocketEvent(display, 'disconnect');
  const reset = await request(`/games/${id}/reset`, { method: 'POST', body: {
    expectedStateVersion: current.body.meta.stateVersion, confirmed: true
  } });
  expect(reset.status).toBe(200);
  await disconnected;
  expect((await request(`/public/games/${id}/snapshot`, { admin: false })).status).toBe(404);
  expect((await request(`/public/games/${id}/events?afterSequence=0`, { admin: false })).status).toBe(404);
  await expect(connectGame({ gameId: id, public: true })).rejects.toThrow();
  const nextId = reset.body.data.game.id;
  const replacement = await connectGame({ gameId: nextId, public: true });
  expect(replacement.connected).toBe(true);
  expect((await request('/public/game', { admin: false })).body.data.game.id).toBe(nextId);
  expect((await request(`/games/${id}/snapshot`)).status).toBe(200);
});
