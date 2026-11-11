import { useEffect, useRef, useState } from 'react';

/** Keeps credentials ephemeral and focuses authentication failures without retrying an uncertain request. */
export function useLoginForm(session) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const errorRef = useRef(null);
  const invalidCredentials = session.error?.code === 'UNAUTHENTICATED';
  const errorMessage = invalidCredentials
    ? 'Invalid email or password, or session has expired. Please log in again.'
    : session.error?.message;

  useEffect(() => {
    if (errorMessage) {
      errorRef.current?.focus();
    }
  }, [errorMessage]);

  /** The session hook records failures; the form only clears the submitted password. */
  async function submit(event) {
    event.preventDefault();
    if (session.isLoading) {
      return;
    }
    try {
      await session.login({ email, password });
    } catch {
      // Authentication failure is rendered from the session hook's error state.
    } finally {
      setPassword('');
    }
  }

  return { email, setEmail, password, setPassword, submit, invalidCredentials, errorMessage, errorRef };
}
