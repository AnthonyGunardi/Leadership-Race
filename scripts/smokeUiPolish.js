import fs from 'node:fs/promises';
import { expect } from '@playwright/test';
import { smokeAdminSetup, smokeAdminCorrection } from './smokeAdminLayout.js';

/** Measures rendered essentials after resize; CSS values alone cannot prove LED fit or tile containment. */
async function checkBoardViewport(page, width, height, output, scene) {
  await page.setViewportSize({ width, height });
  await page.evaluate(() => globalThis.document.fonts.ready);
  await expect.poll(() => page.evaluate(() => globalThis.window.innerWidth)).toBe(width);
  const layout = await page.evaluate(() => {
    const rect = (selector) => {
      const box = globalThis.document.querySelector(selector).getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height, bottom: box.bottom };
    };
    const outsideTiles = [];
    const coveredNumbers = [];
    const hiddenCategories = [];
    const nonSquareTiles = [];
    for (const cell of globalThis.document.querySelectorAll('.race-grid > li')) {
      const tile = cell.getBoundingClientRect();
      if (globalThis.window.innerWidth >= 768 && Math.abs(tile.width - tile.height) >= 1) {
        nonSquareTiles.push(cell.getAttribute('aria-label'));
      }
      const number = cell.querySelector('.cell-heading strong').getBoundingClientRect();
      const category = cell.querySelector('.cell-category-full');
      if (!category.getClientRects().length) hiddenCategories.push(cell.getAttribute('aria-label'));
      for (const part of cell.querySelectorAll('.cell-heading strong, .cell-category, .chip-dock .token-cluster')) {
        const box = part.getBoundingClientRect();
        if (box.width && box.height && (box.bottom > tile.bottom + 1 || box.right > tile.right + 1)) {
          outsideTiles.push(cell.getAttribute('aria-label'));
        }
      }
      for (const token of cell.querySelectorAll('.racing-token')) {
        const box = token.getBoundingClientRect();
        if (box.width && box.height && box.left < number.right && box.right > number.left
          && box.top < number.bottom && box.bottom > number.top) {
          coveredNumbers.push(cell.getAttribute('aria-label'));
        }
      }
    }
    return {
      scrollWidth: globalThis.document.documentElement.scrollWidth,
      scrollHeight: globalThis.document.documentElement.scrollHeight,
      grid: rect('.race-grid'), board: rect('.board-stage'), ranking: rect('.board-ranking'),
      outsideTiles, coveredNumbers, hiddenCategories, nonSquareTiles
    };
  });
  await page.screenshot({ path: `${output}ui-${scene}-${width}.png`, fullPage: true });
  expect(layout.scrollWidth, `${scene} horizontal fit at ${width}`).toBeLessThanOrEqual(width);
  expect(layout.outsideTiles, `${scene} tile containment at ${width}`).toEqual([]);
  expect(layout.coveredNumbers, `${scene} cell numbers remain clear at ${width}`).toEqual([]);
  expect(layout.hiddenCategories, `${scene} categories remain written in full at ${width}`).toEqual([]);
  expect(layout.nonSquareTiles, `${scene} display tiles remain square at ${width}`).toEqual([]);
  expect(layout.grid.bottom, `${scene} grid stays inside board at ${width}`)
    .toBeLessThanOrEqual(layout.board.bottom + 1);
  if (width < 768) {
    expect(layout.ranking.y, `${scene} ranking starts below board at ${width}`)
      .toBeGreaterThanOrEqual(layout.board.bottom);
  }
  if (width >= 1200) {

    expect(layout.scrollHeight, `${scene} full LED layout at ${width}`).toBeLessThanOrEqual(height);
  }
  if (width >= 768) {
    const total = layout.board.width + layout.ranking.width;
    // Uniform scaling produces fractional-pixel bounds; keep the exact 75:25 contract within rendering precision.
    expect(layout.board.width / total).toBeCloseTo(0.75, 6);
    expect(layout.ranking.width / total).toBeCloseTo(0.25, 6);
    expect(layout.ranking.x).toBeGreaterThan(layout.board.x + layout.board.width);
  }
  return { scene, width, height, ...layout };
}

/** Exercises presentation and the real scoring path only against the caller's disposable smoke database. */
export async function smokeUiPolish({ browser, page, adminPage, api, base, gameId, database, output }) {
  expect(database.schemaName).toMatch(/^lr_test_/);
  // The caller sets NODE_ENV and ephemeral keys before loading backend configuration.
  const { settleExpiredMovementIfDue } = await import('../backend/src/services/turnSettlement.js');
  const measurements = [];
  await smokeAdminSetup({ adminPage, api, base, gameId, output });
  const current = await api(`/${gameId}/snapshot`);
  const ready = await api(`/${gameId}/validate`, 'POST', { expectedStateVersion: current.meta.stateVersion });
  const started = await api(`/${gameId}/start`, 'POST', { expectedStateVersion: ready.meta.stateVersion });
  const activeId = started.data.game.currentTeamId;
  const { Team } = database.sequelize.models;
  await Team.update({ position: 26 }, { where: { gameId } });
  await Team.update({ name: 'Tim Leadership dengan nama panjang untuk uji keterbacaan seluruh peserta' },
    { where: { id: activeId, gameId } });
  await page.reload();
  await expect(page.locator('main')).toHaveAttribute('data-connection', 'connected');
  await expect(page.locator('.race-grid .racing-token.is-active')).toHaveText('T1');
  const cluster = page.locator('.race-grid > li').filter({ has: page.locator('.token-cluster[data-count="10"]') });
  await expect(cluster).toHaveCount(1);
  await expect(cluster.locator('.racing-token')).toHaveCount(3);
  await expect(cluster.locator('.chip-overflow')).toHaveText('+7');
  await expect(cluster.locator('.cluster-total-badge')).toHaveText('10 TIM');
  await page.setViewportSize({ width: 1920, height: 1080 });
  expect(await cluster.locator('.racing-token:not(.is-active)').first().evaluate((element) =>
    Number.parseFloat(globalThis.getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(18);
  for (const [width, height] of [[1920, 1080], [1366, 768], [1440, 1000], [1024, 900], [768, 1000], [320, 1000]]) {
    measurements.push(await checkBoardViewport(page, width, height, output, 'cluster'));
  }

  await page.setViewportSize({ width: 1920, height: 1080 });
  await expect(page.locator('.active-team-hud, .team-position-tracker, .occupancy-panel, .display-controls, .display-footer, .board-toolbar, .focus-path-overlay')).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.locator('.racing-token.is-active').first().evaluate((element) =>
    globalThis.getComputedStyle(element).animationName)).toBe('none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  await Team.update({ position: 18 }, { where: { id: activeId, gameId } });
  await page.reload();
  await expect(page.locator('.race-grid .racing-token.is-active')).toHaveText('T1');
  const beforeMove = await page.locator('.race-grid').boundingBox();
  const snapshot = await api(`/${gameId}/snapshot`);
  const lease = await api(`/${gameId}/controller/acquire`, 'POST', { expectedStateVersion: snapshot.meta.stateVersion });
  const rolled = await api(`/${gameId}/turns/roll`, 'POST', { diceValue: 4, expectedTurnNumber: 1,
    expectedStateVersion: lease.meta.stateVersion, controllerLeaseToken: lease.data.controllerLeaseToken });
  expect(rolled.data.fullPath).toEqual([19, 20, 21, 22]);
  await expect(page.locator('.race-grid')).toHaveClass(/focus-mode-active/);
  expect(await page.locator('.race-grid').boundingBox()).toEqual(beforeMove);
  await expect(page.locator('.movement-overlay-slot')).toHaveCount(1);
  await expect(page.locator('.movement-overlay-slot [data-team-code="T1"]')).toHaveCount(1);
  await expect(page.locator('.board-cell.is-current-step .cell-category-full')).toBeVisible();
  await page.screenshot({ path: `${output}ui-movement-1920.png`, fullPage: true });
  await expect(page.locator('.movement-overlay-slot')).toHaveCount(0, { timeout: 10000 });
  await expect(page.locator('.race-grid > li').nth(21).locator('.racing-token')).toHaveText('T1');
  await settleExpiredMovementIfDue({ sequelize: database.sequelize, gameId });
  await adminPage.goto(`${base}/admin/games/${gameId}/control`);
  const scoreButton = adminPage.getByRole('button', { name: /^Sukses \d+ poin$/ });
  await expect(scoreButton).toBeEnabled();
  await scoreButton.click();
  await expect.poll(async () => (await api(`/${gameId}/snapshot`)).data.game.currentTeamId).not.toBe(activeId);
  const scored = await api(`/${gameId}/snapshot`);
  expect(scored.data.teams.find((team) => team.id === activeId).totalScore).toBeGreaterThan(0);

  const anonymous = await browser.newContext({ ignoreHTTPSErrors: true });
  const publicPage = await anonymous.newPage();
  for (const [path, scene] of [['/', 'home'], ['/login', 'login']]) {
    await publicPage.goto(`${base}${path}`);
    for (const width of [320, 768, 1024, 1440]) {
      await publicPage.setViewportSize({ width, height: 1000 });
      expect(await publicPage.evaluate(() => globalThis.document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(width);
      if ([320, 1440].includes(width)) {
        await publicPage.screenshot({ path: `${output}ui-${scene}-${width}.png`, fullPage: true });
      }
    }
  }
  await anonymous.close();
  for (const route of ['control', 'scoreboard', 'history', 'setup']) {
    await adminPage.goto(`${base}/admin/games/${gameId}/${route}`);
    await expect(adminPage.getByRole('heading', { level: 1 })).toBeVisible();
    for (const width of [320, 768, 1024, 1440]) {
      await adminPage.setViewportSize({ width, height: 1000 });
      expect(await adminPage.evaluate(() => globalThis.document.documentElement.scrollWidth), route)
        .toBeLessThanOrEqual(width);
    }
    await adminPage.getByRole('heading', { level: 1 }).click();
    await adminPage.screenshot({ path: `${output}ui-admin-${route}.png`, fullPage: true });
    if (route === 'history') await smokeAdminCorrection({ adminPage, api, gameId, teamId: activeId, output });
  }
  await page.goto(`${base}/leaderboard`);
  await expect(page.locator('.leaderboard-table tbody tr')).toHaveCount(10);
  await page.screenshot({ path: `${output}ui-leaderboard.png`, fullPage: true });
  const finishing = await api(`/${gameId}/snapshot`);
  await api(`/${gameId}/finish`, 'POST', { expectedStateVersion: finishing.meta.stateVersion, confirmed: true });
  await page.goto(`${base}/final`);
  await expect(page.getByRole('heading', { name: /Balapan Selesai/ })).toBeVisible();
  await expect(page.locator('.podium-card')).toHaveCount(1);
  await page.screenshot({ path: `${output}ui-final.png`, fullPage: true });
  for (const [width, height] of [[1920, 1080], [1366, 768], [320, 1000]]) {
    await page.setViewportSize({ width, height });
    expect(await page.evaluate(() => globalThis.document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    if (width >= 1200) {
      expect(await page.evaluate(() => globalThis.document.documentElement.scrollHeight)).toBeLessThanOrEqual(height);
    }
    await page.screenshot({ path: `${output}ui-final-${width}.png`, fullPage: true });
  }
  await fs.writeFile(`${output}ui-accessibility.txt`, await page.locator('main').ariaSnapshot());
  await page.goto(base);
  await expect(page.locator('.race-grid > li')).toHaveCount(50);
  await adminPage.goto(`${base}/admin/games`);
  await fs.writeFile(`${output}ui-measurements.json`, JSON.stringify(measurements, null, 2));
  process.stdout.write('UI polish smoke passed: minimal 75:25 board, six viewports, cluster/movement, admin editors/navigation/correction, scoring and final.\n');
}
