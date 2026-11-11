import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import https from 'node:https';
import { chromium, expect } from '@playwright/test';
import { smokeController } from './smokeController.js';
import { smokeUiPolish } from './smokeUiPolish.js';
import { smokeMovement } from './smokeMovement.js';
import { smokeBoardViewport } from './smokeBoardViewport.js';

// This smoke owns its server, disposable schema and browser profiles; it never touches event/development rows.
process.env.NODE_ENV = 'test';
process.env.CONTROLLER_RECEIPT_KEYS = JSON.stringify({ v1: randomBytes(32).toString('hex') });
const require = createRequire(import.meta.url);
const run = promisify(execFile);
const controllerSmoke = process.argv.includes('--controller');
const launchSmoke = process.argv.includes('--launch') || controllerSmoke;
const root = fileURLToPath(new URL('../', import.meta.url));
const output = fileURLToPath(new URL('../test-results/display-smoke/', import.meta.url));
const [{ createApp }, { createGameGateway }, { getEnv }, { setupIsolatedTestDatabase }, { bootstrapAdminUser }] =
  await Promise.all([
    import('../backend/src/app.js'), import('../backend/src/realtime/gameGateway.js'),
    import('../backend/src/config/environment.js'), import('../backend/src/tests/helpers/testDatabase.js'),
    import('../backend/src/services/adminBootstrap.js')
  ]);
let database;
let server;
let gateway;
let browser;

try {
  await fs.mkdir(output, { recursive: true });
  database = await setupIsolatedTestDatabase();
  const env = getEnv();
  await run(process.execPath, [require.resolve('sequelize-cli/lib/sequelize'), 'db:migrate', '--env', 'test',
    '--config', `${root}backend/sequelize.config.cjs`, '--migrations-path', `${root}backend/migrations`], {
    env: { ...process.env, DB_NAME: database.schemaName, DB_HOST: env.DB_HOST, DB_PORT: String(env.DB_PORT),
      DB_USER: env.DB_USER, DB_PASSWORD: env.DB_PASSWORD }
  });
  const keyPath = `${output}key.pem`;
  const certPath = `${output}cert.pem`;
  const openssl = process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl';
  await run(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath,
    '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost']);
  const app = createApp({ sequelize: database.sequelize, staticPath: `${root}frontend/dist` });
  server = https.createServer({ key: await fs.readFile(keyPath), cert: await fs.readFile(certPath) }, app);
  await fs.unlink(keyPath);
  await fs.unlink(certPath);
  gateway = createGameGateway({ server, sequelize: database.sequelize });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `https://127.0.0.1:${server.address().port}`;
  const email = 'g4-browser@example.test';
  const password = randomUUID();
  await bootstrapAdminUser({ sequelize: database.sequelize, email, password });
  browser = await chromium.launch({ headless: true });
  const admin = await browser.newContext({ ignoreHTTPSErrors: true });
  const login = await admin.request.post(`${base}/api/v1/auth/login`, { data: { email, password } });
  const accessToken = (await login.json()).data.accessToken;
  /** This client keeps the bearer in memory and creates one key per explicit admin intent. */
  async function api(path, method = 'GET', data) {
    const response = await admin.request.fetch(`${base}/api/v1/games${path}`, {
      method, data, headers: { Authorization: `Bearer ${accessToken}`, 'Idempotency-Key': randomUUID() }
    });
    if (!response.ok()) throw new Error(`Admin request failed with ${response.status()}`);
    return response.json();
  }
  const emptyDisplay = await browser.newContext({ ignoreHTTPSErrors: true });
  const emptyPage = await emptyDisplay.newPage();
  await emptyPage.goto(base);
  await expect(emptyPage.locator('.race-grid > li')).toHaveCount(50);
  await expect(emptyPage.getByRole('textbox', { name: /kode/i })).toHaveCount(0);
  await expect(emptyPage.getByRole('button', { name: 'Reset game' })).toHaveCount(0);
  await emptyDisplay.close();
  const created = await api('/current', 'POST', { name: 'Leadership Race · G4' });
  let id = created.data.game.id;
  const boardTemplate = (await api('/templates/prd-appendix-a-v1')).data;
  await api(`/${id}/setup`, 'PUT', { name: 'Leadership Race · G4', expectedStateVersion: created.meta.stateVersion,
    teams: Array.from({ length: 10 }, (_, index) => ({
      name: `Tim ${index + 1}`,
      color: ['#c42e32', '#19733e', '#126baf', '#8732bc', '#b97003'][index % 5], sortOrder: index + 1
    })), boardCells: launchSmoke ? [] : boardTemplate.boardCells });
  const adminPage = await admin.newPage();
  const adminErrors = [];
  adminPage.on('pageerror', (error) => adminErrors.push(error.name));
  if (launchSmoke) {
    await adminPage.goto(`${base}/admin/games/${id}/setup`);
    adminPage.once('dialog', (dialog) => dialog.accept());
    await adminPage.getByRole('button', { name: 'Terapkan template 50 kotak' }).click();
    await expect(adminPage.getByRole('heading', { name: 'Konfigurasi kotak (50/50)' })).toBeVisible();
    await expect(adminPage.locator('.source-notice')).toContainText('Belum direkonsiliasi');
    await adminPage.getByRole('button', { name: 'Jalankan preflight' }).click();
    await expect(adminPage.getByText('Preflight lulus. Konfigurasi tersimpan siap untuk Start.')).toBeVisible();
    await adminPage.getByLabel('Nama event', { exact: true }).fill('Leadership Race · G5');
    await expect(adminPage.getByRole('button', { name: 'Start game', exact: true })).toBeDisabled();
    await adminPage.getByRole('button', { name: 'Simpan setup', exact: true }).first().click();
    await expect(adminPage.getByText(/Status DRAFT · Versi/)).toBeVisible();
    await adminPage.getByRole('button', { name: 'Jalankan preflight' }).click();
    await expect(adminPage.getByText('Preflight lulus. Konfigurasi tersimpan siap untuk Start.')).toBeVisible();
    adminPage.once('dialog', (dialog) => dialog.accept());
    await adminPage.getByRole('button', { name: 'Start game', exact: true }).click();
    await expect(adminPage.getByText('Game dimulai. Tim aktif: T1 · Tim 1.')).toBeVisible();
    const launched = await api(`/${id}/snapshot`);
    expect(launched.data.game.status).toBe('RUNNING');
    expect(launched.data.teams.every((team) => team.position === 0 && team.totalScore === 0)).toBe(true);
    await adminPage.screenshot({ path: `${output}launch-start.png` });
    await adminPage.goto(`${base}/admin/games`);
    adminPage.once('dialog', (dialog) => dialog.accept());
    await adminPage.getByRole('button', { name: 'Reset game', exact: true }).click();
    await expect(adminPage).toHaveURL(`${base}/admin/games`);
    await expect.poll(async () => (await (await admin.request.get(`${base}/api/v1/public/game`)).json())
      .data.game.id).not.toBe(id);
    const copyId = (await (await admin.request.get(`${base}/api/v1/public/game`)).json()).data.game.id;
    expect(copyId).not.toBe(id);
    id = copyId;
    await adminPage.goto(`${base}/admin/games/${id}/setup`);
    await expect(adminPage.getByText(/Status DRAFT · Versi/)).toBeVisible();
    await adminPage.getByText('Impor konfigurasi kotak dari JSON', { exact: true }).click();
    await adminPage.getByRole('button', { name: 'Muat contoh JSON' }).click();
    await expect(adminPage.getByLabel('Konfigurasi JSON', { exact: true })).toContainText('leadership-race-board');
    const template = (await api('/templates/prd-appendix-a-v1')).data;
    await adminPage.getByLabel('File JSON (maksimal 1 MiB)').setInputFiles({
      name: 'board.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
        format: 'leadership-race-board', schemaVersion: 1, boardCells: template.boardCells
      }))
    });
    adminPage.once('dialog', (dialog) => dialog.accept());
    await adminPage.getByRole('button', { name: 'Impor 50 kotak', exact: true }).click();
    await expect(adminPage.locator('.source-notice')).toContainText('impor JSON');
    const copied = await api(`/${id}/snapshot`);
    expect(copied.data.game.status).toBe('DRAFT');
    expect(copied.data.teams).toHaveLength(10);
    expect(copied.data.boardCells).toHaveLength(50);
    await adminPage.setViewportSize({ width: 320, height: 900 });
    const setupWidth = await adminPage.evaluate(() => globalThis.document.documentElement.scrollWidth);
    expect(setupWidth).toBeLessThanOrEqual(320);
    await adminPage.screenshot({ path: `${output}launch-setup-320.png` });
    await adminPage.setViewportSize({ width: 1280, height: 900 });
  }
  await adminPage.goto(`${base}/admin/games`);
  await expect(adminPage.getByRole('button', { name: 'Reset game', exact: true })).toBeVisible();
  await expect(adminPage.getByRole('link', { name: 'Akses display' })).toHaveCount(0);
  const display = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 } });
  const page = await display.newPage();
  const errors = [];
  let expectedNetworkFailure = false;
  page.on('pageerror', (error) => errors.push(error.name));
  page.on('console', (message) => {
    if (message.type() === 'error'
      && !(expectedNetworkFailure && message.text().startsWith('Failed to load resource:'))) {
      errors.push(message.text());
    }
  });
  await page.goto(base);
  await expect(page.locator('.race-grid > li')).toHaveCount(50);
  await expect(page.locator('main')).toHaveAttribute('data-connection', 'connected');
  await expect(page.locator('.start-dock .racing-chip')).toHaveCount(3);
  await expect(page.locator('.start-dock .chip-overflow')).toHaveText('+7');
  await expect(page.locator('.leaderboard-table tbody tr')).toHaveCount(10);
  await expect(page.locator('main')).toHaveAttribute('data-connection', 'connected');
  const measurements = [];
  for (const [width, height] of [[1920, 1080], [1366, 768], [1440, 1000], [1024, 900], [768, 1000], [320, 1000]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => globalThis.document.fonts.ready);
    const measured = await page.evaluate(() => ({
      scrollWidth: globalThis.document.documentElement.scrollWidth, width: globalThis.window.innerWidth,
      cells: globalThis.document.querySelectorAll('.race-grid > li').length,
      gridBottom: globalThis.document.querySelector('.race-grid').getBoundingClientRect().bottom
    }));
    expect(measured.scrollWidth).toBeLessThanOrEqual(width);
    expect(measured.cells).toBe(50);
    if (width >= 1366) expect(measured.gridBottom).toBeLessThan(height);
    measurements.push({ width, height, ...measured });
    if ([1920, 1366, 1440, 320].includes(width)) {
      await page.screenshot({ path: `${output}board-${width}.png`, fullPage: true });
    }
  }
  expect(errors).toEqual([]);
  expect(adminErrors).toEqual([]);
  expectedNetworkFailure = true;
  await display.setOffline(true);
  await expect(page.locator('main')).not.toHaveAttribute('data-connection', 'connected', { timeout: 25000 });
  await expect(page.locator('.race-grid > li')).toHaveCount(50);
  await display.setOffline(false);
  await expect(page.locator('main')).toHaveAttribute('data-connection', 'connected', { timeout: 25000 });
  expectedNetworkFailure = false;
  const latest = await api(`/${id}/snapshot`);
  const { teams, boardCells } = latest.data;
  await api(`/${id}/setup`, 'PUT', { name: 'Leadership Race · Tersinkron kembali',
    expectedStateVersion: latest.meta.stateVersion,
    teams: teams.map(({ id, name, color, sortOrder }) => ({ id, name, color, sortOrder })), boardCells });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Leadership Race · Tersinkron kembali');
  if (process.argv.includes('--viewport')) {
    await smokeBoardViewport({ page, api, gameId: id, database, output });
  }
  if (process.argv.includes('--ui-polish')) {
    await smokeUiPolish({ browser, page, adminPage, api, base, gameId: id, database, output });
  }
  if (process.argv.includes('--movement')) {
    await smokeMovement({ adminPage, page, api, base, gameId: id, database, output });
  }
  await adminPage.goto(`${base}/admin/games`);
  const oldId = id;
  for (const width of [320, 768, 1024, 1440]) {
    await adminPage.setViewportSize({ width, height: 1000 });
    expect(await adminPage.evaluate(() => globalThis.document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await expect(adminPage.getByRole('button', { name: 'Reset game', exact: true })).toBeVisible();
  }
  await adminPage.screenshot({ path: `${output}reset-admin.png`, fullPage: true });
  adminPage.once('dialog', (dialog) => dialog.dismiss());
  await adminPage.getByRole('button', { name: 'Reset game', exact: true }).click();
  expect((await api(`/${id}/snapshot`)).data.game.id).toBe(oldId);
  adminPage.once('dialog', (dialog) => dialog.accept());
  expectedNetworkFailure = true;
  await adminPage.getByRole('button', { name: 'Reset game', exact: true }).focus();
  await adminPage.keyboard.press('Enter');
  await expect(adminPage).toHaveURL(`${base}/admin/games`);
  await expect.poll(async () => (await (await admin.request.get(`${base}/api/v1/public/game`)).json())
    .data.game.id).not.toBe(oldId);
  id = (await (await admin.request.get(`${base}/api/v1/public/game`)).json()).data.game.id;
  expect(id).not.toBe(oldId);
  const reset = await api(`/${id}/snapshot`);
  expect(reset.data.teams.every((team) => team.position === 0 && team.totalScore === 0)).toBe(true);
  expect(reset.data.teams).toHaveLength(10);
  expect(reset.data.boardCells).toHaveLength(50);
  await expect(page.locator('main')).toHaveAttribute('data-connection', 'connected', { timeout: 15000 });
  await expect(page.locator('main')).toHaveAttribute('data-game-id', id, { timeout: 15000 });
  await expect.poll(async () => {
    const response = await display.request.get(`${base}/api/v1/public/game`);
    return (await response.json()).data.game.id;
  }).toBe(id);
  await expect(page.locator('.race-grid > li')).toHaveCount(50);
  await adminPage.goto(`${base}/admin/games`);
  expect((await api('/archives')).data.games.some((game) => game.id === oldId)).toBe(true);
  expect((await api(`/${oldId}/history`)).data.game.isArchived).toBe(true);
  await expect(adminPage.getByRole('heading', { name: 'Arsip permainan', exact: true })).toHaveCount(0);
  await adminPage.goto(`${base}/admin/games/${oldId}/history`);
  await expect(adminPage).toHaveURL(`${base}/admin/games/${oldId}/history`);
  await expect(adminPage.getByText('Arsip permainan · hanya baca. Skor dan riwayat sesi ini dipertahankan.')).toBeVisible();
  await expect(adminPage.getByTestId('toggle-correction-form-btn')).toHaveCount(0);
  await adminPage.screenshot({ path: `${output}reset-archive.png`, fullPage: true });
  expect(errors).toEqual([]);
  await fs.writeFile(`${output}measurements.json`, JSON.stringify({ measurements, runtimeErrors: 0 }, null, 2));
  if (controllerSmoke) {
    await smokeController({ browser, adminPage, api, base, gameId: id, database, bootstrapAdminUser, output });
    process.stdout.write('G6 browser smoke passed: two admins, encrypted retry, takeover, heartbeat and responsive UI.\n');
  }
  process.stdout.write('Public board/reset smoke passed: no pairing, 50 cells/10 teams, six viewports, reconnect, live updates, confirmed reset and read-only archive.\n');
} catch (error) {
  process.stderr.write(`${error.name}: ${error.message}\n`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await gateway?.stop();
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  await database?.cleanup();
}
