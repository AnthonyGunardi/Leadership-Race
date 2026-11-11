import { Navigate, Route, Routes, useLocation } from 'react-router';
import { useAdminSession } from '../hooks/useAdminSession.js';
import { LoginPage } from '../pages/LoginPage.jsx';
import { AdminSessionPage } from '../pages/AdminSessionPage.jsx';
import { GameControlPage } from '../pages/GameControlPage.jsx';
import { GameHistoryPage } from '../pages/GameHistoryPage.jsx';
import { NotFoundPage } from '../pages/NotFoundPage.jsx';
import '../pages/adminAccess.css';

/** Keeps protected content hidden until cookie initialization has finished. Server authorization remains required. */
export function AdminAccess() {
  const session = useAdminSession();
  const location = useLocation();

  if (session.status === 'INITIALIZING') {
    return <main className="admin-access"><p role="status">Checking session…</p></main>;
  }
  if (location.pathname === '/login') {
    return session.isAuthenticated
      ? <Navigate to="/admin/games" replace />
      : <LoginPage session={session} />;
  }
  if (!session.isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return (
    <Routes>
      <Route path="games" element={<AdminSessionPage session={session} />} />
      <Route path="games/:id/setup" element={<Navigate to="/admin/games" replace />} />
      <Route path="games/:id/displays" element={<Navigate to="/admin/games" replace />} />
      <Route path="games/:id/duplicate" element={<Navigate to="/admin/games" replace />} />
      <Route path="games/:id/control" element={<GameControlPage key={`${session.user.id}:${location.pathname}`}
        session={session} />} />
      <Route path="games/:id/scoreboard" element={<Navigate to="/admin/games" replace />} />
      <Route path="games/:id/history" element={<GameHistoryPage session={session} />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
