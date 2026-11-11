import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { setupIsolatedTestDatabase } from '../helpers/testDatabase.js';
import { getEnv, resetCachedEnv } from '../../config/environment.js';
import { bootstrapAdminUser } from '../../services/adminBootstrap.js';
import { createApp } from '../../app.js';
import { defineGameSetup } from '../../models/gameSetup.js';
import { defineScoring } from '../../models/scoring.js';
import { defineTurn } from '../../models/turn.js';
import { settleExpiredMovementIfDue } from '../../services/turnSettlement.js';
import { createBackup, restoreBackup } from '../../services/backupRestore.js';
import { hashToken } from '../../services/adminAuth.js';

const require = createRequire(import.meta.url);
let database;
let server;
let base;
let token;
let adminId;
const previousKeys = process.env.CONTROLLER_RECEIPT_KEYS;

beforeAll(async () => {
  process.env.CONTROLLER_RECEIPT_KEYS = JSON.stringify({ v1: randomBytes(32).toString('hex') });
  resetCachedEnv();
  database = await setupIsolatedTestDatabase();
  const env = getEnv();
  await promisify(execFile)(process.execPath, [require.resolve('sequelize-cli/lib/sequelize'),
    'db:migrate', '--env', 'test', '--config', fileURLToPath(new URL('../../../sequelize.config.cjs', import.meta.url)),
    '--migrations-path', fileURLToPath(new URL('../../../migrations/', import.meta.url))], {
    env: { ...process.env, NODE_ENV: 'test', DB_NAME: database.schemaName, DB_HOST: env.DB_HOST,
      DB_PORT: String(env.DB_PORT), DB_USER: env.DB_USER, DB_PASSWORD: env.DB_PASSWORD }
  });
  const email = 'single-game@example.test';
  const password = randomUUID();
  const user = await bootstrapAdminUser({ sequelize: database.sequelize, email, password });
  adminId = user.id;
  server = await new Promise((resolve) => {
    const instance = createApp({ sequelize: database.sequelize }).listen(0, '127.0.0.1', () => resolve(instance));
  });
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const login = await fetch(`${base}/auth/login`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  token = (await login.json()).data.accessToken;
}, 30000);

afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await database?.cleanup();
  if (previousKeys === undefined) delete process.env.CONTROLLER_RECEIPT_KEYS;
  else process.env.CONTROLLER_RECEIPT_KEYS = previousKeys;
  resetCachedEnv();
});

/** Exercises real HTTP authorization and isolated persistence, including replay after archival. */
async function api(path, { method = 'GET', body, key = randomUUID(), authenticated = true, cookie } = {}) {
  const response = await fetch(`${base}${path}`, { method,
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key,
      ...(authenticated ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json() };
}

it('shows an unpaired initial board and resets one operational game without erasing historical scores', async () => {
  const preview = await api('/public/game', { authenticated: false });
  expect(preview.status).toBe(200);
  expect(preview.body.data.game.id).toBeNull();
  expect(preview.body.data.boardCells).toHaveLength(50);
  expect(preview.body.data).not.toHaveProperty('controller');

  const [first, concurrent] = await Promise.all([1, 2].map(() => api('/games/current', {
    method: 'POST', body: { name: 'Balapan utama' }
  })));
  expect(first.status).toBe(200);
  expect(concurrent.status).toBe(200);
  const id = first.body.data.game.id;
  expect(concurrent.body.data.game.id).toBe(id);
  const { Game } = defineGameSetup(database.sequelize);
  expect(await Game.count()).toBe(1);
  let result = await api(`/games/${id}/setup`, { method: 'PUT', body: {
    name: 'Balapan utama', expectedStateVersion: first.body.meta.stateVersion,
    teams: [{ name: 'Merah', color: '#aa0000', sortOrder: 1 },
      { name: 'Biru', color: '#0000aa', sortOrder: 2 }], boardCells: first.body.data.boardCells
  } });
  expect(result.status).toBe(200);
  result = await api(`/games/${id}/validate`, {
    method: 'POST', body: { expectedStateVersion: result.body.meta.stateVersion }
  });
  expect(result.status).toBe(200);
  result = await api(`/games/${id}/start`, {
    method: 'POST', body: { expectedStateVersion: result.body.meta.stateVersion }
  });
  expect(result.status).toBe(200);
  const teamId = result.body.data.teams[0].id;
  const lease = await api(`/games/${id}/controller/acquire`, {
    method: 'POST', body: { expectedStateVersion: result.body.meta.stateVersion }
  });
  expect(lease.status).toBe(200);
  const roll = await api(`/games/${id}/turns/roll`, { method: 'POST', body: {
    diceValue: 1, expectedTurnNumber: 1, expectedStateVersion: lease.body.meta.stateVersion,
    controllerLeaseToken: lease.body.data.controllerLeaseToken
  } });
  expect(roll.status).toBe(200);
  const blockedReset = await api(`/games/${id}/reset`, { method: 'POST', body: {
    expectedStateVersion: roll.body.meta.stateVersion, confirmed: true
  } });
  expect(blockedReset.body.error.code).toBe('TURN_NOT_READY');
  expect(await Game.count()).toBe(1);
  const Turn = defineTurn(database.sequelize);
  await Turn.update({ movementEndsAt: new Date(0) }, { where: { id: roll.body.data.turnId } });
  await settleExpiredMovementIfDue({ sequelize: database.sequelize, gameId: id });
  result = await api(`/games/${id}/snapshot`);
  expect(result.body.data.turnStatus).toBe('AWAITING_RESULT');
  result = await api(`/games/${id}/corrections`, { method: 'POST', body: {
    expectedStateVersion: result.body.meta.stateVersion, teamId, deltaPoints: 10,
    reason: 'Skor untuk verifikasi reset', confirmed: true
  } });
  expect(result.status).toBe(200);
  const snapshot = await api(`/games/${id}/snapshot`);
  const version = snapshot.body.meta.stateVersion;
  const resetBody = { expectedStateVersion: version, confirmed: true };
  const legacyToken = randomBytes(32).toString('base64url');
  await database.sequelize.getQueryInterface().bulkInsert('display_tokens', [{
    id: randomUUID(), game_id: id, issued_by: adminId, token_hash: hashToken(legacyToken),
    expires_at: new Date(Date.now() + 3600000), version: 1, created_at: new Date(), updated_at: new Date()
  }]);
  const cookie = `__Secure-lr_display_${id}=${legacyToken}`;
  expect((await api(`/games/${id}/snapshot`, { authenticated: false, cookie })).status).toBe(401);
  const unauthorized = await api(`/games/${id}/reset`, {
    method: 'POST', body: resetBody, authenticated: false
  });
  expect(unauthorized.status).toBe(401);
  expect((await api(`/games/${id}/reset`, {
    method: 'POST', body: { ...resetBody, confirmed: false }
  })).status).toBe(400);
  expect((await api(`/games/${id}/reset`, {
    method: 'POST', body: { ...resetBody, expectedStateVersion: version - 1 }
  })).body.error.code).toBe('STALE_STATE');
  expect(await Game.count()).toBe(1);

  const key = randomUUID();
  const [reset, replay] = await Promise.all([1, 2].map(() => api(`/games/${id}/reset`, {
    method: 'POST', body: resetBody, key
  })));
  expect(reset.status).toBe(200);
  expect(replay.body.data.game.id).toBe(reset.body.data.game.id);
  const nextId = reset.body.data.game.id;
  expect(nextId).not.toBe(id);
  expect(reset.body.data.game.status).toBe('DRAFT');
  expect(reset.body.data.game.turnNumber).toBe(0);
  expect(reset.body.data.teams.map(({ name, position, totalScore }) => ({ name, position, totalScore })))
    .toEqual([{ name: 'Merah', position: 0, totalScore: 0 }, { name: 'Biru', position: 0, totalScore: 0 }]);
  expect(reset.body.data.boardCells.map(({ id: _id, ...cell }) => cell))
    .toEqual(snapshot.body.data.boardCells.map(({ id: _id, ...cell }) => cell));
  expect(await Game.count()).toBe(2);
  const old = await api(`/games/${id}/snapshot`);
  expect(old.body.data.teams[0]).toMatchObject({ totalScore: 10, position: 1 });
  expect(old.body.data.game.turnNumber).toBe(1);
  expect(await Turn.count({ where: { gameId: id } })).toBe(1);
  expect(await Turn.count({ where: { gameId: nextId } })).toBe(0);
  const { ScoreLedger } = defineScoring(database.sequelize);
  expect(await ScoreLedger.count({ where: { gameId: id } })).toBe(1);
  expect(await ScoreLedger.count({ where: { gameId: nextId } })).toBe(0);
  expect((await api(`/games/${id}/pause`, {
    method: 'POST', body: { expectedStateVersion: old.body.meta.stateVersion }
  })).body.error.code).toBe('GAME_ARCHIVED');
  const publicGame = await api('/public/game', { authenticated: false });
  expect(publicGame.body.data.game.id).toBe(nextId);
  expect(publicGame.body.data).not.toHaveProperty('controller');
  expect((await api(`/public/games/${id}/snapshot`, { authenticated: false })).status).toBe(404);
  expect((await api(`/games/${id}/snapshot`, { authenticated: false, cookie })).status).toBe(401);
  const archives = await api('/games/archives');
  expect(archives.body.data.games[0]).toMatchObject({ id, name: 'Balapan utama' });
  expect((await api('/games/archives', { authenticated: false })).status).toBe(401);
  const backup = await createBackup({ sequelize: database.sequelize });
  await restoreBackup({ sequelize: database.sequelize, backupPayload: backup });
  expect((await api('/public/game', { authenticated: false })).body.data.game.id).toBe(nextId);
  expect((await api('/games/archives')).body.data.games[0].id).toBe(id);
  expect(await ScoreLedger.count({ where: { gameId: id } })).toBe(1);
  const legacy = globalThis.structuredClone(backup);
  delete legacy.data.single_game;
  delete legacy.data.game_archives;
  legacy.metadata.checksum = createHash('sha256').update(JSON.stringify(legacy.data)).digest('hex');
  await restoreBackup({ sequelize: database.sequelize, backupPayload: legacy });
  expect((await api('/public/game', { authenticated: false })).body.data.game.id).not.toBeNull();
  expect(await Game.count()).toBe(2);
});

it('retires catalog, create, duplicate and pairing endpoints without mutating the operational game', async () => {
  const current = await api('/games/current', { method: 'POST', body: { name: 'Operational race' } });
  const id = current.body.data.game.id;
  const snapshot = await api(`/games/${id}/snapshot`);
  const version = snapshot.body.meta.stateVersion;
  for (const [path, method, body] of [
    ['/games', 'GET'], ['/games', 'POST', { name: 'Retired create' }],
    [`/games/${id}/duplicate`, 'POST', { name: 'Retired copy', expectedSourceStateVersion: version }],
    [`/games/${id}/display-tokens`, 'GET'],
    [`/games/${id}/display-tokens`, 'POST', { expectedStateVersion: version }],
    [`/games/${id}/display-pairings/exchange`, 'POST', { code: 'ABCDEF' }],
    [`/games/${id}/display-session/sync`, 'POST', {}],
    [`/games/${id}/display-tokens/${randomUUID()}/renew`, 'POST',
      { expectedStateVersion: version, expectedSessionVersion: 1 }],
    [`/games/${id}/display-tokens/${randomUUID()}/revoke`, 'POST',
      { expectedStateVersion: version, expectedSessionVersion: 1 }]
  ]) {
    const rejected = await api(path, { method, body });
    expect(rejected.status, `${method} ${path}`).toBe(404);
    expect(rejected.body.error.code).toBe('NOT_FOUND');
  }
  expect((await api(`/games/${id}/snapshot`)).body.data).toEqual(snapshot.body.data);
  expect((await api('/public/game', { authenticated: false })).body.data.game.id).toBe(id);
});

it('reads only board-facing state for the public snapshot while preserving the admin snapshot', async () => {
  const queries = [];
  const previousLogging = database.sequelize.options.logging;
  let snapshot;
  database.sequelize.options.logging = (sql) => queries.push(sql);
  try { snapshot = await api('/public/game', { authenticated: false }); }
  finally { database.sequelize.options.logging = previousLogging; }
  expect(snapshot.status).toBe(200);
  expect(Object.keys(snapshot.body.data).sort()).toEqual([
    'activeMovement', 'boardCells', 'game', 'leaderboard', 'teams', 'turnStatus'
  ]);
  expect(snapshot.body.data.boardCells).toHaveLength(50);
  expect(queries.filter((sql) => /SELECT.*(?:controller_leases|challenge_results|final_results|audit_logs)/i.test(sql)))
    .toEqual([]);
  expect(queries.filter((sql) => /ORDER BY.*turn_number.*DESC/i.test(sql))).toEqual([]);
  const admin = await api(`/games/${snapshot.body.data.game.id}/snapshot`);
  expect(admin.body.data).toHaveProperty('controller');
  expect(admin.body.data).toHaveProperty('lastTurn');
});
