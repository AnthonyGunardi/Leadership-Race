import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAdminSessionStore, useAdminSession, useAdminSessionStore } from '../hooks/useAdminSession.js';

/** Synthetic identity with a relative deadline keeps lifecycle tests independent of the wall clock. */
function identity(accessToken = 'lifecycle-memory') {
  return { user: { id: 'u-lifecycle', role: 'SUPER_ADMIN' }, accessToken,
    accessExpiresAt: new Date(Date.now() + 900000).toISOString() };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('BroadcastChannel', undefined);
  vi.stubGlobal('fetch', vi.fn());
  resetAdminSessionStore();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Active client session lifecycle (LR-027)', () => {
  it('deduplicates focus/interval checks, retains absolute expiry and cancels requests on unmount', async () => {
    const session = identity();
    useAdminSessionStore.getState().setSession(session);
    let finish;
    fetch.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const { result, unmount } = renderHook(() => useAdminSession({ autoInit: false }));
    await act(async () => {
      window.dispatchEvent(new globalThis.Event('focus'));
      document.dispatchEvent(new globalThis.Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(30000);
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('/api/v1/auth/me');
    await act(async () => { finish({ ok: true, json: async () => ({ data: { user: session.user } }) }); });
    expect(result.current.accessExpiresAt).toBe(session.accessExpiresAt);
    expect(result.current.isAuthenticated).toBe(true);
    const signal = fetch.mock.calls[0][1].signal;
    unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['network', 'database'])('fails closed on %s verification failure without a refresh retry', async (kind) => {
    useAdminSessionStore.getState().setSession(identity());
    if (kind === 'network') {
      fetch.mockRejectedValueOnce(new TypeError('Offline'));
    } else {
      fetch.mockResolvedValueOnce({ ok: false, status: 503,
        json: async () => ({ error: { code: 'SERVICE_UNAVAILABLE' } }) });
    }
    const { result, unmount } = renderHook(() => useAdminSession({ autoInit: false }));
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(result.current.status).toBe('DISCONNECTED');
    expect(result.current.accessToken).toBeNull();
    expect(result.current.user).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(fetch).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('ignores verification responses for a replaced access token', async () => {
    useAdminSessionStore.getState().setSession(identity());
    let reject;
    fetch.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
    const { result, unmount } = renderHook(() => useAdminSession({ autoInit: false }));
    await act(async () => { window.dispatchEvent(new globalThis.Event('focus')); });
    act(() => { useAdminSessionStore.getState().setSession(identity('new-access')); });
    await act(async () => { reject(new TypeError('Old request failed')); });
    expect(result.current.accessToken).toBe('new-access');
    expect(result.current.status).toBe('AUTHENTICATED');
    unmount();
  });

  it.each(['login', 'refresh'])('does not restore identity after %s completes across invalidation', async (action) => {
    const { result, unmount } = renderHook(() => useAdminSession({ autoInit: false }));
    let finish;
    fetch.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    let pending;
    act(() => { pending = result.current[action]({ email: 'synthetic@example.test', password: 'synthetic-only' }); });
    act(() => { useAdminSessionStore.getState().clearSession(); });
    await act(async () => { finish({ ok: true, json: async () => ({ data: identity() }) }); await pending; });
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.accessToken).toBeNull();
    unmount();
  });

  it.each(['login', 'refresh'])('ignores stale %s errors after a newer session has been established', async (action) => {
    const { result, unmount } = renderHook(() => useAdminSession({ autoInit: false }));
    let reject;
    fetch.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
    let pending;
    act(() => { pending = result.current[action]({ email: 'synthetic@example.test', password: 'synthetic-only' }); });
    act(() => { useAdminSessionStore.getState().setSession(identity('new-access')); });
    await act(async () => {
      reject(new TypeError('Old request failed'));
      await expect(pending).rejects.toMatchObject({ code: 'DISCONNECTED' });
    });
    expect(result.current.accessToken).toBe('new-access');
    expect(result.current.error).toBeNull();
    unmount();
  });
});
