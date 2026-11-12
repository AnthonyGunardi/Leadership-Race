/**
 * Client authentication service for Super Admin identity lifecycle.
 *
 * Why:
 * - Enforces ADR-002: access tokens remain exclusively in-memory, while refresh tokens
 *   are secured via __Host- cookies managed by the browser.
 * - Coordinates single-flight refresh across multiple tabs using the Web Locks API
 *   and BroadcastChannel to prevent refresh token reuse detection collisions.
 * - Zero plaintext secrets or credentials are placed in messages, storage, or query parameters.
 */

import { API_BASE_URL } from '../config/api.js';

let inFlightRefresh = null;
const BROADCAST_CHANNEL_NAME = 'lr_admin_auth';
const REFRESH_LOCK_NAME = 'lr_admin_refresh_lock';
const AUTH_EVENT_SOURCE = globalThis.crypto.randomUUID();

/**
 * Resolves a BroadcastChannel instance if supported in the runtime environment.
 *
 * @returns {BroadcastChannel|null}
 */
export function getBroadcastChannel() {
  const ChannelClass = (typeof window !== 'undefined' && window.BroadcastChannel)
    || (typeof globalThis !== 'undefined' ? globalThis.BroadcastChannel : null);
  if (ChannelClass) {
    try {
      return new ChannelClass(BROADCAST_CHANNEL_NAME);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Parses response JSON safely without unhandled rejection.
 *
 * @param {Response} res
 * @returns {Promise<any|null>}
 */
async function parseJsonSafely(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Dispatches auth lifecycle notifications to other tabs without sensitive credential payloads.
 *
 * Why:
 * - ADR-002 prohibits placing tokens or passwords in cross-tab messages or Web Storage.
 * - Events notify other tabs to invalidate local memory or synchronize session status.
 *
 * @param {object} payload
 * @param {'SESSION_REFRESHED'|'SESSION_LOGGED_OUT'|'SESSION_EXPIRED'} payload.type
 * @param {number} [payload.timestamp]
 */
export function broadcastAuthEvent(payload) {
  if (!payload || typeof payload !== 'object') {
    return;
  }
  // Guarantee zero credentials in broadcast events by destructuring out any sensitive fields
  const { accessToken: _a, refreshToken: _r, password: _p, token: _t, ...safePayload } = payload;
  const channel = getBroadcastChannel();
  if (channel) {
    try {
      channel.postMessage({
        ...safePayload,
        source: AUTH_EVENT_SOURCE,
        timestamp: safePayload.timestamp || Date.now()
      });
      channel.close();
    } catch {
      // Ignore cross-context broadcast transport errors
    }
  }
}

/**
 * Subscribes to cross-tab auth state change events.
 *
 * @param {(event: { type: string, timestamp: number }) => void} callback
 * @returns {() => void} Unsubscribe cleanup function
 */
export function subscribeAuthEvents(callback) {
  const channel = getBroadcastChannel();
  if (!channel) {
    return () => {};
  }

  const handler = (event) => {
    if (event?.data && event.data.source !== AUTH_EVENT_SOURCE
      && typeof event.data === 'object' && typeof callback === 'function') {
      callback(event.data);
    }
  };

  channel.addEventListener('message', handler);

  return () => {
    try {
      channel.removeEventListener('message', handler);
      channel.close();
    } catch {
      // Safe cleanup
    }
  };
}

/**
 * Authenticates admin credentials via HTTP POST /api/v1/auth/login.
 *
 * Why:
 * - Direct authentication transport outside UI components per Rule 30.
 * - Server sets HttpOnly __Host-lr_admin_refresh cookie and returns in-memory access token.
 *
 * @param {object} params
 * @param {string} params.email
 * @param {string} params.password
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<{
 *   accessToken: string,
 *   accessExpiresAt: string,
 *   user: { id: string, email: string, role: string }
 * }>}
 */
export async function login({ email, password, signal } = {}) {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
      signal
    });

    const body = await parseJsonSafely(res);

    if (res.ok && body?.data) {
      return body.data;
    }

    const err = new Error(body?.error?.message || `HTTP ${res.status}: Login failed`);
    err.code = body?.error?.code || (res.status === 401 ? 'UNAUTHENTICATED' : 'LOGIN_FAILED');
    err.status = res.status;
    throw err;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw err;
    }
    if (!err.code) {
      err.code = 'DISCONNECTED';
      err.status = 0;
      err.message = 'Unable to connect to backend server';
    }
    throw err;
  }
}

/**
 * Internal single-flight refresh execution against /api/v1/auth/refresh.
 *
 * @param {AbortSignal} [signal]
 * @returns {Promise<{
 *   accessToken: string,
 *   accessExpiresAt: string,
 *   user: { id: string, email: string, role: string }
 * }>}
 */
async function performRefreshRequest(signal) {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      credentials: 'include',
      signal
    });

    const body = await parseJsonSafely(res);

    if (res.ok && body?.data) {
      broadcastAuthEvent({ type: 'SESSION_REFRESHED', timestamp: Date.now() });
      return body.data;
    }

    if (res.status === 401) {
      broadcastAuthEvent({ type: 'SESSION_EXPIRED', timestamp: Date.now() });
      const err = new Error(body?.error?.message || 'Session has expired');
      err.code = body?.error?.code || 'UNAUTHENTICATED';
      err.status = 401;
      throw err;
    }

    // Any other response (e.g. 500, 502) is an unknown refresh outcome requiring re-login
    broadcastAuthEvent({ type: 'SESSION_EXPIRED', timestamp: Date.now() });
    const err = new Error(body?.error?.message || `HTTP ${res.status}: Failed to refresh session`);
    err.code = body?.error?.code || 'REFRESH_FAILED';
    err.status = res.status;
    throw err;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw err;
    }
    if (!err.code) {
      broadcastAuthEvent({ type: 'SESSION_EXPIRED', timestamp: Date.now() });
      err.code = 'DISCONNECTED';
      err.status = 0;
      err.message = 'Unable to connect to backend server';
    }
    throw err;
  }
}

/**
 * Rotates admin refresh token and obtains a fresh access token.
 *
 * Why:
 * - Single-flight deduplication prevents concurrent refresh races in the same tab.
 * - Coordinates across tabs via Web Locks API so simultaneous expirations do not trigger
 *   refresh token reuse detection on the server.
 * - Handles unknown refresh outcomes fail-closed by terminating local session per ADR-002.
 *
 * @param {object} [options={}]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{
 *   accessToken: string,
 *   accessExpiresAt: string,
 *   user: { id: string, email: string, role: string }
 * }>}
 */
export async function refreshSession({ signal } = {}) {
  if (inFlightRefresh) {
    return inFlightRefresh;
  }

  const runWithLock = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function') {
        return await navigator.locks.request(REFRESH_LOCK_NAME, async () => {
          return await performRefreshRequest(signal);
        });
      }
      return await performRefreshRequest(signal);
    } finally {
      inFlightRefresh = null;
    }
  };

  inFlightRefresh = runWithLock();
  return inFlightRefresh;
}

/**
 * Idempotently logs out the current session and clears server-side refresh cookies.
 *
 * Why:
 * - Informs backend to revoke session family in database and purge __Host- cookie.
 * - Broadcasts SESSION_LOGGED_OUT to ensure all open tabs purge memory tokens immediately.
 *
 * @param {object} [options={}]
 * @param {string} [options.accessToken]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ loggedOut: boolean }>}
 */
export async function logout({ accessToken, signal } = {}) {
  try {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    };
    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }

    const res = await fetch(`${API_BASE_URL}/api/v1/auth/logout`, {
      method: 'POST',
      headers,
      credentials: 'include',
      signal
    });

    const body = await parseJsonSafely(res);
    broadcastAuthEvent({ type: 'SESSION_LOGGED_OUT', timestamp: Date.now() });

    if (res.ok && body?.data) {
      return body.data;
    }
    return { loggedOut: true };
  } catch (err) {
    broadcastAuthEvent({ type: 'SESSION_LOGGED_OUT', timestamp: Date.now() });
    if (err.name === 'AbortError') {
      throw err;
    }
    return { loggedOut: true };
  }
}

/**
 * Fetches authenticated admin identity and active session details.
 *
 * @param {object} params
 * @param {string} params.accessToken
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<{
 *   user: { id: string, email: string, role: string },
 *   session: { id: string, expiresAt: string }
 * }>}
 */
export async function fetchAdminMe({ accessToken, signal } = {}) {
  if (!accessToken) {
    const err = new Error('Access token is required');
    err.code = 'UNAUTHENTICATED';
    err.status = 401;
    throw err;
  }

  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/auth/me`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json'
      },
      credentials: 'include',
      signal
    });

    const body = await parseJsonSafely(res);

    if (res.ok && body?.data) {
      return body.data;
    }

    if (res.status === 401) {
      broadcastAuthEvent({ type: 'SESSION_EXPIRED', timestamp: Date.now() });
      const err = new Error(body?.error?.message || 'Session has expired');
      err.code = 'UNAUTHENTICATED';
      err.status = 401;
      throw err;
    }

    const err = new Error(body?.error?.message || `HTTP ${res.status}: Failed to load admin data`);
    err.code = body?.error?.code || 'FETCH_FAILED';
    err.status = res.status;
    throw err;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw err;
    }
    if (!err.code) {
      err.code = 'DISCONNECTED';
      err.status = 0;
      err.message = 'Unable to connect to backend server';
    }
    throw err;
  }
}
