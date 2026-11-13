import { Link } from 'react-router';
import { useDisplayBoard } from '../hooks/useDisplayBoard.js';
import { LeaderboardPanel } from '../components/LeaderboardPanel.jsx';
import './displayBoard.css';
import './boardSimple.css';

/**
 * DisplayLeaderboardPage renders a fullscreen read-only leaderboard for audience displays.
 *
 * @returns {import('react').ReactElement}
 */
export function DisplayLeaderboardPage() {
  const display = useDisplayBoard();
  const game = display.view?.game;

  return (
    <main className="display-board board-simple display-leaderboard-fullscreen">
      <header className="display-header">
        <div className="display-title-group">
          <p>F1 Leadership Race</p>
          <h1>{game?.name ? `${game.name} — Leaderboard` : 'Leaderboard'}</h1>
        </div>
        <span className="display-state">{game?.status || 'Connecting'}</span>
      </header>

      {display.status !== 'connected' && (
        <div className="connection-banner" role="status">
          Connecting to server…
        </div>
      )}

      {display.view && (
        <div className="fullscreen-leaderboard-content">
          <LeaderboardPanel
            leaderboard={display.view.leaderboard}
            activeTeamId={display.view.activeTeam?.id}
          />
        </div>
      )}

      <footer className="display-footer">
        <nav aria-label="Display navigation">
          <Link to="/">Race board</Link>
          {' · '}
          <Link to="/final">Final results</Link>
        </nav>
        {display.snapshot?.meta?.serverTime && (
          <span>
            {' · '}Server confirmation: <time>{display.snapshot.meta.serverTime}</time>
          </span>
        )}
      </footer>
    </main>
  );
}

