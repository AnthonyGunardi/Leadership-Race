import { expect, it } from 'vitest';
import { assertGamePreflight } from '../services/gamePreflight.js';
import { getPrdBoardTemplate } from '../data/boardTemplate.js';

/** Activity references are intentionally blank to prove they do not become hidden readiness requirements. */
function configuration() {
  return { game: { name: 'Preflight test', currentTeamId: null, activeTurnId: null, startedAt: null, turnNumber: 0 },
    teams: [{ name: 'Tim satu', sortOrder: 1, color: '#b90500', position: 0, totalScore: 0 },
      { name: 'Tim dua', sortOrder: 2, color: '#1254a3', position: 0, totalScore: 0 }],
    boardCells: getPrdBoardTemplate().boardCells };
}

it('accepts the minimum two teams and Reward references that are empty or narrative', () => {
  const input = configuration();
  input.boardCells[1].instruction = 'Apresiasi atas koordinasi tim.';
  expect(assertGamePreflight(input)).toMatchObject({ valid: true, teamCount: 2, cellCount: 50 });
});

it.each([
  ['49 cells', (input) => input.boardCells.pop()],
  ['duplicate cell number', (input) => { input.boardCells[0].number = 2; }],
  ['one team', (input) => input.teams.pop()],
  ['eleven teams', (input) => {
    input.teams = Array.from({ length: 11 }, (_, index) => ({
      name: `Tim ${index}`, sortOrder: index + 1, color: '#1254a3', position: 0, totalScore: 0
    }));
  }],
  ['duplicate turn order', (input) => { input.teams[1].sortOrder = 1; }],
  ['wrong category counts', (input) => { input.boardCells[1].category = 'ACTION'; }],
  ['invalid penalty scoring', (input) => { input.boardCells[4].successPoints = 20; }],
  ['negative score value', (input) => { input.boardCells[0].successPoints = -1; }]
])('rejects %s before READY or Start', (_name, change) => {
  const input = configuration();
  change(input);
  expect(() => assertGamePreflight(input)).toThrow(/Preflight gagal/);
});

it('rejects residual score/progress instead of erasing history while starting', () => {
  const input = configuration();
  input.teams[0].totalScore = 5;
  expect(() => assertGamePreflight(input)).toThrow(/START/);
});
