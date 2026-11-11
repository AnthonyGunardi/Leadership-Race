import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { expect } from '@playwright/test';

/** Exercises two isolated admin browsers against the smoke-owned HTTPS server and disposable schema. */
export async function smokeController({ browser, adminPage, api, base, gameId, database, bootstrapAdminUser, output }) {
  const initial = await api(`/${gameId}/snapshot`);
  const ready = await api(`/${gameId}/validate`, 'POST', { expectedStateVersion: initial.meta.stateVersion });
  await api(`/${gameId}/start`, 'POST', { expectedStateVersion: ready.meta.stateVersion });
  const email = 'controller-browser-b@example.test';
  const password = randomUUID();
  const user = await bootstrapAdminUser({ sequelize: database.sequelize, email, password });
  const second = await browser.newContext({ ignoreHTTPSErrors: true });
  // Controller expiry must not depend on this browser's wall clock.
  await second.addInitScript(() => {
    const realNow = Date.now;
    Date.now = () => realNow() + 120000;
  });
  const login = await second.request.post(`${base}/api/v1/auth/login`, { data: { email, password } });
  expect(login.ok()).toBe(true);
  const page = await second.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.name));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await adminPage.goto(`${base}/admin/games/${gameId}/control`);
  await page.goto(`${base}/admin/games/${gameId}/control`);
  await expect(page.getByText('Belum ada controller aktif.')).toBeVisible();
  // Lose only the response after a real commit: the visible retry must decrypt the same receipt token.
  await adminPage.route('**/controller/acquire', async (route) => {
    expect((await route.fetch()).status()).toBe(200);
    await route.abort();
  });
  await adminPage.getByRole('button', { name: 'Ambil controller', exact: true }).focus();
  await adminPage.keyboard.press('Enter');
  await expect(adminPage.getByRole('button', { name: 'Coba ulang tindakan yang sama' })).toBeVisible();
  await adminPage.unroute('**/controller/acquire');
  await adminPage.getByRole('button', { name: 'Coba ulang tindakan yang sama' }).click();
  await expect(adminPage.getByText('Controller aktif: Anda')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Take Over', exact: true })).toBeEnabled({ timeout: 10000 });
  await expect(page.getByRole('button', { name: 'Ambil controller', exact: true })).toBeDisabled();
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'Take Over', exact: true }).click();
  await expect(page.getByText('Controller aktif: Anda')).toHaveCount(0);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Take Over', exact: true }).click();
  await expect(page.getByText('Controller aktif: Anda')).toBeVisible();
  await expect(adminPage.getByText(`Controller aktif: ${user.id}`)).toBeVisible({ timeout: 10000 });
  const { ControllerLease } = database.sequelize.models;
  await expect.poll(async () => Number((await ControllerLease.findByPk(gameId)).version), { timeout: 16000 })
    .toBeGreaterThanOrEqual(3);
  expect((await ControllerLease.findByPk(gameId)).holderUserId).toBe(user.id);
  const measurements = [];
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const scrollWidth = await page.evaluate(() => globalThis.document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(width);
    await expect(page.getByRole('button', { name: 'Muat ulang status', exact: true })).toBeVisible();
    measurements.push({ width, scrollWidth });
    if (width === 320 || width === 1440) {
      await page.screenshot({ path: `${output}controller-${width}.png`, fullPage: true });
    }
  }
  await page.evaluate(() => { globalThis.document.documentElement.style.fontSize = '200%'; });
  expect(await page.evaluate(() => globalThis.document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440);
  await page.evaluate(() => { globalThis.document.documentElement.style.fontSize = ''; });
  await fs.writeFile(`${output}controller-accessibility.txt`, await page.locator('main').ariaSnapshot());
  // Prevent an auth-refresh race while checking the disconnected permission state.
  await second.setOffline(true);
  await expect(page.getByText('Koneksi terputus. Kontrol dinonaktifkan sampai status server dikonfirmasi.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Take Over', exact: true })).toBeDisabled();
  await second.setOffline(false);
  await page.getByRole('button', { name: 'Muat ulang status', exact: true }).click();
  await expect(page.getByText('Controller aktif: Anda')).toBeVisible();

  // G7 browser smoke: verify physical dice roll in browser UI
  await expect(page.getByRole('heading', { name: 'Giliran & Dadu Fisik' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Dadu 3', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Dadu 3', exact: true }).click();
  await expect(page.getByTestId('turn-status')).toHaveText(/ANIMATING|AWAITING_RESULT/);

  expect(errors).toEqual([]);
  // Closing the controller browser must let a lease expire rather than leave a permanent controller.
  await second.close();
  const { expiresAt } = await ControllerLease.findByPk(gameId);
  expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
  // The API test covers actual expiry without waiting 30 seconds in this browser smoke.
  await fs.writeFile(`${output}controller-measurements.json`, JSON.stringify({ measurements, runtimeErrors: 0,
    checks: ['unknown-commit retry', 'two admins', 'confirmation', 'takeover', 'automatic heartbeat',
      'wrong client clock', 'keyboard', '200% text', 'offline recovery'] }, null, 2));
  await adminPage.getByRole('button', { name: 'Muat ulang status', exact: true }).click();
}
