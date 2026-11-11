/**
 * Displays the real-time leaderboard table with server-calculated rankings.
 *
 * Requirements:
 * - Ranks are calculated authoritative by backend (standard competition ranking).
 * - Tied scores share the same rank (e.g., multiple teams at rank 1).
 * - Displays rank, team code, team name, current board position, and total score.
 * - Highlights active team row for operational clarity.
 *
 * @param {object} props Component properties.
 * @param {Array<object>} props.leaderboard Leaderboard items from server snapshot/API.
 * @param {string} [props.activeTeamId] Currently active team ID to highlight.
 * @param {string} [props.title='Leaderboard'] Title heading.
 * @returns {import('react').ReactElement}
 */
export function LeaderboardPanel({
  leaderboard = [],
  activeTeamId = null,
  title = 'Leaderboard'
}) {
  return (
    <section className="leaderboard-panel" aria-labelledby="leaderboard-panel-heading">
      <h2 id="leaderboard-panel-heading">{title}</h2>
      {leaderboard.length === 0 ? (
        <p>No team data to display.</p>
      ) : (
        <div className="leaderboard-table-container">
          <table className="leaderboard-table" data-testid="leaderboard-table">
            <caption className="sr-only">Team scores and position standings table</caption>
            <thead>
              <tr>
                <th scope="col" className="col-rank">Rank</th>
                <th scope="col" className="col-team">Team</th>
                <th scope="col" className="col-pos">Position</th>
                <th scope="col" className="col-score">Point</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.map((item) => {
                const isActive = item.teamId === activeTeamId;
                return (
                  <tr
                    key={item.teamId}
                    className={`leaderboard-row ${isActive ? 'active-team-row' : ''}`}
                    aria-current={isActive ? 'true' : undefined}
                  >
                    <td className="col-rank">
                      <span className={`rank-badge rank-${item.rank}`}>#{item.rank}</span>
                    </td>
                    <td className="col-team">
                      <span className="team-cell">
                        <strong className="team-code">{item.code}</strong>
                        <span className="team-name" title={item.name}>{item.name}</span>
                      </span>
                    </td>
                    <td className="col-pos">{item.position === 0 ? 'START' : `Square ${item.position}`}</td>
                    <td className="col-score">
                      <strong className="score-value">{item.totalScore}</strong>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

