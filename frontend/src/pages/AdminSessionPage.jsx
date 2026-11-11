import { Link } from 'react-router';
import { useSingleGame } from '../hooks/useSingleGame.js';
import { SimpleGameAdmin } from '../components/SimpleGameAdmin.jsx';
import './gameSetup.css';
import './simpleAdmin.css';

/** Admins perform the four event tasks without navigating a catalog or technical control pages. */
export function AdminSessionPage({ session }) {
  const games = useSingleGame(session);
  return (
    <main className="admin-access simple-admin">
      <a className="skip-link" href="#admin-teams">Skip to team settings</a>
      <header className="simple-admin-header">
        <div><Link to="/">F1 Leadership Race</Link><h1>Game Admin</h1>
          <p>Manage teams, run turns, and record points.</p></div>
        <div className="simple-account"><span className="account-email">{session.user.email}</span>
          <Link to="/">Open board</Link>
          {games.game?.id && <Link to={`/admin/games/${games.game.id}/history`}>History & CSV</Link>}
          <button className="secondary" type="button" disabled={session.isLoading} onClick={session.logout}>Log out</button>
        </div>
      </header>
      <nav className="simple-task-nav" aria-label="Admin navigation">
        <a href="#admin-teams">Teams</a><a href="#admin-position">Pawn positions</a>
        <a href="#admin-points">Challenge points</a><a href="#admin-reset">Reset</a>
        {games.game?.id && <Link to={`/admin/games/${games.game.id}/history`}>History & Export CSV</Link>}
      </nav>
      {!games.online && <p role="status">Connection lost. Controls are disabled until connection is restored.</p>}
      {games.query.isPending && <p role="status">Loading game…</p>}
      {games.query.isError && <div role="alert" className="auth-error"><p>{games.query.error.message}</p>
        <button type="button" onClick={() => games.query.refetch()}>Reload game</button></div>}
      {games.query.isSuccess && !games.game?.id && <section id="admin-teams" className="simple-section">
        <h2>Teams</h2><p>Set up game to configure teams. 50-cell board is ready.</p>
        <form onSubmit={games.create}><button type="submit" disabled={games.disabled}>Set up teams</button></form>
      </section>}
      {games.command.error && <p role="alert" className="auth-error">{games.command.error.message}</p>}
      {games.command.uncertain && <button type="button" disabled={!games.online || games.command.pending}
        onClick={games.command.retry}>Retry setup</button>}
      {games.game?.id && <SimpleGameAdmin key={games.game.id} session={session} gameId={games.game.id} />}
    </main>
  );
}
