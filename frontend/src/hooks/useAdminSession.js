import { useEffect, useCallback } from 'react';
import { create } from 'zustand';
import {
  login as apiLogin,
  logout as apiLogout,
  refreshSession as apiRefreshSession,
  subscribeAuthEvents,
  fetchAdminMe
} from '../services/adminAuth.js';

let sessionOperation = 0;

/**
 * Zustand in-memory store for Super Admin session.
 *
 * Why:
 * - Ensures access token remains exclusively in client memory (no Web Storage).
 * - Shares reactive auth state seamlessly across all React components in the tab.
 * - Prevents prop drilling and guarantees synchronized auth status.
 */
export const useAdminSessionStore = create((set, _get) => ({
  user: null,
  accessToken: null,
  accessExpiresAt: null,
  status: 'INITIALIZING', // 'INITIALIZING' | 'AUTHENTICATED' | 'UNAUTHENTICATED' | 'DISCONNECTED'
  isLoading: true,
  error: null,

  setSession: ({ user, accessToken, accessExpiresAt }) => {
    sessionOperation++;
    set({
      user,
      accessToken,
      accessExpiresAt,
      status: 'AUTHENTICATED',
      isLoading: false,
      error: null
    });
  },

  clearSession: (error = null, status = 'UNAUTHENTICATED') => {
    sessionOperation++;
    set({
      user: null,
      accessToken: null,
      accessExpiresAt: null,
      status,
      isLoading: false,
      error
    });
  },

  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  setStatus: (status) => set({ status })
}));

/**
 * Resets the in-memory session store back to its initial state.
 * Primary utility for testing and deterministic test resets.
 */
export function resetAdminSessionStore() {
  sessionOperation++;
  useAdminSessionStore.setState({
    user: null,
    accessToken: null,
    accessExpiresAt: null,
    status: 'INITIALIZING',
    isLoading: true,
    error: null
  });
}

/**
 * React hook for consuming and controlling Super Admin identity and session lifecycle.
 *
 * Why:
 * - Encapsulates login, single-flight refresh, logout, and cross-tab event synchronization.
 * - Provides loading, invalid, unauthenticated, and disconnected states without placeholder endpoints.
 * - Enforces zero-credential retry on account revocation or session expiry per ADR-002.
 *
 * @param {object} [options={}] Hook configuration
 * @param {boolean} [options.autoInit=true] Whether to automatically probe refresh cookie on mount
 * @returns {{
 *   user: { id: string, email: string, role: string } | null,
 *   accessToken: string | null,
 *   accessExpiresAt: string | null,
 *   status: 'INITIALIZING' | 'AUTHENTICATED' | 'UNAUTHENTICATED' | 'DISCONNECTED',
 *   isLoading: boolean,
 *   error: { code: string, message: string } | null,
 *   isAuthenticated: boolean,
 *   login: (credentials: { email: string, password: string }) => Promise<any>,
 *   logout: () => Promise<void>,
 *   refresh: () => Promise<any>,
 *   clearError: () => void
 * }}
 */
export function useAdminSession(options = {}) {
  const { autoInit = true } = options;

  const user = useAdminSessionStore((state) => state.user);
  const accessToken = useAdminSessionStore((state) => state.accessToken);
  const accessExpiresAt = useAdminSessionStore((state) => state.accessExpiresAt);
  const status = useAdminSessionStore((state) => state.status);
  const isLoading = useAdminSessionStore((state) => state.isLoading);
  const error = useAdminSessionStore((state) => state.error);

  const setSession = useAdminSessionStore((state) => state.setSession);
  const clearSession = useAdminSessionStore((state) => state.clearSession);
  const setLoading = useAdminSessionStore((state) => state.setLoading);
  const setError = useAdminSessionStore((state) => state.setError);

  const refresh = useCallback(async ({ silent = false } = {}) => {
    const operation = ++sessionOperation;
    if (!silent) {
      setLoading(true);
    }
    try {
      const data = await apiRefreshSession();
      if (operation !== sessionOperation) {
        return;
      }
      setSession({
        user: data.user,
        accessToken: data.accessToken,
        accessExpiresAt: data.accessExpiresAt
      });
      return data;
    } catch (err) {
      if (operation !== sessionOperation) {
        throw err;
      }
      if (silent && err?.code === 'DISCONNECTED' && accessExpiresAt && new Date(accessExpiresAt).getTime() > Date.now()) {
        throw err;
      }
      if (err?.code === 'DISCONNECTED') {
        clearSession(
          { code: 'DISCONNECTED', message: err.message || 'Unable to connect to backend server' },
          'DISCONNECTED'
        );
      } else {
        clearSession(
          err?.status === 401 && !silent
            ? null
            : { code: err?.code || 'UNAUTHENTICATED', message: err?.message || 'Session has expired' },
          'UNAUTHENTICATED'
        );
      }
      throw err;
    }
  }, [accessExpiresAt, clearSession, setLoading, setSession]);

  const login = useCallback(async ({ email, password }) => {
    const operation = ++sessionOperation;
    setLoading(true);
    setError(null);
    try {
      const data = await apiLogin({ email, password });
      if (operation !== sessionOperation) {
        return;
      }
      setSession({
        user: data.user,
        accessToken: data.accessToken,
        accessExpiresAt: data.accessExpiresAt
      });
      return data;
    } catch (err) {
      if (operation !== sessionOperation) {
        throw err;
      }
      if (err?.code === 'DISCONNECTED') {
        clearSession(
          { code: 'DISCONNECTED', message: err.message || 'Unable to connect to backend server' },
          'DISCONNECTED'
        );
      } else {
        clearSession(
          { code: err?.code || 'LOGIN_FAILED', message: err?.message || 'Login failed' },
          'UNAUTHENTICATED'
        );
      }
      throw err;
    }
  }, [clearSession, setError, setLoading, setSession]);

  const logout = useCallback(async () => {
    clearSession(null, 'UNAUTHENTICATED');
    const operation = sessionOperation;
    setLoading(true);
    try {
      await apiLogout({ accessToken });
    } finally {
      if (operation === sessionOperation) {
        setLoading(false);
      }
    }
  }, [accessToken, clearSession, setLoading]);

  const clearError = useCallback(() => {
    setError(null);
  }, [setError]);

  // Proactive silent auto-refresh: rotates refresh token before access token expires
  useEffect(() => {
    if (status !== 'AUTHENTICATED' || !accessExpiresAt) {
      return;
    }

    let active = true;
    const remainingMs = new Date(accessExpiresAt).getTime() - Date.now();
    // Schedule refresh 1 minute before expiry, or halfway if remaining time is short
    const leadTimeMs = Math.min(60 * 1000, Math.max(0, Math.floor(remainingMs / 2)));
    const delay = Math.max(0, remainingMs - leadTimeMs);

    const timer = setTimeout(async () => {
      if (!active) {
        return;
      }
      try {
        await refresh({ silent: true });
      } catch (err) {
        if (!active) {
          return;
        }
        // If refresh fails: if token has expired or server explicitly rejected refresh (401), end session
        if (err?.status === 401 || new Date(accessExpiresAt).getTime() <= Date.now()) {
          clearSession({ code: 'UNAUTHENTICATED', message: 'Session has expired, please log in again' });
        }
      }
    }, delay);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [accessExpiresAt, clearSession, refresh, status]);

  // Read-only liveness checks detect revoked/disabled accounts without rotating credentials.
  useEffect(() => {
    if (status !== 'AUTHENTICATED' || !accessToken) {
      return;
    }
    let active = true;
    let checking = false;
    const controller = new globalThis.AbortController();

    /** A failed lookup ends local access; a late response must not invalidate a newer session. */
    async function checkSession() {
      if (checking || document.visibilityState === 'hidden' || useAdminSessionStore.getState().isLoading) {
        return;
      }
      checking = true;
      const operation = sessionOperation;
      try {
        await fetchAdminMe({ accessToken, signal: controller.signal });
      } catch (err) {
        if (active && operation === sessionOperation) {
          clearSession(
            { code: err.code, message: 'Session could not be verified. Please log in again.' },
            err.code === 'DISCONNECTED' || err.status >= 500 ? 'DISCONNECTED' : 'UNAUTHENTICATED'
          );
        }
      } finally {
        checking = false;
      }
    }

    const interval = setInterval(checkSession, 30000);
    window.addEventListener('focus', checkSession);
    document.addEventListener('visibilitychange', checkSession);
    return () => {
      active = false;
      controller.abort();
      clearInterval(interval);
      window.removeEventListener('focus', checkSession);
      document.removeEventListener('visibilitychange', checkSession);
    };
  }, [accessToken, clearSession, status]);

  // Cross-tab synchronization via BroadcastChannel
  useEffect(() => {
    const unsubscribe = subscribeAuthEvents((event) => {
      if (event?.type === 'SESSION_LOGGED_OUT') {
        clearSession(null, 'UNAUTHENTICATED');
      } else if (event?.type === 'SESSION_EXPIRED') {
        clearSession(
          { code: 'UNAUTHENTICATED', message: 'Session has expired, please log in again' },
          'UNAUTHENTICATED'
        );
      } else if (event?.type === 'SESSION_REFRESHED') {
        // Peer refresh may help initialization, but must never restart an ended session.
        const current = useAdminSessionStore.getState();
        if (!current.accessToken && current.status === 'INITIALIZING') {
          refresh().catch(() => {});
        }
      }
    });

    return () => {
      unsubscribe();
    };
  }, [clearSession, refresh]);

  // Initial session check on mount
  useEffect(() => {
    if (autoInit && status === 'INITIALIZING') {
      refresh().catch(() => {
        // Silently handled: clearSession updates status to UNAUTHENTICATED or DISCONNECTED
      });
    }
  }, [autoInit, refresh, status]);

  return {
    user,
    accessToken,
    accessExpiresAt,
    status,
    isLoading,
    error,
    isAuthenticated: status === 'AUTHENTICATED' && Boolean(accessToken),
    login,
    logout,
    refresh,
    clearError
  };
}

