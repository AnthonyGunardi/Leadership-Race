import { RacingChip } from './RacingChip.jsx';

/**
 * Animated token movement overlay rendered directly on the CSS grid.
 *
 * Requirements:
 * - PRD §7.2, §7.5, §7.6, AT-04–AT-08, AT-45–AT-48.
 * - Displays the active team chip with golden halo ring.
 * - Positions the token precisely on currentCell's grid row and column.
 * - Avoids double markers: moving team is excluded from cell static docks while active.
 */
export function MovementOverlay({ timeline, team, cells }) {
  if (!timeline?.isMoving || !timeline.currentCell || !team) {
    return null;
  }

  const targetCell = cells.find((c) => c.number === timeline.currentCell);
  if (!targetCell) {
    return null;
  }

  const penaltyClass = timeline.phase === 'PENALTY' ? 'is-retreating' : '';

  return (
    <div
      className={`movement-overlay-slot ${penaltyClass}`}
      style={{ gridRow: targetCell.row, gridColumn: targetCell.column }}
      aria-live="polite"
      role="status"
    >
      <div className="movement-overlay-token">
        <RacingChip team={team} active />
        <span className="sr-only">
          Token {team.code} at cell {targetCell.number}
        </span>
      </div>
    </div>
  );
}
