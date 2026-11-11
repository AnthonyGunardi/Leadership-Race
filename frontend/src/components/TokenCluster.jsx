import { RacingToken } from './RacingToken.jsx';

/**
 * Adaptive Token Clustering Component per PRD §7.2, §7.6, AT-33, AT-36, AT-43, AT-44.
 *
 * Tiering Rules:
 * - 0 occupants: Renders nothing.
 * - 1 occupant: 1 individual RacingToken.
 * - 2–3 occupants: 2–3 individual RacingTokens spaced evenly.
 * - 4–10 occupants: Maximum 3 RacingTokens, "+N" overflow badge (where N = total - 3),
 *   and an explicit "N TIM" total count badge (e.g. "4 TIM", "6 TIM", "10 TIM").
 *
 * Visual Invariants:
 * - Active team is prioritized into visible chips if present in the cell (AT-44).
 * - Total count and hidden count are accurate and never doubled.
 * - Cell numbers and categories remain visible without badge overflow.
 */
export function TokenCluster({
  occupants = [],
  chips = null,
  hidden = null,
  count = null,
  activeTeamId = null,
  cellNumber = null
}) {
  const totalCount = count !== null ? count : occupants.length;
  if (totalCount === 0) return null;

  // If chips not pre-computed by boardView, calculate stably with active team priority
  const visibleChips = chips || (
    [...occupants]
      .sort((a, b) => (
        Number(b.id === activeTeamId) - Number(a.id === activeTeamId)
          || (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
          || (a.id || '').localeCompare(b.id || '')
      ))
      .slice(0, 3)
  );

  const hiddenCount = hidden !== null ? hidden : Math.max(0, totalCount - visibleChips.length);

  return (
    <div
      className="token-cluster"
      aria-label={`Token cluster cell ${cellNumber ?? ''}: ${totalCount} ${totalCount === 1 ? 'team' : 'teams'}`}
      data-count={totalCount}
    >
      <div className="cluster-chips-row">
        {visibleChips.map((team) => (
          <RacingToken
            key={team.id}
            team={team}
            active={team.id === activeTeamId}
          />
        ))}
      </div>

      {totalCount >= 4 && <div className="cluster-summary">
        {hiddenCount > 0 && (
          <span
            className="chip-overflow"
            title={`${hiddenCount} other ${hiddenCount === 1 ? 'team' : 'teams'} on this cell`}
            aria-label={`+${hiddenCount} other ${hiddenCount === 1 ? 'team' : 'teams'}`}
          >
            +{hiddenCount}
          </span>
        )}
        <span
          className="cluster-total-badge"
          title={`Total ${totalCount} ${totalCount === 1 ? 'team occupies' : 'teams occupy'} this cell`}
          aria-label={`Total ${totalCount} ${totalCount === 1 ? 'team' : 'teams'}`}
        >
          {totalCount} TEAMS
        </span>
      </div>}
    </div>
  );
}

