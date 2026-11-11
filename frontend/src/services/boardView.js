const categories = {
  ACTION: 'Action', REWARD: 'Reward', RACE_STRENGTH: 'Race Strength', PIT_STOP: 'Pit Stop', INDISIPLINER: 'Indisipliner'
};
const categoryCodes = { ACTION: 'A', REWARD: 'R', RACE_STRENGTH: 'RS', PIT_STOP: 'PS', INDISIPLINER: 'I' };

/** Occupancy uses visual positions; the active chip takes one of the three stable visible slots. */
function occupancy(teams, position, activeTeamId) {
  const occupants = teams.filter((team) => team.position === position).sort((a, b) => (
    Number(b.id === activeTeamId) - Number(a.id === activeTeamId)
      || a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)
  ));
  return {
    chips: occupants.slice(0, 3),
    hidden: Math.max(0, occupants.length - 3),
    count: occupants.length,
    occupants
  };
}

/**
 * Visual positions and occupancy during motion are separated from authoritative persistence.
 * Origin decreases when motion starts; destination increases on landing; no double marker with overlay.
 */
export function buildBoardView(snapshot, timeline = null) {
  if (!snapshot) return null;
  const { teams = [], boardCells = [], game = {} } = snapshot.data || {};
  const configured = new Map(boardCells.map((cell) => [cell.number, cell]));

  const movingTeamId = timeline?.isMoving ? timeline.movement?.teamId : null;
  const visualTeams = timeline?.phase === 'STARTING'
    ? teams.map((team) => team.id === timeline.movement?.teamId ? { ...team, position: timeline.currentCell } : team)
    : teams;
  const staticTeams = movingTeamId ? visualTeams.filter((team) => team.id !== movingTeamId) : visualTeams;
  const activeTeamId = timeline?.movement?.teamId || game.currentTeamId;
  const activeTeam = teams.find((team) => team.id === activeTeamId) || null;

  const fullPathSet = new Set(timeline?.movement?.fullPath || []);
  const penaltyPathSet = new Set(timeline?.movement?.penaltyPath || []);

  const cells = Array.from({ length: 50 }, (_, index) => {
    const number = index + 1;
    const row = Math.floor(index / 10);
    const cell = configured.get(number);
    const isInPath = fullPathSet.has(number);
    const isCurrentStep = Boolean(timeline?.isMoving && timeline?.currentCell === number);
    const isBouncePoint = Boolean(timeline?.isBounce && number === 50);
    const isPenaltyStep = penaltyPathSet.has(number);
    const isLandingCell = Boolean(timeline?.isMoving && timeline?.movement?.landingCell === number);

    return {
      number,
      row: row + 1,
      column: row % 2 === 0 ? index % 10 + 1 : 10 - index % 10,
      title: cell?.title ?? 'Not configured',
      category: cell?.category ?? 'UNCONFIGURED',
      categoryLabel: categories[cell?.category] ?? 'DRAFT',
      categoryCode: categoryCodes[cell?.category] ?? '—',
      isInPath,
      isCurrentStep,
      isBouncePoint,
      isPenaltyStep,
      isLandingCell,
      ...occupancy(staticTeams, number, activeTeamId)
    };
  });

  return {
    game,
    teams,
    activeTeam,
    isFocusMode: Boolean(timeline?.isMoving),
    timeline,
    cells,
    leaderboard: snapshot.data?.leaderboard || [],
    start: occupancy(staticTeams, 0, activeTeamId)
  };
}
