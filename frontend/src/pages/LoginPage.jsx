import { Link } from 'react-router';
import { useLoginForm } from '../hooks/useLoginForm.js';

/** Accessible login surface; credentials and all network behavior belong to the form/session hooks. */
export function LoginPage({ session }) {
  const {
    email, setEmail, password, setPassword, submit, invalidCredentials, errorMessage, errorRef
  } = useLoginForm(session);
  return (
    <main className="admin-access">
      <a className="skip-link" href="#login-form">Skip to form</a>
      <header>
        <p className="brand">F1 Leadership Race</p>
        <h1>Super Admin Login</h1>
        <p>Use committee account to access event administration.</p>
      </header>
      {errorMessage && (
        <p className="auth-error" id="login-error" role="alert" tabIndex={-1} ref={errorRef}>
          {errorMessage}
        </p>
      )}
      <form id="login-form" onSubmit={submit} aria-busy={session.isLoading}>
        <label htmlFor="admin-email">Email</label>
        <input id="admin-email" name="email" type="email" autoComplete="username" required
          value={email} onChange={(event) => setEmail(event.target.value)}
          disabled={session.isLoading} aria-invalid={invalidCredentials}
          aria-describedby={errorMessage ? 'login-error' : undefined} />
        <label htmlFor="admin-password">Password</label>
        <input id="admin-password" name="password" type="password" autoComplete="current-password" required
          value={password} onChange={(event) => setPassword(event.target.value)}
          disabled={session.isLoading} aria-invalid={invalidCredentials}
          aria-describedby={errorMessage ? 'login-error' : undefined} />
        <p className="form-hint">Email and password are required.</p>
        <button type="submit" disabled={session.isLoading}>
          {session.isLoading ? 'Logging in…' : 'Log in'}
        </button>
        {session.isLoading && <p role="status">Processing login…</p>}
      </form>
      <Link to="/">Back to Home</Link>
    </main>
  );
}
