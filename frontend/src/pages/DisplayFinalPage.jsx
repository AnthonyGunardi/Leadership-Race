import { Link } from 'react-router';
import { useDisplayBoard } from '../hooks/useDisplayBoard.js';
import { LeaderboardPanel } from '../components/LeaderboardPanel.jsx';
import { Icon } from '../components/Icon.jsx';
import './displayBoard.css';

/**
 * DisplayFinalPage presents the big-screen celebration and final ranking after game is FINISHED.
 *
 * @returns {import('react').ReactElement}
 */
export function DisplayFinalPage() {
  const display = useDisplayBoard();
  const game = display.view?.game;
  const isFinished = game?.status === 'FINISHED';
  const winners = display.view?.leaderboard?.filter((team) => team.rank === 1) ?? [];

  return (
    <main className="display-board display-final">
      <header className="display-header">
        <div className="display-title-group">
          <p>F1 Leadership Race</p>
          <h1>{game?.name ? `${game.name} — Final Results` : 'Final Race Results'}</h1>
        </div>
        <span className="display-state">{game?.status || 'Connecting'}</span>
      </header>

      {display.status !== 'connected' && (
        <div className="connection-banner" role="status">
          Connecting to server to load final results…
          <div className="display-actions">
            <button type="button" onClick={display.retry}>Retry connecting</button>
          </div>
        </div>
      )}

      {display.view && isFinished && (
        <div className="final-celebration" role="region" aria-labelledby="final-heading">
          <h2 id="final-heading" className="celebration-title"><Icon name="flag" /> Race Finished!</h2>

          <section className="podium-section" aria-labelledby="podium-heading">
            <h3 id="podium-heading">Race Winners</h3>
            <div className="podium-grid">
              {winners.map((winner) => (
                <div key={winner.teamId} className="podium-card rank-1" style={{ borderColor: winner.color }}>
                  <div className="trophy-badge" aria-hidden="true"><Icon name="trophy" /></div>
                  <h4>{winner.name}</h4>
                  <p className="team-code">{winner.code}</p>
                  <p className="final-score"><strong>{winner.totalScore}</strong> pts</p>
                  <p className="winner-label">
                    {winners.length > 1 ? 'Co-Champion (1st Place)' : 'Champion (1st Place)'}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section className="standings-section" aria-labelledby="standings-heading">
            <h3 id="standings-heading">Full Standings</h3>
            <LeaderboardPanel leaderboard={display.view.leaderboard} />
          </section>
        </div>
      )}

      {display.view && !isFinished && (
        <div className="waiting-final-banner" role="status">
          <h2>Race Still In Progress</h2>
          <p>Current status: <strong>{game?.status}</strong></p>
          <p>Final display will activate automatically after committee finishes the race.</p>
          <Link to="/">Back to race board</Link>
        </div>
      )}

      <footer className="display-footer">
        <nav aria-label="Display navigation">
          <Link to="/">Race board</Link>
          {' · '}
          <Link to="/leaderboard">Leaderboard</Link>
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

