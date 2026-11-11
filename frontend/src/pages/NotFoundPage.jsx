import { Link } from 'react-router';

/**
 * 404 Not Found fallback page for unknown routes.
 *
 * @returns {import('react').ReactElement}
 */
export function NotFoundPage() {
  return (
    <main className="app-home not-found-page">
      <h1>404 — Page Not Found</h1>
      <p>The page you are looking for does not exist.</p>
      <Link to="/">
        Back to Home
      </Link>
    </main>
  );
}
