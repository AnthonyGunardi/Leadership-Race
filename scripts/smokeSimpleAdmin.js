import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import https from 'node:https';
import { chromium, expect } from '@playwright/test';

// The browser and API share only a disposable lr_test_* schema, never development/event rows.
process.env.NODE_ENV = 'test';
process.env.CONTROLLER_RECEIPT_KEYS = JSON.stringify({ v1: randomBytes(32).toString('hex') });
const require = createRequire(import.meta.url);
const run = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const output = fileURLToPath(new URL('../test-results/simple-admin/', import.meta.url));
const [{ createApp }, { getEnv }, { setupIsolatedTestDatabase }, { bootstrapAdminUser }] = await Promise.all([
  import('../backend/src/app.js'), import('../backend/src/config/environment.js'),
  import('../backend/src/tests/helpers/testDatabase.js'), import('../backend/src/services/adminBootstrap.js')
]);
let database;
let server;
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
  server = https.createServer({ key: await fs.readFile(keyPath), cert: await fs.readFile(certPath) },
    createApp({ sequelize: database.sequelize, staticPath: `${root}frontend/dist` }));
  await fs.unlink(keyPath);
  await fs.unlink(certPath);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `https://127.0.0.1:${server.address().port}`;
  const email = 'simple-admin@example.test';
  const password = randomUUID();
  await bootstrapAdminUser({ sequelize: database.sequelize, email, password });
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 } });
  const login = await context.request.post(`${base}/api/v1/auth/login`, { data: { email, password } });
  const accessToken = (await login.json()).data.accessToken;
  /** Reads authoritative state without extracting browser credentials or altering game data outside the UI. */
  async function snapshot() {
    const response = await context.request.get(`${base}/api/v1/public/game`);
    expect(response.ok()).toBe(true);
    return response.json();
  }
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.name));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  const preview = await snapshot();
  await page.goto(`${base}/admin/games`);
  await page.getByRole('button', { name: 'Atur tim', exact: true }).click();
  await page.getByLabel('Nama tim T2').fill('Biru');
  const teamDetails = page.locator('#admin-teams details');
  await teamDetails.locator('summary').click();
  await page.getByRole('button', { name: 'Simpan tim dan poin' }).click();
  await expect(teamDetails).toHaveAttribute('open');
  await expect(page.getByLabel('Nama tim T1')).toBeFocused();
  await page.getByLabel('Nama tim T1').fill('Merah');
  await page.getByLabel('Kotak challenge', { exact: true }).selectOption('1');
  await page.getByLabel('Poin Sukses', { exact: true }).fill('15');
  await page.getByRole('button', { name: 'Simpan tim dan poin' }).click();
  await expect(page.getByText('Tim dan poin tersimpan.', { exact: true })).toBeVisible();
  const configured = await snapshot();
  const gameId = configured.data.game.id;
  expect(configured.data.teams.map((team) => team.name)).toEqual(['Merah', 'Biru']);
  expect(configured.data.boardCells[0].successPoints).toBe(15);
  expect(configured.data.boardCells[1].successPoints).toBe(preview.data.boardCells[1].successPoints);
  await page.screenshot({ path: `${output}settings-1440.png`, fullPage: true });
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Mulai bermain' }).click();
  const dice = page.getByRole('button', { name: 'Dadu 1', exact: true });
  await expect(dice).toBeEnabled();
  await dice.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Pion sedang bergerak. Tunggu sampai selesai.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reset game', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Sukses 15 poin' }).click();
  await expect.poll(async () => (await snapshot()).data.teams[0].totalScore).toBe(15);
  await expect(dice).toBeEnabled();
  await dice.click();
  await page.getByRole('button', { name: 'Gagal 0 poin' }).click();
  await expect.poll(async () => (await snapshot()).data.teams[1].position).toBe(1);
  await expect(dice).toBeEnabled();
  await dice.click();
  await page.getByRole('tab', { name: 'Input Poin Manual' }).click();
  await page.getByLabel(/Total Poin Manual/).fill('25');
  await page.screenshot({ path: `${output}scoring-1440.png`, fullPage: true });
  await page.getByRole('button', { name: 'Simpan Poin Manual' }).click();
  await expect.poll(async () => (await snapshot()).data.teams[0].totalScore).toBe(40);
  const measurements = [];
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const scrollWidth = await page.evaluate(() => globalThis.document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(width);
    measurements.push({ width, scrollWidth });
    await expect(page.getByRole('heading', { name: 'Tim', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Posisi pion', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Setelan poin challenge', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reset game', exact: true })).toBeVisible();
    await page.screenshot({ path: `${output}playing-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 320, height: 1000 });
  await page.evaluate(() => { globalThis.document.documentElement.style.fontSize = '200%'; });
  expect(await page.evaluate(() => globalThis.document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.screenshot({ path: `${output}text-200.png`, fullPage: true });
  await page.evaluate(() => { globalThis.document.documentElement.style.fontSize = ''; });
  await page.getByRole('button', { name: 'Dadu 1', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Dadu 2', exact: true })).toBeFocused();
  expect(await page.getByRole('button', { name: 'Dadu 2', exact: true })
    .evaluate((button) => globalThis.getComputedStyle(button).outlineStyle)).not.toBe('none');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'Reset game', exact: true }).click();
  expect((await snapshot()).data.game.id).toBe(gameId);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Reset game', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mulai bermain' })).toBeEnabled();
  const reset = await snapshot();
  expect(reset.data.game.id).not.toBe(gameId);
  expect(reset.data.teams.every((team) => team.position === 0 && team.totalScore === 0)).toBe(true);
  expect(reset.data.boardCells[0].successPoints).toBe(15);
  await expect(page).toHaveURL(`${base}/admin/games`);
  const archives = await context.request.get(`${base}/api/v1/games/archives`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  expect((await archives.json()).data.games[0].id).toBe(gameId);
  expect(errors).toEqual([]);
  await fs.writeFile(`${output}measurements.json`, JSON.stringify({ measurements, runtimeErrors: errors }, null, 2));
  process.stdout.write('Simple admin smoke passed: team/points, preflight/start, dice, success/fail/manual, confirmed reset, archive and four viewports.\n');
} catch (error) {
  process.stderr.write(`${error.name}: ${error.message}\n`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  await database?.cleanup();
}
