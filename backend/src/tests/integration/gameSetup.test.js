import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { setupIsolatedTestDatabase } from '../helpers/testDatabase.js';
import { getEnv } from '../../config/environment.js';
import { bootstrapAdminUser } from '../../services/adminBootstrap.js';
import { createApp } from '../../app.js';
import { storedGameFixture } from '../helpers/gameSession.js';

const require = createRequire(import.meta.url);
let database;
let server;
let baseUrl;
let accessToken;

beforeAll(async () => {
  database = await setupIsolatedTestDatabase();
  const env = getEnv();
  await promisify(execFile)(process.execPath, [
    require.resolve('sequelize-cli/lib/sequelize'), 'db:migrate', '--env', 'test',
    '--config', fileURLToPath(new URL('../../../sequelize.config.cjs', import.meta.url)),
    '--migrations-path', fileURLToPath(new URL('../../../migrations/', import.meta.url))
  ], {
    env: { ...process.env, NODE_ENV: 'test', DB_NAME: database.schemaName,
      DB_HOST: env.DB_HOST, DB_PORT: String(env.DB_PORT), DB_USER: env.DB_USER, DB_PASSWORD: env.DB_PASSWORD }
  });
  const email = 'setup-smoke@example.test';
  const password = randomUUID();
  await bootstrapAdminUser({ sequelize: database.sequelize, email, password });
  const app = createApp({ sequelize: database.sequelize });
  server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
  const login = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password })
  });
  expect(login.status).toBe(200);
  accessToken = (await login.json()).data.accessToken;
}, 30000);

afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await database?.cleanup();
});

/** Exercises the actual HTTP/transaction boundary on a disposable local MariaDB schema. */
async function request(path, { method = 'GET', body, key = randomUUID(), authenticated = true } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key,
      ...(authenticated ? { Authorization: `Bearer ${accessToken}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  return { status: response.status, body: await response.json() };
}

it('G3 smoke: initialize → public board → setup → reload, with stable retries and atomic version protection', async () => {
  const key = randomUUID();
  const intent = { method: 'POST', body: { name: 'Demo Leadership Race' }, key };
  const [created, concurrent] = await Promise.all([request('/games/current', intent), request('/games/current', intent)]);
  expect(created.status).toBe(200);
  expect(concurrent.status).toBe(200);
  expect(concurrent.body.data.game.id).toBe(created.body.data.game.id);
  const gameId = created.body.data.game.id;
  expect(created.body.data.game.status).toBe('DRAFT');

  const board = await request('/public/game', { authenticated: false });
  expect(board.body.data.game.id).toBe(gameId);
  expect(board.body.data.boardCells).toHaveLength(50);

  const cells = Array.from({ length: 50 }, (_, index) => ({
    number: index + 1, category: 'ACTION', title: `Kotak ${index + 1}`, instruction: null,
    backupText: null, durationText: null, successPoints: 10, allowManualPoints: true,
    defaultScoringMethod: 'BUTTON', pointsPerUnit: null, penaltySteps: 0
  }));
  const setup = {
    name: 'Demo Leadership Race — Venue', expectedStateVersion: created.body.meta.stateVersion,
    teams: [{ name: 'Merah', color: '#b90500', sortOrder: 1 },
      { name: 'Biru', color: '#1254a3', sortOrder: 2 }], boardCells: cells
  };
  const saved = await request(`/games/${gameId}/setup`, { method: 'PUT', body: setup });
  expect(saved.status).toBe(200);
  expect(saved.body.data.teams).toMatchObject([
    { name: 'Merah', code: 'T1', position: 0, totalScore: 0 },
    { name: 'Biru', code: 'T2', position: 0, totalScore: 0 }
  ]);
  expect(saved.body.data.boardCells).toHaveLength(50);
  expect(saved.body.meta.stateVersion).toBe(created.body.meta.stateVersion + 1);
  const loaded = await request(`/games/${gameId}/snapshot`);
  expect(loaded.body.data).toEqual(saved.body.data);

  const replay = await request('/games/current', intent);
  expect(replay.body.data.game.id).toBe(gameId);
  expect(replay.body.meta.stateVersion).toBe(created.body.meta.stateVersion);
  const conflict = await request('/games/current', { ...intent, body: { name: 'Different intent' } });
  expect(conflict.body.error.code).toBe('DUPLICATE_ACTION');
  const stale = await request(`/games/${gameId}/setup`, { method: 'PUT', body: setup });
  expect(stale.status).toBe(409);
  expect(stale.body.error.code).toBe('STALE_STATE');
  const unauthenticated = await request('/games/current', { authenticated: false });
  expect(unauthenticated.status).toBe(401);

  // A second draft must remain untouched by setup commands for the first game.
  const second = await storedGameFixture(database.sequelize, 'Imported game');
  const other = await request(`/games/${second.body.data.game.id}/snapshot`);
  expect(other.body.data.teams).toEqual([]);
  expect(other.body.data.boardCells).toEqual([]);

  // READY configuration edits must invalidate preflight atomically.
  const { Game, CommandLog, GameEvent, OutboxEvent } = database.sequelize.models;
  await Game.update({ status: 'READY' }, { where: { id: gameId } });
  const edit = { ...setup, expectedStateVersion: saved.body.meta.stateVersion,
    teams: saved.body.data.teams.map(({ id, name, color, sortOrder }) => ({ id, name, color, sortOrder })),
    boardCells: saved.body.data.boardCells };
  const editKey = randomUUID();
  const edited = await request(`/games/${gameId}/setup`, { method: 'PUT', body: edit, key: editKey });
  expect(edited.status).toBe(200);
  expect(edited.body.data.game.status).toBe('DRAFT');
  expect(edited.body.data.teams[0].id).toBe(saved.body.data.teams[0].id);
  await Game.update({ status: 'RUNNING' }, { where: { id: gameId } });
  const editReplay = await request(`/games/${gameId}/setup`, { method: 'PUT', body: edit, key: editKey });
  expect(editReplay.status).toBe(200);
  expect(editReplay.body.meta.stateVersion).toBe(edited.body.meta.stateVersion);
  const locked = await request(`/games/${gameId}/setup`, {
    method: 'PUT', body: { ...edit, expectedStateVersion: edited.body.meta.stateVersion }
  });
  expect(locked.status).toBe(409);
  expect(locked.body.error.code).toBe('SETUP_LOCKED');
  expect(await CommandLog.count()).toBe(3);
  expect(await GameEvent.count()).toBe(3);
  expect(await OutboxEvent.count({ where: { publishedAt: null } })).toBe(3);
  const events = await GameEvent.findAll({ where: { gameId }, order: [['sequence', 'ASC']] });
  expect(events.map((event) => Number(event.sequence))).toEqual([1, 2, 3]);
});
