import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { useSingleGame } from '../hooks/useSingleGame.js';
import { App } from '../App.jsx';

let client;
afterEach(() => { client?.clear(); vi.unstubAllGlobals(); });

/** Initialization uses the same server transport as the one-page admin, without the retired catalog. */
function setup({ fail = false } = {}) {
  let gameId = null;
  vi.stubGlobal('fetch', vi.fn(async (_url, options = {}) => {
    const write = options.method === 'POST';
    if (write && !fail) gameId = 'current-game';
    return { ok: !(write && fail), status: write && fail ? 409 : 200,
      json: async () => write && fail
        ? { success: false, error: { code: 'STALE_STATE', message: 'Game telah berubah.' } }
        : { success: true, data: { game: { id: gameId, name: 'F1 Leadership Race', status: 'DRAFT' } },
          meta: { stateVersion: 0, eventSequence: 0 } } };
  }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderHook(() => useSingleGame({ user: { id: 'admin' }, accessToken: 'memory' }), {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  });
}

it('initializes the one operational game without catalog or archive requests', async () => {
  const { result } = setup();
  await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
  act(() => result.current.create({ preventDefault: vi.fn() }));
  await waitFor(() => expect(result.current.game.id).toBe('current-game'));
  const writes = fetch.mock.calls.filter(([, options]) => options.method === 'POST');
  expect(writes).toHaveLength(1);
  const [url, request] = writes[0];
  expect(url).toBe('/api/v1/games/current');
  expect(JSON.parse(request.body)).toEqual({ name: 'F1 Leadership Race' });
  expect(request.headers.Authorization).toBe('Bearer memory');
  expect(request.headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/i);
  expect(fetch.mock.calls.every(([path]) => path === '/api/v1/public/game' || path === url)).toBe(true);
});

it('announces initialization conflicts without selecting a different game or issuing a second write', async () => {
  const { result } = setup({ fail: true });
  await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
  act(() => result.current.create({ preventDefault: vi.fn() }));
  await waitFor(() => expect(result.current.command.error?.message).toBe('Game telah berubah.'));
  expect(result.current.game.id).toBeNull();
  expect(fetch.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1);
});

it('shows all fifty board cells immediately at root even before the first server response', () => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(<App queryClient={client} />);
  expect(container.querySelectorAll('.race-grid > li')).toHaveLength(50);
  expect(screen.queryByText('Status Sistem')).not.toBeInTheDocument();
  expect(screen.queryByRole('textbox', { name: /kode/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Reset game' })).not.toBeInTheDocument();
});
