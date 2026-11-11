import { useDisplayBoard } from '../hooks/useDisplayBoard.js';
import { useBoardViewport } from '../hooks/useBoardViewport.js';
import { RaceBoard } from '../components/RaceBoard.jsx';
import { LeaderboardPanel } from '../components/LeaderboardPanel.jsx';
import './displayBoard.css';
import './boardSimple.css';

/** The public screen contains only its title, board and ranking; server-scheduled motion remains authoritative. */
export function DisplayBoardPage() {
  const display = useDisplayBoard();
  const { viewportRef, canvasRef, frameStyle } = useBoardViewport();
  const connectionLabel = display.status === 'unauthenticated'
    ? 'Display session ended'
    : 'Connection out of sync — displaying last confirmed state';

  return (
    <main ref={viewportRef} className="display-board board-simple" data-connection={display.status}
      data-game-id={display.view?.game.id || ''}>
      <div className="board-viewport-shell" style={frameStyle}>
        <div className="board-viewport-canvas" ref={canvasRef}>
          <header className="display-header">
            <h1>{display.view?.game.name || 'F1 Leadership Race'}
              {display.status !== 'connected' && <span className="board-connection-state" role="status">
                {' · '}{connectionLabel}
              </span>}
            </h1>
          </header>
          <div className="display-main-arena">
            <section className="board-stage" aria-label="Board game area">
              {display.view ? <RaceBoard view={display.view} /> : (
                <div className="board-unavailable" role="status">
                  <p>Loading game board…</p>
                  <button type="button" onClick={display.retry}>Retry connecting</button>
                </div>
              )}
            </section>
            <aside className="board-ranking" aria-label="Leaderboard">
              <LeaderboardPanel leaderboard={display.view?.leaderboard || []}
                activeTeamId={display.view?.activeTeam?.id || display.view?.game.currentTeamId} />
            </aside>
          </div>
        </div>
      </div>
    </main>
  );
}
