import fs from 'node:fs/promises';
import { expect } from '@playwright/test';

/** Verifies every painted token position after a real admin roll, using only the smoke-owned test schema. */
export async function smokeMovement({ adminPage, page, api, base, gameId, database, output }) {
  const initial = await api(`/${gameId}/snapshot`);
  // Keep category counts valid while making cell 5 a non-penalty destination for this regression fixture.
  const destination = initial.data.boardCells.find((cell) => cell.number === 5);
  const normal = initial.data.boardCells.find((cell) => cell.category !== 'INDISIPLINER' && cell.number !== 5);
  const boardCells = initial.data.boardCells.map((cell) => ({ ...cell,
    number: cell.id === destination.id ? normal.number : cell.id === normal.id ? 5 : cell.number
  }));
  const configured = await api(`/${gameId}/setup`, 'PUT', {
    name: initial.data.game.name, expectedStateVersion: initial.meta.stateVersion, boardCells,
    teams: initial.data.teams.map(({ id, name, color, sortOrder }) => ({ id, name, color, sortOrder }))
  });
  const ready = await api(`/${gameId}/validate`, 'POST', { expectedStateVersion: configured.meta.stateVersion });
  const started = await api(`/${gameId}/start`, 'POST', { expectedStateVersion: ready.meta.stateVersion });
  // Seed the reported origin in the disposable schema before either browser loads the running game.
  await database.sequelize.models.Team.update({ position: 2 }, {
    where: { id: started.data.game.currentTeamId, gameId }
  });
  await adminPage.goto(`${base}/admin/games`);
  await page.reload();
  await expect(page.locator('[aria-label^="Kotak 2,"] [data-team-code="T1"]')).toBeVisible();
  await expect(adminPage.getByRole('button', { name: 'Dadu 3', exact: true })).toBeEnabled();

  // Sample on animation frames, so transient destination flashes and duplicate tokens fail the smoke too.
  const sampling = page.evaluate(() => new Promise((resolve) => {
    const samples = [];
    const until = globalThis.performance.now() + 3500;
    const sample = () => {
      const tokens = [...globalThis.document.querySelectorAll('[data-team-code="T1"]')];
      const token = tokens[0];
      let cell = token?.closest('.board-cell');
      const overlay = token?.closest('.movement-overlay-slot');
      if (overlay) {
        cell = [...globalThis.document.querySelectorAll('.board-cell')].find((item) => (
          item.style.gridRow === overlay.style.gridRow && item.style.gridColumn === overlay.style.gridColumn
        ));
      }
      samples.push({ cell: Number(cell?.querySelector('.cell-heading strong')?.textContent), count: tokens.length });
      if (globalThis.performance.now() < until) globalThis.requestAnimationFrame(sample);
      else resolve(samples);
    };
    globalThis.requestAnimationFrame(sample);
  }));
  await adminPage.getByRole('button', { name: 'Dadu 3', exact: true }).click();
  const samples = await sampling;
  const positions = samples.map(({ cell }) => cell)
    .filter((cell, index, all) => index === 0 || cell !== all[index - 1]);
  expect(positions).toEqual([2, 3, 4, 5]);
  expect(samples.every(({ count }) => count === 1)).toBe(true);
  await expect(page.locator('[aria-label^="Kotak 5,"] [data-team-code="T1"]')).toBeVisible();
  expect((await api(`/${gameId}/snapshot`)).data.teams.find((team) => team.code === 'T1').position).toBe(5);
  await page.screenshot({ path: `${output}movement-landed.png`, fullPage: true });
  await fs.writeFile(`${output}movement-frames.json`, JSON.stringify({ positions, samples }, null, 2));
  process.stdout.write('Movement smoke passed: admin dice 3, painted path 2 -> 3 -> 4 -> 5, one token per frame.\n');
}
