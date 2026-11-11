import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { useControllerLease } from '../hooks/useControllerLease.js';
import { gameRequest } from '../services/games.js';

vi.mock('../services/games.js', () => ({ gameRequest: vi.fn() }));
const session = { user: { id: 'admin-a' }, accessToken: 'test-admin-access' };
const leaseToken = 'b'.repeat(64);
let snapshot;
let client;

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  snapshot = { success: true, data: { game: { id: 'game-a', status: 'RUNNING' },
    controller: { holderUserId: null, expiresAt: null, version: 0 } },
  meta: { stateVersion: 4, serverTime: new Date().toISOString() } };
  gameRequest.mockImplementation(async () => snapshot);
});
afterEach(() => { client.clear(); vi.restoreAllMocks(); });

/** The actual hook and command transport policy run together; only the HTTP boundary is stubbed. */
function mount() {
  return renderHook(() => useControllerLease(session, 'game-a'), {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  });
}

it('acquires once, keeps the credential outside query caches and loses control after a newer same-user takeover', async () => {
  const { result } = mount();
  await waitFor(() => expect(result.current.disabled).toBe(false));
  gameRequest.mockImplementation(async ({ method }) => {
    if (method !== 'POST') return snapshot;
    snapshot = { ...snapshot, data: { ...snapshot.data, controller: {
      holderUserId: session.user.id, expiresAt: new Date(Date.now() + 30000).toISOString(), version: 1
    } }, meta: { ...snapshot.meta, stateVersion: 5 } };
    return { ...snapshot, data: { controller: snapshot.data.controller, controllerLeaseToken: leaseToken } };
  });
  await act(async () => { result.current.acquire(); result.current.acquire(); });
  await waitFor(() => expect(result.current.ownsLease).toBe(true));
  expect(gameRequest.mock.calls.filter(([request]) => request.method === 'POST')).toHaveLength(1);
  expect(JSON.stringify(client.getQueryData(['controller', session.user.id, 'game-a']))).not.toContain(leaseToken);
  expect(result.current).not.toHaveProperty('controllerLeaseToken');
  snapshot = { ...snapshot, data: { ...snapshot.data,
    controller: { ...snapshot.data.controller, version: 2 } } };
  await act(async () => { await result.current.reload(); });
  await waitFor(() => expect(result.current.ownsLease).toBe(false));
});

it('requires explicit takeover confirmation and sends the version the operator observed', async () => {
  snapshot.data.controller = { holderUserId: 'admin-b', expiresAt: new Date(Date.now() + 30000).toISOString(), version: 3 };
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const { result } = mount();
  await waitFor(() => expect(result.current.disabled).toBe(false));
  act(() => result.current.takeOver());
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining('admin-b'));
  expect(gameRequest.mock.calls.some(([request]) => request.method === 'POST')).toBe(false);
  confirm.mockReturnValue(true);
  await act(async () => result.current.takeOver());
  expect(gameRequest).toHaveBeenCalledWith(expect.objectContaining({ path: '/game-a/controller/take-over',
    body: { expectedStateVersion: 4, confirmed: true }, key: expect.any(String) }));
});

it('retries an unknown outcome with the exact same key and payload', async () => {
  const { result } = mount();
  await waitFor(() => expect(result.current.disabled).toBe(false));
  gameRequest.mockRejectedValueOnce(Object.assign(new Error('Connection lost'), { unknownOutcome: true }));
  await act(async () => result.current.acquire());
  expect(result.current.command.uncertain).toBe(true);
  const first = gameRequest.mock.calls.find(([request]) => request.method === 'POST')[0];
  await act(async () => result.current.command.retry());
  const commands = gameRequest.mock.calls.filter(([request]) => request.method === 'POST');
  expect(commands).toHaveLength(2);
  expect(commands[1][0]).toEqual(first);
});
