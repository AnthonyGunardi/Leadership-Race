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
import { prepareTestSession } from '../helpers/gameSession.js';

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
  ], { env: { ...process.env, NODE_ENV: 'test', DB_NAME: database.schemaName,
    DB_HOST: env.DB_HOST, DB_PORT: String(env.DB_PORT), DB_USER: env.DB_USER, DB_PASSWORD: env.DB_PASSWORD } });
  const email = 'launch-smoke@example.test';
  const password = randomUUID();
  await bootstrapAdminUser({ sequelize: database.sequelize, email, password });
  server = await new Promise((resolve) => {
    const instance = createApp({ sequelize: database.sequelize }).listen(0, '127.0.0.1', () => resolve(instance));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1/games`;
  const response = await fetch(baseUrl.replace('/games', '/auth/login'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password })
  });
  accessToken = (await response.json()).data.accessToken;
}, 30000);

afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await database?.cleanup();
});

/** Each intent keeps its caller-owned key while HTTP and persistence remain real. */
async function request(path = '', { method = 'GET', body, key = randomUUID(), authenticated = true } = {}) {
  const response = await fetch(`${baseUrl}${path}`, { method,
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key,
      ...(authenticated ? { Authorization: `Bearer ${accessToken}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json() };
}

/** Server-owned fields never round-trip through the editable configuration contract. */
function editable(snapshot) {
  return { name: snapshot.data.game.name, expectedStateVersion: snapshot.meta.stateVersion,
    teams: snapshot.data.teams.map(({ id, name, color, sortOrder }) => ({ id, name, color, sortOrder })),
    boardCells: snapshot.data.boardCells };
}

it('G5 smoke: template → setup → preflight → edit invalidation → preflight → one atomic Start', async () => {
  const template = await request('/templates/prd-appendix-a-v1');
  expect(template.status).toBe(200);
  expect(template.body.data.template.reconciled).toBe(false);
  const cells = template.body.data.boardCells;
  expect(cells).toHaveLength(50);
  expect(cells.filter((cell) => cell.category === 'ACTION')).toHaveLength(15);
  expect(cells.filter((cell) => cell.category === 'REWARD')).toHaveLength(10);
  expect(cells.filter((cell) => cell.category === 'RACE_STRENGTH')).toHaveLength(9);
  expect(cells.filter((cell) => cell.category === 'PIT_STOP')).toHaveLength(8);
  expect(cells.filter((cell) => cell.category === 'INDISIPLINER').map((cell) => [cell.number, cell.penaltySteps]))
    .toEqual([[5, 2], [11, 4], [17, 5], [23, 3], [30, 5], [35, 5], [41, 4], [46, 6]]);
  expect(cells[25]).toMatchObject({ successPoints: 5, pointsPerUnit: 5, defaultScoringMethod: 'MANUAL' });
  expect(cells[43]).toMatchObject({ successPoints: 50, instruction: null });
  const created = await prepareTestSession(request, 'Seed launch');
  const id = created.body.data.game.id;
  const seeded = await request(`/${id}/board-template`, { method: 'POST', body: {
    templateId: 'prd-appendix-a-v1', expectedStateVersion: created.body.meta.stateVersion
  } });
  expect(seeded.status).toBe(200);
  expect(seeded.body.data.game.boardSource).toBe('PRD_APPENDIX_A');
  const draftStart = await request(`/${id}/start`, { method: 'POST', body: {
    expectedStateVersion: seeded.body.meta.stateVersion
  } });
  expect(draftStart.body.error.code).toBe('GAME_NOT_READY');
  const setup = await request(`/${id}/setup`, { method: 'PUT', body: { ...editable(seeded.body),
    teams: Array.from({ length: 10 }, (_, index) => ({
      name: `Tim ${index + 1}`, color: '#1254a3', sortOrder: index + 1
    })) } });
  expect(setup.status).toBe(200);
  expect(setup.body.data.game.boardSource).toBe('PRD_APPENDIX_A');
  const ready = await request(`/${id}/validate`, { method: 'POST', body: {
    expectedStateVersion: setup.body.meta.stateVersion
  } });
  expect(ready.status).toBe(200);
  expect(ready.body.data.game.status).toBe('READY');
  const edited = await request(`/${id}/setup`, { method: 'PUT', body: { ...editable(ready.body), name: 'Ready edited' } });
  expect(edited.body.data.game.status).toBe('DRAFT');
  expect((await request(`/${id}/start`, { method: 'POST', body: {
    expectedStateVersion: edited.body.meta.stateVersion
  } })).body.error.code).toBe('GAME_NOT_READY');
  const revalidated = await request(`/${id}/validate`, { method: 'POST', body: {
    expectedStateVersion: edited.body.meta.stateVersion
  } });
  const key = randomUUID();
  const start = { method: 'POST', key, body: { expectedStateVersion: revalidated.body.meta.stateVersion } };
  const [first, second] = await Promise.all([request(`/${id}/start`, start), request(`/${id}/start`, start)]);
  expect(first.status).toBe(200);
  expect(second.body.data).toEqual(first.body.data);
  expect(first.body.data.game).toMatchObject({ status: 'RUNNING', turnNumber: 0,
    currentTeamId: first.body.data.teams[0].id, activeTurnId: null });
  expect(first.body.data.game.startedAt).not.toBeNull();
  expect(first.body.data.teams.every((team) => team.position === 0 && team.totalScore === 0)).toBe(true);
  expect((await request(`/${id}/setup`, { method: 'PUT', body: editable(first.body) })).body.error.code).toBe('SETUP_LOCKED');
  const { GameEvent, OutboxEvent, CommandLog } = database.sequelize.models;
  expect(await GameEvent.count({ where: { gameId: id } })).toBe(7);
  expect(await OutboxEvent.count({ where: { gameId: id } })).toBe(7);
  expect(await CommandLog.count({ where: { gameId: id, commandType: 'START_GAME' } })).toBe(1);
});

it('G5 import/reset: invalid JSON is atomic; reset preserves configuration and archives progress', async () => {
  const template = (await request('/templates/prd-appendix-a-v1')).body.data;
  const created = await prepareTestSession(request, 'Import source');
  const id = created.body.data.game.id;
  const configuration = { format: 'leadership-race-board', schemaVersion: 1, boardCells: template.boardCells };
  const intent = { method: 'POST', key: randomUUID(), body: {
    expectedStateVersion: created.body.meta.stateVersion, configuration
  } };
  const imported = await request(`/${id}/board-import`, intent);
  expect(imported.status).toBe(200);
  expect(imported.body.data.game.boardSource).toBe('JSON_IMPORT');
  expect((await request(`/${id}/board-import`, intent)).body.data).toEqual(imported.body.data);
  for (const invalid of [
    { ...configuration, boardCells: template.boardCells.slice(1) },
    { ...configuration, boardCells: [template.boardCells[1], ...template.boardCells.slice(1)] },
    { ...configuration, token: 'unexpected' },
    { ...configuration, boardCells: template.boardCells.map((cell) => ({ ...cell, id: randomUUID() })) }
  ]) {
    const rejected = await request(`/${id}/board-import`, { method: 'POST', body: {
      expectedStateVersion: imported.body.meta.stateVersion, configuration: invalid
    } });
    expect(rejected.status).toBe(400);
    expect((await request(`/${id}/snapshot`)).body.data).toEqual(imported.body.data);
  }
  const setup = await request(`/${id}/setup`, { method: 'PUT', body: { ...editable(imported.body),
    teams: [{ name: 'Satu', color: '#b90500', sortOrder: 1 }, { name: 'Dua', color: '#1254a3', sortOrder: 2 }] } });
  const ready = await request(`/${id}/validate`, { method: 'POST', body: {
    expectedStateVersion: setup.body.meta.stateVersion
  } });
  const running = await request(`/${id}/start`, { method: 'POST', body: {
    expectedStateVersion: ready.body.meta.stateVersion
  } });
  const sourceTeam = running.body.data.teams[0];
  // A running game's mutable progress must never be inherited by the new event.
  const { Team, Game, CommandLog, OutboxEvent } = database.sequelize.models;
  await Team.update({ position: 26, totalScore: 35 }, { where: { id: sourceTeam.id, gameId: id } });
  const lockedImport = await request(`/${id}/board-import`, { method: 'POST', body: {
    expectedStateVersion: running.body.meta.stateVersion, configuration
  } });
  expect(lockedImport.body.error.code).toBe('SETUP_LOCKED');
  const resetIntent = { method: 'POST', key: randomUUID(), body: {
    expectedStateVersion: running.body.meta.stateVersion, confirmed: true
  } };
  const [first, second] = await Promise.all([
    request(`/${id}/reset`, resetIntent), request(`/${id}/reset`, resetIntent)
  ]);
  expect(first.status).toBe(200);
  expect(second.body.data.game.id).toBe(first.body.data.game.id);
  expect(first.body.data.game).toMatchObject({ status: 'DRAFT', turnNumber: 0, boardSource: 'JSON_IMPORT',
    currentTeamId: null, activeTurnId: null, startedAt: null, finishedAt: null });
  expect(first.body.data.teams.every((team) => team.position === 0 && team.totalScore === 0)).toBe(true);
  const sourceTeamIds = new Set(running.body.data.teams.map((team) => team.id));
  const sourceCellIds = new Set(running.body.data.boardCells.map((cell) => cell.id));
  expect(first.body.data.teams.some((team) => sourceTeamIds.has(team.id))).toBe(false);
  expect(first.body.data.boardCells.some((cell) => sourceCellIds.has(cell.id))).toBe(false);
  expect(first.body.data.boardCells.map(({ id: _id, ...cell }) => cell))
    .toEqual(running.body.data.boardCells.map(({ id: _id, ...cell }) => cell));
  expect((await Team.findByPk(sourceTeam.id)).position).toBe(26);
  expect(await CommandLog.count({ where: { gameId: id, commandType: 'RESET_GAME' } })).toBe(1);
  expect(await OutboxEvent.count({ where: { gameId: first.body.data.game.id } })).toBe(1);
  const beforeCount = await Game.count();
  const stale = await request(`/${first.body.data.game.id}/reset`, { method: 'POST', body: {
    expectedStateVersion: 0, confirmed: true
  } });
  expect(stale.body.error.code).toBe('STALE_STATE');
  expect(await Game.count()).toBe(beforeCount);
  expect((await request(`/${id}/board-import`, { method: 'POST', body: {
    expectedStateVersion: running.body.meta.stateVersion, configuration
  } })).body.error.code).toBe('GAME_ARCHIVED');
});

it('G5 guards: failed preflight/Start do not commit receipts or events, and Start rechecks persisted READY data', async () => {
  const created = await prepareTestSession(request, 'Invalid launch');
  const id = created.body.data.game.id;
  const cells = (await request('/templates/prd-appendix-a-v1')).body.data.boardCells;
  const teams = [{ name: 'Satu', color: '#b90500', sortOrder: 1 }, { name: 'Dua', color: '#1254a3', sortOrder: 2 }];
  const incomplete = await request(`/${id}/setup`, { method: 'PUT', body: {
    name: 'Invalid launch', expectedStateVersion: created.body.meta.stateVersion, teams, boardCells: cells.slice(1)
  } });
  const { CommandLog, GameEvent, BoardCell } = database.sequelize.models;
  const beforeEvents = await GameEvent.count({ where: { gameId: id } });
  const rejected = await request(`/${id}/validate`, { method: 'POST', body: {
    expectedStateVersion: incomplete.body.meta.stateVersion
  } });
  expect(rejected.body.error.code).toBe('CONFIGURATION_INVALID');
  expect((await request(`/${id}/snapshot`)).body.data.game.status).toBe('DRAFT');
  expect(await GameEvent.count({ where: { gameId: id } })).toBe(beforeEvents);
  expect(await CommandLog.count({ where: { gameId: id, commandType: 'VALIDATE_GAME' } })).toBe(0);
  const complete = await request(`/${id}/setup`, { method: 'PUT', body: {
    ...editable(incomplete.body), boardCells: cells
  } });
  const ready = await request(`/${id}/validate`, { method: 'POST', body: {
    expectedStateVersion: complete.body.meta.stateVersion
  } });
  expect(ready.status).toBe(200);
  // Simulate storage drift to prove Start does not blindly trust the earlier READY label.
  await BoardCell.destroy({ where: { gameId: id, number: 50 } });
  const refusedStart = await request(`/${id}/start`, { method: 'POST', body: {
    expectedStateVersion: ready.body.meta.stateVersion
  } });
  expect(refusedStart.status).toBe(409);
  expect(refusedStart.body.error.code).toBe('CONFIGURATION_INVALID');
  const current = await request(`/${id}/snapshot`);
  expect(current.body.data.game).toMatchObject({ status: 'READY', currentTeamId: null, startedAt: null });
  expect(current.body.meta.stateVersion).toBe(ready.body.meta.stateVersion);
  expect(await CommandLog.count({ where: { gameId: id, commandType: 'START_GAME' } })).toBe(0);
  expect((await request('/templates/prd-appendix-a-v1', { authenticated: false })).status).toBe(401);
});
