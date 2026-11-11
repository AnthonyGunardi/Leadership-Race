import { setupGameSchema, completeBoardSchema, boardCategoryCounts } from '../validation/gameSetup.js';
import { GameError } from './gameCommands.js';

/** Rechecks persisted configuration for both READY and Start; optional activity text has no completion requirement. */
export function assertGamePreflight(snapshot) {
  const { game, teams, boardCells } = snapshot;
  const setup = setupGameSchema.safeParse({ name: game.name, expectedStateVersion: 0,
    teams: teams.map(({ id, name, color, sortOrder }) => ({ id, name, color, sortOrder })), boardCells });
  const board = completeBoardSchema.safeParse(boardCells);
  const issues = [setup, board].flatMap((result) => result.success ? [] : result.error.issues)
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  if (issues.length) {
    throw new GameError('CONFIGURATION_INVALID', `Preflight gagal. ${[...new Set(issues)].slice(0, 8).join(' ')}`);
  }
  if (game.currentTeamId !== null || game.activeTurnId !== null || game.startedAt !== null || game.turnNumber !== 0
    || teams.some((team) => team.position !== 0 || team.totalScore !== 0)) {
    throw new GameError('INITIAL_STATE_INVALID', 'Game belum dimulai harus berada di START dengan skor dan giliran 0.');
  }
  return { valid: true, teamCount: teams.length, cellCount: boardCells.length, categoryCounts: boardCategoryCounts };
}
