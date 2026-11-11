import fs from 'node:fs/promises';
import { expect } from '@playwright/test';

/** Exercises browser-chrome height changes against the caller's isolated game, without touching event data. */
export async function smokeBoardViewport({ page, api, gameId, database, output }) {
  expect(database.schemaName).toMatch(/^lr_test_/);
  const current = await api(`/${gameId}/snapshot`);
  const ready = await api(`/${gameId}/validate`, 'POST', { expectedStateVersion: current.meta.stateVersion });
  await api(`/${gameId}/start`, 'POST', { expectedStateVersion: ready.meta.stateVersion });
  await database.sequelize.models.Team.update({ position: 3 }, { where: { gameId } });
  await page.reload();
  await expect(page.locator('.token-cluster[data-count="10"]')).toBeVisible();
  const measurements = [];
  for (const width of [1920, 1366]) {
    let previousRatio;
    let previousTileRatio;
    for (const height of width === 1920 ? [900, 1080, 900] : [630, 768, 630]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => globalThis.document.fonts.ready);
      await page.evaluate(() => new Promise((resolve) => {
        globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve));
      }));
      await page.waitForFunction(() => {
        const frame = globalThis.document.querySelector('.board-viewport-shell');
        return !frame || Number.parseFloat(globalThis.getComputedStyle(frame).width) > 0;
      });
      const measured = await page.evaluate(() => {
        const rect = (selector) => {
          const box = globalThis.document.querySelector(selector).getBoundingClientRect();
          return { left: box.left, top: box.top, right: box.right, bottom: box.bottom,
            width: box.width, height: box.height };
        };
        return { width: globalThis.window.innerWidth, height: globalThis.window.innerHeight,
          scrollWidth: globalThis.document.documentElement.scrollWidth,
          scrollHeight: globalThis.document.documentElement.scrollHeight,
          header: rect('.display-header'), grid: rect('.race-grid'), ranking: rect('.board-ranking'),
          lastCell: rect('.race-grid > li:last-of-type'),
          tileDimensions: [...globalThis.document.querySelectorAll('.race-grid > li')].map((cell) => {
            const box = cell.getBoundingClientRect();
            return { width: box.width, height: box.height };
          }) };
      });
      expect(measured.scrollWidth, `horizontal fit ${width}x${height}`).toBeLessThanOrEqual(width);
      expect(measured.scrollHeight, `vertical fit ${width}x${height}`).toBeLessThanOrEqual(height);
      for (const part of [measured.header, measured.grid, measured.ranking, measured.lastCell]) {
        expect(part.left).toBeGreaterThanOrEqual(-1);
        expect(part.top).toBeGreaterThanOrEqual(-1);
        expect(part.right).toBeLessThanOrEqual(width + 1);
        expect(part.bottom).toBeLessThanOrEqual(height + 1);
      }
      expect(measured.tileDimensions).toHaveLength(50);
      for (const tile of measured.tileDimensions) {
        expect(Math.abs(tile.width - tile.height), `square tile ${width}x${height}`).toBeLessThan(1);
      }
      const ratio = measured.grid.width / measured.grid.height;
      const tileRatio = measured.lastCell.width / measured.lastCell.height;
      if (previousRatio !== undefined) expect(Math.abs(ratio - previousRatio)).toBeLessThan(0.01);
      if (previousTileRatio !== undefined) expect(Math.abs(tileRatio - previousTileRatio)).toBeLessThan(0.01);
      previousRatio = ratio;
      previousTileRatio = tileRatio;
      measurements.push(measured);
      await page.screenshot({ path: `${output}viewport-${width}-${height}.png` });
    }
  }
  await page.evaluate(() => {
    const button = globalThis.document.createElement('button');
    button.id = 'viewport-fullscreen-trigger';
    button.textContent = 'Enter fullscreen (test)';
    button.style.cssText = 'position:fixed;top:0;left:0;z-index:9999';
    button.addEventListener('click', async () => {
      await globalThis.document.documentElement.requestFullscreen();
      button.remove();
    });
    globalThis.document.body.appendChild(button);
  });
  await page.locator('#viewport-fullscreen-trigger').click();
  await expect.poll(() => page.evaluate(() => Boolean(globalThis.document.fullscreenElement))).toBe(true);
  await expect(page.locator('#viewport-fullscreen-trigger')).toHaveCount(0);
  const fullscreen = await page.evaluate(() => ({
    fullscreen: Boolean(globalThis.document.fullscreenElement),
    width: globalThis.window.innerWidth, height: globalThis.window.innerHeight,
    scrollWidth: globalThis.document.documentElement.scrollWidth,
    scrollHeight: globalThis.document.documentElement.scrollHeight
  }));
  expect(fullscreen.scrollWidth).toBeLessThanOrEqual(fullscreen.width);
  expect(fullscreen.scrollHeight).toBeLessThanOrEqual(fullscreen.height);
  measurements.push(fullscreen);
  await page.evaluate(() => globalThis.document.exitFullscreen());
  await expect.poll(() => page.evaluate(() => Boolean(globalThis.document.fullscreenElement))).toBe(false);
  await fs.writeFile(`${output}viewport-measurements.json`, JSON.stringify(measurements, null, 2));
  process.stdout.write('Board viewport smoke passed: windowed/fullscreen heights fit, '
    + 'stable square tiles and ten-team cluster.\n');
}
