import { Link, NavLink } from 'react-router';
import { useAdminSession } from '../hooks/useAdminSession.js';
import '../pages/simpleAdmin.css';
import '../pages/gameSetup.css';
import '../pages/adminWorkspace.css';

/**
 * Shared layout for secondary/detail admin pages (e.g. History/Audit, Control).
 * Matches the simple, single-page header and horizontal navigation of /admin/games.
 */
export function AdminPage({ title, subtitle, gameId, status, session: sessionProp, className = '', children }) {
  const fallbackSession = useAdminSession();
  const session = sessionProp || fallbackSession;

  return (
    <main className={`admin-access simple-admin ${className}`} id="admin-main">
      <a className="skip-link" href="#admin-page-content">Skip to main content</a>
      <header className="simple-admin-header">
        <div>
          <Link to="/">F1 Leadership Race</Link>
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <div className="simple-account">
          {session?.user?.email && <span className="account-email">{session.user.email}</span>}
          <Link to="/">Open board</Link>
          <Link to="/admin/games">Back to Game Admin</Link>
          {session?.logout && (
            <button
              className="secondary"
              type="button"
              disabled={session.isLoading}
              onClick={session.logout}
            >
              Log out
            </button>
          )}
        </div>
      </header>

      <nav
        id="admin-navigation"
        className="simple-task-nav admin-page-nav"
        aria-label="Admin navigation"
      >
        <NavLink end to="/admin/games">Game Admin</NavLink>
        {gameId && (
          <>
            <NavLink to={`/admin/games/${gameId}/history`}>Riwayat & Ekspor CSV</NavLink>
            <NavLink to={`/admin/games/${gameId}/control`}>Kontrol game</NavLink>
          </>
        )}
        <Link to="/">Race board</Link>
        <Link to="/final">Final display</Link>
        {status && <span className="admin-page-state" aria-label={`Game status ${status}`}>Status: {status}</span>}
      </nav>

      <div id="admin-page-content" className="admin-page-body" tabIndex={-1}>
        {children}
      </div>
    </main>
  );
}
