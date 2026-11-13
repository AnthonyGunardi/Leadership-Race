import { useLayoutEffect, useRef } from 'react';
import { RacingChip } from './RacingChip.jsx';

/**
 * Animated token movement overlay rendered directly on the CSS grid.
 *
 * Requirements:
 * - PRD §7.2, §7.5, §7.6, AT-04–AT-08, AT-45–AT-48.
 * - Displays the active team chip with golden halo ring.
 * - Positions the token precisely on currentCell's grid row and column.
 * - Uses physical DOM bounding rects for pixel-accurate sub-step translation across varying resolutions and grid gaps.
 * - Avoids double markers: moving team is excluded from cell static docks while active.
 */
export function MovementOverlay({ timeline, team, cells }) {
  const slotRef = useRef(null);

  const prevCellNumber = timeline?.prevCell;
  const currentCellNumber = timeline?.currentCell;

  useLayoutEffect(() => {
    const slotEl = slotRef.current;
    if (!slotEl) return;

    if (Number.isFinite(prevCellNumber) && prevCellNumber > 0) {
      const grid = slotEl.parentElement;
      const sourceEl = grid?.querySelector(`[data-cell-number="${prevCellNumber}"]`);
      if (sourceEl) {
        const sRect = sourceEl.getBoundingClientRect();
        const tRect = slotEl.getBoundingClientRect();
        if (sRect.width > 0 && tRect.width > 0) {
          slotEl.style.setProperty('--delta-x', `${(sRect.left - tRect.left).toFixed(2)}px`);
          slotEl.style.setProperty('--delta-y', `${(sRect.top - tRect.top).toFixed(2)}px`);
          return;
        }
      }
    } else if (prevCellNumber === 0) {
      const startEl = slotEl.closest('.race-board-wrapper')?.querySelector('.start-dock');
      if (startEl) {
        const sRect = startEl.getBoundingClientRect();
        const tRect = slotEl.getBoundingClientRect();
        if (sRect.width > 0 && tRect.width > 0) {
          const deltaX = (sRect.left + sRect.width / 2) - (tRect.left + tRect.width / 2);
          const deltaY = (sRect.top + sRect.height / 2) - (tRect.top + tRect.height / 2);
          slotEl.style.setProperty('--start-delta-x', `${deltaX.toFixed(2)}px`);
          slotEl.style.setProperty('--start-delta-y', `${deltaY.toFixed(2)}px`);
          return;
        }
      }
    }

    slotEl.style.removeProperty('--delta-x');
    slotEl.style.removeProperty('--delta-y');
    slotEl.style.removeProperty('--start-delta-x');
    slotEl.style.removeProperty('--start-delta-y');
  }, [prevCellNumber, currentCellNumber]);

  if (!timeline?.isMoving || !timeline.currentCell || !team) {
    return null;
  }

  const targetCell = cells.find((c) => c.number === timeline.currentCell);
  if (!targetCell) {
    return null;
  }

  const prefersReducedMotion = typeof window !== 'undefined'
    && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);

  const sourceCell = Number.isFinite(prevCellNumber) && prevCellNumber > 0
    ? cells.find((c) => c.number === prevCellNumber)
    : null;

  const isWrapAround = prevCellNumber === 50 && targetCell.number === 1;
  const isStartLaunch = prevCellNumber === 0;

  const subStepProgress = Number.isFinite(timeline.subStepProgress) ? timeline.subStepProgress : 0;
  const glideRatio = 0.55;

  let transformStyle = {};

  if (!prefersReducedMotion && subStepProgress < glideRatio) {
    const p = subStepProgress / glideRatio;
    const eased = 1 - (1 - p) ** 3;
    const fractionRemaining = 1 - eased;

    if (isStartLaunch) {
      const scale = 0.6 + 0.4 * eased;
      const opacity = 0.4 + 0.6 * eased;
      transformStyle = {
        transform: `translate(calc(var(--start-delta-x, 0px) * ${fractionRemaining.toFixed(4)}), calc(var(--start-delta-y, 0px) * ${fractionRemaining.toFixed(4)})) scale(${scale.toFixed(3)})`,
        opacity: opacity.toFixed(3)
      };
    } else if (isWrapAround) {
      const scale = 0.7 + 0.3 * eased;
      const opacity = 0.3 + 0.7 * eased;
      transformStyle = {
        transform: `scale(${scale.toFixed(3)})`,
        opacity: opacity.toFixed(3)
      };
    } else if (sourceCell) {
      const deltaCol = sourceCell.column - targetCell.column;
      const deltaRow = sourceCell.row - targetCell.row;
      const fallbackX = `${(deltaCol * 100).toFixed(0)}%`;
      const fallbackY = `${(deltaRow * 100).toFixed(0)}%`;
      transformStyle = {
        transform: `translate(calc(var(--delta-x, ${fallbackX}) * ${fractionRemaining.toFixed(4)}), calc(var(--delta-y, ${fallbackY}) * ${fractionRemaining.toFixed(4)}))`
      };
    }
  }

  const penaltyClass = timeline.phase === 'PENALTY' ? 'is-retreating' : '';

  return (
    <div
      ref={slotRef}
      className={`movement-overlay-slot ${penaltyClass}`}
      style={{ gridRow: targetCell.row, gridColumn: targetCell.column }}
      aria-live="polite"
      role="status"
    >
      <div className="movement-overlay-token" style={transformStyle}>
        <RacingChip team={team} active />
        <span className="sr-only">
          Token {team.code} at cell {targetCell.number}
        </span>
      </div>
    </div>
  );
}
