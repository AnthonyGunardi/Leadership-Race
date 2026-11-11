import { expect } from '@playwright/test';

/** Confirms admin settings preserve drafts, save edits, and expose responsive controls. */
export async function smokeAdminSetup({ adminPage, api, base, gameId, output }) {
  await adminPage.setViewportSize({ width: 1440, height: 1000 });
  await adminPage.goto(`${base}/admin/games`);
  await expect(adminPage.getByRole('heading', { name: 'Admin game', exact: true })).toBeVisible();
  const teamInput = adminPage.getByLabel('Nama tim T1');
  await expect(teamInput).toBeVisible();
  const original = await teamInput.inputValue();
  const updated = `${original} · Uji`;
  await teamInput.fill(updated);
  await adminPage.getByRole('button', { name: 'Simpan tim dan poin', exact: true }).click();
  await expect(adminPage.getByText('Tim dan poin tersimpan.', { exact: true })).toBeVisible();
  await expect.poll(async () => (await api(`/${gameId}/snapshot`)).data.teams[0].name).toBe(updated);
  await adminPage.screenshot({ path: `${output}admin-setup-1440.png`, fullPage: true });
  await adminPage.setViewportSize({ width: 320, height: 1000 });
  await adminPage.goto(`${base}/admin/games/${gameId}/control`);
  await expect(adminPage.getByRole('heading', { name: 'Kontrol game', exact: true })).toBeVisible();
  await adminPage.screenshot({ path: `${output}admin-control-320.png`, fullPage: true });
  expect(await adminPage.evaluate(() => globalThis.document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await adminPage.setViewportSize({ width: 1440, height: 1000 });
}

/** Keeps correction authorization and audited writes in the existing form while checking its native checkbox layout. */
export async function smokeAdminCorrection({ adminPage, api, gameId, teamId, output }) {
  const before = (await api(`/${gameId}/snapshot`)).data.teams.find((team) => team.id === teamId).totalScore;
  await adminPage.getByTestId('toggle-correction-form-btn').click();
  await adminPage.getByTestId('correction-team-select').selectOption(teamId);
  await adminPage.getByTestId('correction-delta-input').fill('5');
  await adminPage.getByTestId('correction-reason-input').fill('Rehearsal layout admin: koreksi poin terverifikasi.');
  const checkbox = adminPage.getByTestId('correction-confirm-checkbox');
  expect((await checkbox.boundingBox()).width).toBeLessThanOrEqual(24);
  await checkbox.check();
  await adminPage.getByTestId('submit-correction-btn').click();
  await expect(adminPage.getByTestId('correction-success-banner')).toBeVisible();
  await expect.poll(async () => (await api(`/${gameId}/snapshot`)).data.teams
    .find((team) => team.id === teamId).totalScore).toBe(before + 5);
  const details = adminPage.locator('.audit-details').first();
  await expect(details).not.toHaveAttribute('open');
  await details.locator('summary').click();
  await expect(details.locator('.audit-change-summary')).toBeVisible();
  await details.locator('summary').click();
  await adminPage.getByRole('heading', { level: 1 }).click();
  await adminPage.screenshot({ path: `${output}admin-history-1440.png`, fullPage: true });
}
