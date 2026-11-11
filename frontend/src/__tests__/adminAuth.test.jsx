import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  login,
  refreshSession,
  logout,
  fetchAdminMe,
  broadcastAuthEvent,
  subscribeAuthEvents,
  getBroadcastChannel
} from '../services/adminAuth.js';
import {
  useAdminSession,
  useAdminSessionStore,
  resetAdminSessionStore
} from '../hooks/useAdminSession.js';

describe('Admin Authentication Client Service and Session Hook (LR-025)', () => {
  const originalFetch = globalThis.fetch;
  const originalLocks = globalThis.navigator?.locks;
  let broadcastListeners = [];

  class MockBroadcastChannel {
    constructor(name) {
      this.name = name;
      this.listeners = [];
      broadcastListeners.push(this);
    }

    addEventListener(event, callback) {
      if (event === 'message') {
        this.listeners.push(callback);
      }
    }

    removeEventListener(event, callback) {
      this.listeners = this.listeners.filter((cb) => cb !== callback);
    }

    postMessage(data) {
      for (const ch of broadcastListeners) {
        if (ch !== this && ch.name === this.name) {
          for (const cb of ch.listeners) {
            cb({ data });
          }
        }
      }
    }

    close() {
      this.listeners = [];
    }
  }

  beforeEach(() => {
    broadcastListeners = [];
    globalThis.BroadcastChannel = MockBroadcastChannel;
    resetAdminSessionStore();
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalLocks) {
      Object.defineProperty(globalThis.navigator, 'locks', {
        value: originalLocks,
        configurable: true
      });
    }
    vi.restoreAllMocks();
  });

  describe('adminAuth Service', () => {
    it('does not deliver a tab\'s own broadcast back to its session subscriber', () => {
      const listener = vi.fn();
      const unsubscribe = subscribeAuthEvents(listener);
      broadcastAuthEvent({ type: 'SESSION_EXPIRED' });
      expect(listener).not.toHaveBeenCalled();
      const peer = new MockBroadcastChannel('lr_admin_auth');
      peer.postMessage({ type: 'SESSION_LOGGED_OUT' });
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'SESSION_LOGGED_OUT' }));
      unsubscribe();
    });

    it('login sends credentials and returns access token and user', async () => {
      const mockResponse = {
        success: true,
        data: {
          accessToken: 'access-opaque-token-123',
          accessExpiresAt: '2026-11-10T13:00:00.000Z',
          user: { id: 'u-123', email: 'admin@example.com', role: 'SUPER_ADMIN' }
        }
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse
      });

      const result = await login({ email: 'admin@example.com', password: 'ValidPassword123!' });

      expect(globalThis.fetch).toHaveBeenCalledWith('/api/v1/auth/login', expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ email: 'admin@example.com', password: 'ValidPassword123!' })
      }));
      expect(result).toEqual(mockResponse.data);

      // Verify zero credentials in Web Storage
      expect(localStorage.getItem('token')).toBeNull();
      expect(sessionStorage.getItem('token')).toBeNull();
    });

    it('login maps 401 failure to UNAUTHENTICATED error', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          success: false,
          error: { code: 'UNAUTHENTICATED', message: 'Email atau password salah' }
        })
      });

      await expect(login({ email: 'admin@example.com', password: 'wrong' }))
        .rejects.toMatchObject({
          code: 'UNAUTHENTICATED',
          status: 401,
          message: 'Email atau password salah'
        });
    });

    it('login maps 400 validation failure and handles AbortError', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid format' }
        })
      });

      await expect(login({ email: 'bad', password: '123' }))
        .rejects.toMatchObject({
          code: 'VALIDATION_ERROR',
          status: 400
        });

      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      globalThis.fetch = vi.fn().mockRejectedValue(abortError);

      await expect(login({ email: 'a@b.com', password: '123' }))
        .rejects.toThrow('Aborted');
    });

    it('login maps network failure to DISCONNECTED code', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

      await expect(login({ email: 'admin@example.com', password: 'pass' }))
        .rejects.toMatchObject({
          code: 'DISCONNECTED',
          status: 0
        });
    });

    it('refreshSession performs single-flight deduplication in same tab', async () => {
      let resolveFetch;
      const fetchPromise = new Promise((resolve) => {
        resolveFetch = resolve;
      });

      globalThis.fetch = vi.fn().mockImplementation(() => fetchPromise);

      // Trigger two concurrent refresh calls in parallel
      const call1 = refreshSession();
      const call2 = refreshSession();

      resolveFetch({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            accessToken: 'refreshed-token-xyz',
            accessExpiresAt: '2026-11-10T13:15:00.000Z',
            user: { id: 'u-1', email: 'admin@test.com', role: 'SUPER_ADMIN' }
          }
        })
      });

      const [res1, res2] = await Promise.all([call1, call2]);

      expect(res1).toEqual(res2);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it('refreshSession coordinates across tabs using navigator.locks if available', async () => {
      const mockLockRequest = vi.fn().mockImplementation(async (_lockName, cb) => cb());
      Object.defineProperty(globalThis.navigator, 'locks', {
        value: { request: mockLockRequest },
        configurable: true
      });

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { accessToken: 'locked-tok', accessExpiresAt: '2026-11-10T13:00:00.000Z', user: {} }
        })
      });

      await refreshSession();

      expect(mockLockRequest).toHaveBeenCalledWith('lr_admin_refresh_lock', expect.any(Function));
    });

    it('refreshSession broadcasts SESSION_REFRESHED on success', async () => {
      const messages = [];
      const sub = new MockBroadcastChannel('lr_admin_auth');
      sub.addEventListener('message', (e) => messages.push(e.data));

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { accessToken: 'new-tok', accessExpiresAt: '2026-11-10T13:00:00.000Z', user: {} }
        })
      });

      await refreshSession();

      expect(messages.some((m) => m.type === 'SESSION_REFRESHED')).toBe(true);
      // Ensure no tokens leaked in broadcast payload
      expect(JSON.stringify(messages)).not.toContain('new-tok');
    });

    it('refreshSession broadcasts SESSION_EXPIRED on 401 unauthenticated', async () => {
      const messages = [];
      const sub = new MockBroadcastChannel('lr_admin_auth');
      sub.addEventListener('message', (e) => messages.push(e.data));

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          success: false,
          error: { code: 'UNAUTHENTICATED', message: 'Sesi kedaluwarsa' }
        })
      });

      await expect(refreshSession()).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
        status: 401
      });

      expect(messages.some((m) => m.type === 'SESSION_EXPIRED')).toBe(true);
    });

    it('refreshSession handles unknown refresh response by broadcasting SESSION_EXPIRED to force re-login', async () => {
      const messages = [];
      const sub = new MockBroadcastChannel('lr_admin_auth');
      sub.addEventListener('message', (e) => messages.push(e.data));

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => ({
          success: false,
          error: { code: 'BAD_GATEWAY', message: 'Bad Gateway' }
        })
      });

      await expect(refreshSession()).rejects.toMatchObject({
        code: 'BAD_GATEWAY',
        status: 502
      });

      expect(messages.some((m) => m.type === 'SESSION_EXPIRED')).toBe(true);
    });

    it('refreshSession handles AbortError and works without navigator.locks', async () => {
      // Test without navigator.locks
      const originalLocksDesc = Object.getOwnPropertyDescriptor(globalThis.navigator, 'locks');
      Object.defineProperty(globalThis.navigator, 'locks', {
        value: undefined,
        configurable: true
      });

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { accessToken: 'no-locks-tok', accessExpiresAt: '2026-11-10T13:00:00.000Z', user: {} }
        })
      });

      const res = await refreshSession();
      expect(res.accessToken).toBe('no-locks-tok');

      // Test AbortError
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      globalThis.fetch = vi.fn().mockRejectedValue(abortError);

      await expect(refreshSession()).rejects.toThrow('Aborted');

      if (originalLocksDesc) {
        Object.defineProperty(globalThis.navigator, 'locks', originalLocksDesc);
      }
    });

    it('logout broadcasts SESSION_LOGGED_OUT and returns loggedOut: true', async () => {
      const messages = [];
      const sub = new MockBroadcastChannel('lr_admin_auth');
      sub.addEventListener('message', (e) => messages.push(e.data));

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { loggedOut: true } })
      });

      const res = await logout({ accessToken: 'access-tok-123' });

      expect(res).toEqual({ loggedOut: true });
      expect(messages.some((m) => m.type === 'SESSION_LOGGED_OUT')).toBe(true);
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/v1/auth/logout', expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer access-tok-123' })
      }));

      // Test AbortError during logout
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      globalThis.fetch = vi.fn().mockRejectedValue(abortError);

      await expect(logout()).rejects.toThrow('Aborted');
    });

    it('fetchAdminMe succeeds on 200 and handles non-401, network, and AbortError', async () => {
      const mockData = {
        user: { id: 'u-1', email: 'admin@f1.test', role: 'SUPER_ADMIN' },
        session: { id: 'sess-1', expiresAt: '2026-11-10T15:00:00.000Z' }
      };

      // 200 success
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: mockData })
      });

      const result = await fetchAdminMe({ accessToken: 'valid-token-abc' });
      expect(result).toEqual(mockData);

      // 500 error
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal error' } })
      });
      await expect(fetchAdminMe({ accessToken: 'valid-token-abc' }))
        .rejects.toMatchObject({ code: 'SERVER_ERROR', status: 500 });

      // Network failure
      globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
      await expect(fetchAdminMe({ accessToken: 'valid-token-abc' }))
        .rejects.toMatchObject({ code: 'DISCONNECTED', status: 0 });

      // AbortError
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      globalThis.fetch = vi.fn().mockRejectedValue(abortError);
      await expect(fetchAdminMe({ accessToken: 'valid-token-abc' }))
        .rejects.toThrow('Aborted');
    });

    it('broadcastAuthEvent handles falsy payloads and exceptions gracefully', () => {
      expect(() => broadcastAuthEvent(null)).not.toThrow();
      expect(() => broadcastAuthEvent(undefined)).not.toThrow();

      const origChannel = globalThis.BroadcastChannel;
      globalThis.BroadcastChannel = class BrokenChannel {
        postMessage() {
          throw new Error('Transport broken');
        }
        close() {}
      };

      expect(() => broadcastAuthEvent({ type: 'SESSION_REFRESHED' })).not.toThrow();
      globalThis.BroadcastChannel = origChannel;
    });

    it('subscribeAuthEvents allows unsubscribing cleanly', () => {
      const listener = vi.fn();
      const unsubscribe = subscribeAuthEvents(listener);

      const channel = new MockBroadcastChannel('lr_admin_auth');
      channel.postMessage({ type: 'SESSION_LOGGED_OUT' });
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'SESSION_LOGGED_OUT' }));

      listener.mockClear();
      unsubscribe();
      channel.postMessage({ type: 'SESSION_LOGGED_OUT' });
      expect(listener).not.toHaveBeenCalled();
    });

    it('logout is idempotent even on network error or server error response', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

      const res1 = await logout();
      expect(res1).toEqual({ loggedOut: true });

      // Non-ok response without body
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => { throw new Error('Invalid JSON'); }
      });

      const res2 = await logout();
      expect(res2).toEqual({ loggedOut: true });
    });

    it('fetchAdminMe fetches current user and handles 401 with SESSION_EXPIRED', async () => {
      const messages = [];
      const sub = new MockBroadcastChannel('lr_admin_auth');
      sub.addEventListener('message', (e) => messages.push(e.data));

      await expect(fetchAdminMe({})).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ success: false, error: { code: 'UNAUTHENTICATED' } })
      });

      await expect(fetchAdminMe({ accessToken: 'invalid-tok' })).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
        status: 401
      });

      expect(messages.some((m) => m.type === 'SESSION_EXPIRED')).toBe(true);
    });

    it('broadcastAuthEvent strips credentials if passed', () => {
      const messages = [];
      const sub = new MockBroadcastChannel('lr_admin_auth');
      sub.addEventListener('message', (e) => messages.push(e.data));

      broadcastAuthEvent({
        type: 'SESSION_REFRESHED',
        accessToken: 'sensitive-token',
        password: 'secret-password'
      });

      expect(messages[0].type).toBe('SESSION_REFRESHED');
      expect(messages[0].accessToken).toBeUndefined();
      expect(messages[0].password).toBeUndefined();
    });

    it('handles environments where BroadcastChannel is not supported', () => {
      delete globalThis.BroadcastChannel;
      expect(getBroadcastChannel()).toBeNull();
      expect(() => broadcastAuthEvent({ type: 'SESSION_LOGGED_OUT' })).not.toThrow();
      expect(subscribeAuthEvents(() => {})).toBeTypeOf('function');
    });
  });

  describe('useAdminSession Hook', () => {
    it('does not retry refresh after terminal logout when a peer reports a late refresh (LR-027)', async () => {
      const { result } = renderHook(() => useAdminSession({ autoInit: false }));
      const peer = new MockBroadcastChannel('lr_admin_auth');
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
      await act(async () => {
        peer.postMessage({ type: 'SESSION_LOGGED_OUT' });
        peer.postMessage({ type: 'SESSION_REFRESHED' });
        await Promise.resolve();
      });
      expect(result.current.isAuthenticated).toBe(false);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('clears access immediately while logout is still pending (LR-027)', async () => {
      useAdminSessionStore.getState().setSession({ user: { id: 'u-logout' }, accessToken: 'logout-access',
        accessExpiresAt: new Date(Date.now() + 900000).toISOString() });
      const { result } = renderHook(() => useAdminSession({ autoInit: false }));
      let finish;
      globalThis.fetch = vi.fn().mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
      let pending;
      act(() => { pending = result.current.logout(); });
      try {
        expect(result.current.isAuthenticated).toBe(false);
        expect(result.current.accessToken).toBeNull();
        expect(result.current.isLoading).toBe(true);
      } finally {
        await act(async () => { finish({ ok: true, json: async () => ({ data: { loggedOut: true } }) });
          await pending; });
      }
    });

    it('rechecks active access and clears the local session on server revocation (LR-027)', async () => {
      vi.useFakeTimers();
      try {
        useAdminSessionStore.getState().setSession({
          user: { id: 'u-watch', role: 'SUPER_ADMIN' }, accessToken: 'watch-access',
          accessExpiresAt: new Date(Date.now() + 900000).toISOString()
        });
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401,
          json: async () => ({ error: { code: 'UNAUTHENTICATED' } }) });
        const { result, unmount } = renderHook(() => useAdminSession({ autoInit: false }));
        await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
        expect(globalThis.fetch).toHaveBeenCalledWith('/api/v1/auth/me', expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer watch-access' })
        }));
        expect(result.current.isAuthenticated).toBe(false);
        expect(result.current.accessToken).toBeNull();
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        unmount();
      } finally {
        vi.useRealTimers();
      }
    });

    it('ends authentication at access expiry without refreshing or extending it (LR-027)', async () => {
      vi.useFakeTimers();
      try {
        useAdminSessionStore.getState().setSession({
          user: { id: 'u-expiry', role: 'SUPER_ADMIN' }, accessToken: 'expires-soon',
          accessExpiresAt: new Date(Date.now() + 1000).toISOString()
        });
        globalThis.fetch = vi.fn();
        const { result, unmount } = renderHook(() => useAdminSession({ autoInit: false }));
        await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
        expect(result.current.isAuthenticated).toBe(false);
        expect(result.current.accessToken).toBeNull();
        expect(result.current.error.code).toBe('UNAUTHENTICATED');
        expect(globalThis.fetch).not.toHaveBeenCalled();
        unmount();
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not resurrect a session when refresh finishes after a logout notification (LR-027)', async () => {
      const { result } = renderHook(() => useAdminSession({ autoInit: false }));
      let finish;
      globalThis.fetch = vi.fn().mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
      let pending;
      act(() => { pending = result.current.refresh(); });
      const peer = new MockBroadcastChannel('lr_admin_auth');
      act(() => { peer.postMessage({ type: 'SESSION_LOGGED_OUT' }); });
      await act(async () => {
        finish({ ok: true, json: async () => ({ data: {
          accessToken: 'late-access', accessExpiresAt: new Date(Date.now() + 900000).toISOString(),
          user: { id: 'late-user', role: 'SUPER_ADMIN' }
        } }) });
        await pending;
      });
      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.accessToken).toBeNull();
    });

    it('initializes on mount with autoInit and sets UNAUTHENTICATED when refresh returns 401', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          success: false,
          error: { code: 'UNAUTHENTICATED' }
        })
      });

      const { result } = renderHook(() => useAdminSession({ autoInit: true }));

      // Wait for mount effect to complete
      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.status).toBe('UNAUTHENTICATED');
      expect(result.current.isLoading).toBe(false);
      expect(result.current.user).toBeNull();
      expect(result.current.accessToken).toBeNull();
      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.error).toBeNull(); // Clean unauthenticated state on initial load
    });

    it('initializes on mount and rehydrates authenticated session when refresh cookie is valid', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            accessToken: 'init-access-token',
            accessExpiresAt: new Date(Date.now() + 900000).toISOString(),
            user: { id: 'u-admin-1', email: 'admin@f1race.test', role: 'SUPER_ADMIN' }
          }
        })
      });

      const { result } = renderHook(() => useAdminSession({ autoInit: true }));

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.status).toBe('AUTHENTICATED');
      expect(result.current.isLoading).toBe(false);
      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.user).toEqual({
        id: 'u-admin-1',
        email: 'admin@f1race.test',
        role: 'SUPER_ADMIN'
      });
      expect(result.current.accessToken).toBe('init-access-token');

      // Verify memory-only storage
      expect(localStorage.length).toBe(0);
      expect(sessionStorage.length).toBe(0);
    });

    it('sets DISCONNECTED status when server is unreachable on init', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Network offline'));

      const { result } = renderHook(() => useAdminSession({ autoInit: true }));

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.status).toBe('DISCONNECTED');
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toMatchObject({ code: 'DISCONNECTED' });
    });

    it('login updates session state reactively and clearError clears errors', async () => {
      const { result } = renderHook(() => useAdminSession({ autoInit: false }));

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            accessToken: 'login-token-1',
            accessExpiresAt: new Date(Date.now() + 900000).toISOString(),
            user: { id: 'u-login', email: 'login@test.com', role: 'SUPER_ADMIN' }
          }
        })
      });

      await act(async () => {
        await result.current.login({ email: 'login@test.com', password: 'Password123!' });
      });

      expect(result.current.status).toBe('AUTHENTICATED');
      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.accessToken).toBe('login-token-1');

      // Test error clearing
      act(() => {
        useAdminSessionStore.setState({ error: { code: 'TEST_ERR', message: 'Test' } });
      });
      expect(result.current.error).not.toBeNull();

      act(() => {
        result.current.clearError();
      });
      expect(result.current.error).toBeNull();
    });

    it('logout clears in-memory session and switches to UNAUTHENTICATED', async () => {
      const { result } = renderHook(() => useAdminSession({ autoInit: false }));

      useAdminSessionStore.setState({
        status: 'AUTHENTICATED',
        user: { id: 'u-1', email: 'admin@test.com', role: 'SUPER_ADMIN' },
        accessToken: 'active-tok',
        isLoading: false
      });

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { loggedOut: true } })
      });

      await act(async () => {
        await result.current.logout();
      });

      expect(result.current.status).toBe('UNAUTHENTICATED');
      expect(result.current.user).toBeNull();
      expect(result.current.accessToken).toBeNull();
      expect(result.current.isAuthenticated).toBe(false);
    });

    it('cross-tab event SESSION_LOGGED_OUT clears session', async () => {
      const { result } = renderHook(() => useAdminSession({ autoInit: false }));

      useAdminSessionStore.setState({
        status: 'AUTHENTICATED',
        user: { id: 'u-1', email: 'admin@test.com', role: 'SUPER_ADMIN' },
        accessToken: 'active-tok',
        isLoading: false
      });

      const peerChannel = new MockBroadcastChannel('lr_admin_auth');

      act(() => {
        peerChannel.postMessage({ type: 'SESSION_LOGGED_OUT' });
      });

      expect(result.current.status).toBe('UNAUTHENTICATED');
      expect(result.current.user).toBeNull();
      expect(result.current.accessToken).toBeNull();
    });

    it('cross-tab event SESSION_EXPIRED clears session and sets unauthenticated error', async () => {
      const { result } = renderHook(() => useAdminSession({ autoInit: false }));

      useAdminSessionStore.setState({
        status: 'AUTHENTICATED',
        user: { id: 'u-1', email: 'admin@test.com', role: 'SUPER_ADMIN' },
        accessToken: 'active-tok',
        isLoading: false
      });

      const peerChannel = new MockBroadcastChannel('lr_admin_auth');

      act(() => {
        peerChannel.postMessage({ type: 'SESSION_EXPIRED' });
      });

      expect(result.current.status).toBe('UNAUTHENTICATED');
      expect(result.current.accessToken).toBeNull();
      expect(result.current.error).toMatchObject({
        code: 'UNAUTHENTICATED',
        message: expect.stringContaining('Session has expired')
      });
    });

    it('cross-tab event SESSION_REFRESHED can initialize a tab without an access token', async () => {
      const { result } = renderHook(() => useAdminSession({ autoInit: false }));

      useAdminSessionStore.setState({
        status: 'INITIALIZING',
        user: null,
        accessToken: null,
        isLoading: true
      });

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            accessToken: 'synced-token',
            accessExpiresAt: new Date(Date.now() + 900000).toISOString(),
            user: { id: 'u-peer', email: 'peer@test.com', role: 'SUPER_ADMIN' }
          }
        })
      });

      const peerChannel = new MockBroadcastChannel('lr_admin_auth');

      await act(async () => {
        peerChannel.postMessage({ type: 'SESSION_REFRESHED' });
        await Promise.resolve();
      });

      expect(result.current.status).toBe('AUTHENTICATED');
      expect(result.current.accessToken).toBe('synced-token');
      expect(result.current.user.email).toBe('peer@test.com');
    });

    it('hook login handles DISCONNECTED and invalid credential errors', async () => {
      const { result } = renderHook(() => useAdminSession({ autoInit: false }));

      // Network disconnected failure
      globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Offline'));

      await expect(
        act(async () => {
          await result.current.login({ email: 'admin@test.com', password: '123' });
        })
      ).rejects.toMatchObject({ code: 'DISCONNECTED' });

      expect(result.current.status).toBe('DISCONNECTED');
      expect(result.current.error).toMatchObject({ code: 'DISCONNECTED' });

      // Bad credentials failure
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Wrong pass' } })
      });

      await expect(
        act(async () => {
          await result.current.login({ email: 'admin@test.com', password: 'wrong' });
        })
      ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

      expect(result.current.status).toBe('UNAUTHENTICATED');
      expect(result.current.error).toMatchObject({ code: 'UNAUTHENTICATED' });
    });

    it('hook refresh handles manual call success, DISCONNECTED, and error', async () => {
      const { result } = renderHook(() => useAdminSession({ autoInit: false }));

      // Manual refresh success
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            accessToken: 'manual-tok',
            accessExpiresAt: new Date(Date.now() + 900000).toISOString(),
            user: { id: 'u-1', email: 'man@test.com', role: 'SUPER_ADMIN' }
          }
        })
      });

      await act(async () => {
        await result.current.refresh();
      });

      expect(result.current.status).toBe('AUTHENTICATED');
      expect(result.current.accessToken).toBe('manual-tok');

      // Manual refresh disconnected
      globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

      await expect(
        act(async () => {
          await result.current.refresh();
        })
      ).rejects.toMatchObject({ code: 'DISCONNECTED' });

      expect(result.current.status).toBe('DISCONNECTED');

      // Manual refresh server error (non-401)
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ success: false, error: { code: 'SERVER_ERR', message: 'Fail' } })
      });

      await expect(
        act(async () => {
          await result.current.refresh();
        })
      ).rejects.toMatchObject({ code: 'SERVER_ERR' });

      expect(result.current.status).toBe('UNAUTHENTICATED');
    });

    it('store utility functions mutate state as expected', () => {
      useAdminSessionStore.getState().setStatus('DISCONNECTED');
      expect(useAdminSessionStore.getState().status).toBe('DISCONNECTED');

      useAdminSessionStore.getState().setLoading(false);
      expect(useAdminSessionStore.getState().isLoading).toBe(false);

      useAdminSessionStore.getState().setError({ code: 'CUSTOM', message: 'msg' });
      expect(useAdminSessionStore.getState().error).toEqual({ code: 'CUSTOM', message: 'msg' });
    });
  });
});
