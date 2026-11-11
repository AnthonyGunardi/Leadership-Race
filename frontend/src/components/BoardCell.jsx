import React from 'react';
import { TokenCluster } from './TokenCluster.jsx';
import { Icon } from './Icon.jsx';

/**
 * BoardCell Component per PRD §7.1, §7.2, §7.5, §7.6.
 *
 * Characteristics:
 * - 2.5D tile with category colors, high-contrast borders, bevels, and shadows.
 * - Dedicated chip-dock with TokenCluster: max 3 visible chips + '+N' + 'N TIM' badge.
 * - Number and category labels are never covered by dock or badges.
 * - Wrapped in React.memo per PRD §7.5 to avoid re-rendering all 50 tiles on every animation frame.
 */
function BoardCellComponent({
  cell,
  activeTeamId = null
}) {
  const highlightClasses = [
    cell.isInPath ? 'is-in-path' : '',
    cell.isCurrentStep ? 'is-current-step' : '',
    cell.isBouncePoint ? 'is-bounce-point' : '',
    cell.isPenaltyStep ? 'is-penalty-step' : '',
    cell.isLandingCell ? 'is-landing-cell' : ''
  ].filter(Boolean).join(' ');

  const className = `board-cell category-${cell.category} ${highlightClasses}`.trim();

  return (
    <li
      className={className}
      style={{ gridRow: cell.row, gridColumn: cell.column }}
      aria-label={`Cell ${cell.number}, ${cell.categoryLabel}, ${cell.title}, ${cell.count} ${cell.count === 1 ? 'team' : 'teams'}`}
    >
      <div className="cell-heading">
        <strong>{cell.number}</strong>
        <Icon name={cell.category} className="cell-icon" />
      </div>
      <div className="cell-category">
        <span className="cell-category-full">{cell.categoryLabel}</span>
        <span className="cell-category-short" aria-hidden="true">{cell.categoryCode}</span>
      </div>
      <span className="cell-title" title={cell.title}>{cell.title}</span>
      <div className="chip-dock">
        <TokenCluster
          occupants={cell.occupants}
          chips={cell.chips}
          hidden={cell.hidden}
          count={cell.count}
          activeTeamId={activeTeamId}
          cellNumber={cell.number}
        />
      </div>
    </li>
  );
}

export const BoardCell = React.memo(BoardCellComponent);
