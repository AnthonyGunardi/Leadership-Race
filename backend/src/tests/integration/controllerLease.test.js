import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { setupIsolatedTestDatabase } from '../helpers/testDatabase.js';
import { getEnv, resetCachedEnv } from '../../config/environment.js';
import { bootstrapAdminUser } from '../../services/adminBootstrap.js';
import { assertControllerLease } from '../../services/controllerLeases.js';
import { createApp } from '../../app.js';
import { prepareTestSession } from '../helpers/gameSession.js';

const require = createRequire(import.meta.url);
let database;
let server;
let baseUrl;
const admins = [];
const previousKeys = process.env.CONTROLLER_RECEIPT_KEYS;

beforeAll(async () => {
  process.env.CONTROLLER_RECEIPT_KEYS = JSON.stringify({ v1: randomBytes(32).toString('hex') });
  resetCachedEnv();
  database = await setupIsolatedTestDatabase();
  const env = getEnv();
  await promisify(execFile)(process.execPath, [require.resolve('sequelize-cli/lib/sequelize'), 'db:migrate',
    '--env', 'test', '--config', fileURLToPath(new URL('../../../sequelize.config.cjs', import.meta.url)),
    '--migrations-path', fileURLToPath(new URL('../../../migrations/', import.meta.url))], {
    env: { ...process.env, DB_NAME: database.schemaName, DB_HOST: env.DB_HOST, DB_PORT: String(env.DB_PORT),
      DB_USER: env.DB_USER, DB_PASSWORD: env.DB_PASSWORD }
  });
  server = await new Promise((resolve) => {
    const instance = createApp({ sequelize: database.sequelize }).listen(0, '127.0.0.1', () => resolve(instance));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1/games`;
  for (const email of ['controller-a@example.test', 'controller-b@example.test']) {
    const password = randomUUID();
    const user = await bootstrapAdminUser({ sequelize: database.sequelize, email, password });
    const login = await fetch(baseUrl.replace('/games', '/auth/login'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password })
    });
    const { data } = await login.json();
    admins.push({ userId: user.id, token: data.accessToken });
  }
}, 30000);

afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await database?.cleanup();
  if (previousKeys === undefined) delete process.env.CONTROLLER_RECEIPT_KEYS;
  else process.env.CONTROLLER_RECEIPT_KEYS = previousKeys;
  resetCachedEnv();
});

/** Uses real auth, HTTP and MariaDB; each caller owns its retry key. */
async function request(path = '', { body, key = randomUUID(), admin = 0, method = body ? 'POST' : 'GET' } = {}) {
  const response = await fetch(`${baseUrl}${path}`, { method, headers: { 'Content-Type': 'application/json',
    'Idempotency-Key': key, ...(admin === null ? {} : { Authorization: `Bearer ${admins[admin].token}` }) },
  ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json() };
}

/** Creates a playable upstream fixture through the real setup/preflight/Start contracts. */
async function runningGame() {
  const created = await prepareTestSession(request, 'Controller race');
  const id = created.body.data.game.id;
  const boardCells = (await request('/templates/prd-appendix-a-v1')).body.data.boardCells;
  const setup = await request(`/${id}/setup`, { method: 'PUT', body: { name: 'Controller race',
    expectedStateVersion: created.body.meta.stateVersion, boardCells,
    teams: [{ name: 'Satu', color: '#b90500', sortOrder: 1 }, { name: 'Dua', color: '#1254a3', sortOrder: 2 }] } });
  const ready = await request(`/${id}/validate`, { body: { expectedStateVersion: setup.body.meta.stateVersion } });
  return (await request(`/${id}/start`, { body: { expectedStateVersion: ready.body.meta.stateVersion } })).body;
}

it('G6 smoke: one concurrent holder, encrypted replay, heartbeat, confirmed takeover and old-token rejection', async () => {
  const running = await runningGame();
  const id = running.data.game.id;
  const input = { expectedStateVersion: running.meta.stateVersion };
  const key = randomUUID();
  const candidates = await Promise.all([
    request(`/${id}/controller/acquire`, { body: input, key }),
    request(`/${id}/controller/acquire`, { body: input, admin: 1 })
  ]);
  const winner = candidates.findIndex((result) => result.status === 200);
  expect(winner).toBeGreaterThanOrEqual(0);
  expect(candidates.filter((result) => result.status === 200)).toHaveLength(1);
  const loser = 1 - winner;
  const acquired = candidates[winner].body;
  const leaseToken = acquired.data.controllerLeaseToken;
  expect(leaseToken).toMatch(/^[a-f0-9]{64}$/);
  expect(Date.parse(acquired.data.controller.expiresAt) - Date.parse(acquired.meta.serverTime))
    .toBeLessThanOrEqual(30000);
  const snapshot = (await request(`/${id}/snapshot`, { admin: loser })).body;
  expect(snapshot.data.controller).toMatchObject({ holderUserId: acquired.data.controller.holderUserId, version: 1 });
  expect(JSON.stringify(snapshot)).not.toContain(leaseToken);
  const held = await request(`/${id}/controller/acquire`, { admin: loser,
    body: { expectedStateVersion: snapshot.meta.stateVersion } });
  expect(held.body.error.code).toBe('CONTROLLER_NOT_HELD');
  const { ControllerLease, CommandLog, GameEvent, OutboxEvent, AuditLog } = database.sequelize.models;
  const row = await ControllerLease.findByPk(id);
  expect(row.holderUserId).toBe(acquired.data.controller.holderUserId);
  expect(row.leaseTokenHash).not.toBe(leaseToken);
  const receipt = await CommandLog.findOne({ where: { gameId: id, commandType: 'CONTROLLER_ACQUIRE' } });
  expect(JSON.stringify(receipt.toJSON())).not.toContain(leaseToken);
  expect(receipt.responseSecretCiphertext).toBeTruthy();
  expect(receipt.responseSecretKeyId).toBe('v1');
  const replayKey = winner === 0 ? key : receipt.idempotencyKey;
  const replay = await request(`/${id}/controller/acquire`, { admin: winner, body: input, key: replayKey });
  expect(replay.body.data).toEqual(acquired.data);
  const conflict = await request(`/${id}/controller/acquire`, { admin: loser, body: input, key: replayKey });
  expect(conflict.body.error.code).toBe('DUPLICATE_ACTION');
  const heartbeatIntent = { admin: winner, key: randomUUID(), body: { controllerLeaseToken: leaseToken } };
  const [heartbeat, duplicate] = await Promise.all([
    request(`/${id}/controller/heartbeat`, heartbeatIntent), request(`/${id}/controller/heartbeat`, heartbeatIntent)
  ]);
  expect(heartbeat.status).toBe(200);
  expect(duplicate.body.data).toEqual(heartbeat.body.data);
  expect(heartbeat.body.data.controller.version).toBe(2);
  const version = heartbeat.body.meta.stateVersion;
  const unconfirmed = await request(`/${id}/controller/take-over`, { admin: loser,
    body: { expectedStateVersion: version, confirmed: false } });
  expect(unconfirmed.status).toBe(400);
  const takeover = await request(`/${id}/controller/take-over`, { admin: loser,
    body: { expectedStateVersion: version, confirmed: true } });
  expect(takeover.status).toBe(200);
  expect(takeover.body.data.controller.version).toBe(3);
  expect(takeover.body.data.controllerLeaseToken).not.toBe(leaseToken);
  expect((await request(`/${id}/controller/heartbeat`, { admin: winner,
    body: { controllerLeaseToken: leaseToken } })).body.error.code).toBe('CONTROLLER_NOT_HELD');
  expect((await request(`/${id}/controller/heartbeat`, { admin: winner,
    body: { controllerLeaseToken: takeover.body.data.controllerLeaseToken } })).body.error.code).toBe('CONTROLLER_NOT_HELD');
  const oldReplay = await request(`/${id}/controller/acquire`, { admin: winner, body: input, key: replayKey });
  expect(oldReplay.body.data.controllerLeaseToken).toBe(leaseToken);
  expect((await ControllerLease.findByPk(id)).holderUserId).toBe(takeover.body.data.controller.holderUserId);
  await expect(database.sequelize.transaction((transaction) => assertControllerLease({ sequelize: database.sequelize,
    transaction, gameId: id, actorUserId: row.holderUserId, controllerLeaseToken: leaseToken })))
    .rejects.toMatchObject({ code: 'CONTROLLER_NOT_HELD' });
  const events = await GameEvent.findAll({ where: { gameId: id, type: 'game:controller_changed' } });
  expect(events).toHaveLength(3);
  expect(await OutboxEvent.count({ where: { gameId: id } })).toBe(7);
  const audit = await AuditLog.findAll({ where: { gameId: id, action: 'CONTROLLER_TAKEN_OVER' } });
  expect(audit).toHaveLength(1);
  expect(audit[0].beforeJson).toMatchObject({ holderUserId: row.holderUserId });
  expect(JSON.stringify([...events.map((event) => event.toJSON()), ...audit.map((entry) => entry.toJSON())]))
    .not.toContain(leaseToken);
});

it('expiry uses database time, cannot be revived by replay/heartbeat and is isolated across games', async () => {
  const running = await runningGame();
  const id = running.data.game.id;
  const intent = { key: randomUUID(), body: { expectedStateVersion: running.meta.stateVersion } };
  const acquired = (await request(`/${id}/controller/acquire`, intent)).body;
  const { ControllerLease } = database.sequelize.models;
  await ControllerLease.update({ expiresAt: new Date('2000-01-01T00:00:00.000Z') }, { where: { gameId: id } });
  expect((await request(`/${id}/snapshot`)).body.data.controller)
    .toMatchObject({ holderUserId: null, expiresAt: null });
  expect((await request(`/${id}/controller/heartbeat`, { body: {
    controllerLeaseToken: acquired.data.controllerLeaseToken
  } })).body.error.code).toBe('CONTROLLER_NOT_HELD');
  expect((await request(`/${id}/controller/acquire`, intent)).body.data).toEqual(acquired.data);
  expect((await ControllerLease.findByPk(id)).expiresAt.getUTCFullYear()).toBe(2000);
  const replacement = await request(`/${id}/controller/acquire`, { admin: 1,
    body: { expectedStateVersion: acquired.meta.stateVersion } });
  expect(replacement.status).toBe(200);
  const other = await runningGame();
  expect((await request(`/${other.data.game.id}/controller/heartbeat`, { admin: 1, body: {
    controllerLeaseToken: replacement.body.data.controllerLeaseToken
  } })).body.error.code).toBe('CONTROLLER_NOT_HELD');
  expect((await request(`/${other.data.game.id}/snapshot`)).body.data.controller.holderUserId).toBeNull();
});

it('auth, validation, stale state and unavailable encryption fail without partial mutation', async () => {
  const running = await runningGame();
  const id = running.data.game.id;
  const path = `/${id}/controller/acquire`;
  expect((await request(path, { admin: null, body: { expectedStateVersion: running.meta.stateVersion } })).status)
    .toBe(401);
  expect((await request(path, { body: { expectedStateVersion: 0 } })).body.error.code).toBe('STALE_STATE');
  expect((await request(path, { body: { expectedStateVersion: running.meta.stateVersion, token: 'extra' } })).status)
    .toBe(400);
  process.env.CONTROLLER_RECEIPT_KEYS = '{}';
  resetCachedEnv();
  const failed = await request(path, { body: { expectedStateVersion: running.meta.stateVersion } });
  expect(failed.status).toBe(503);
  const { ControllerLease, CommandLog } = database.sequelize.models;
  expect(await ControllerLease.count({ where: { gameId: id } })).toBe(0);
  expect(await CommandLog.count({ where: { gameId: id, commandType: 'CONTROLLER_ACQUIRE' } })).toBe(0);
  expect((await request(`/${id}/snapshot`)).body.meta.stateVersion).toBe(running.meta.stateVersion);
});
