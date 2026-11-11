import { BoardCell } from './BoardCell.jsx';
import { TokenCluster } from './TokenCluster.jsx';
import { MovementOverlay } from './MovementOverlay.jsx';

/** START is attached to the board canvas; it never changes position-zero teams into cell-one occupants. */
export function RaceBoard({ view }) {
  const activeTeamId = view.activeTeam?.id || view.game?.currentTeamId;
  return (
    <div className="race-board-wrapper">
      <ol className={`race-grid ${view.isFocusMode ? 'focus-mode-active' : ''}`}
        aria-label="50-cell race board, zigzag order from top-left">
        {view.cells.map((cell) => <BoardCell key={cell.number} cell={cell} activeTeamId={activeTeamId} />)}
        <MovementOverlay timeline={view.timeline} team={view.activeTeam} cells={view.cells} />
      </ol>
      <div className="start-dock" aria-label="START">
        <span className="start-dock-label"><strong>START · 0</strong></span>
        <TokenCluster occupants={view.start.occupants} chips={view.start.chips} hidden={view.start.hidden}
          count={view.start.count} activeTeamId={activeTeamId} cellNumber={0} />
      </div>
    </div>
  );
}
