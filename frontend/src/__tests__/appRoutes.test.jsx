import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { App } from '../App.jsx';
import { NotFoundPage } from '../pages/NotFoundPage.jsx';

describe('Public board and fallback routes', () => {
  let testQueryClient;
  beforeEach(() => {
    testQueryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });
  afterEach(() => {
    testQueryClient.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.history.replaceState({}, '', '/');
  });

  it.each(['/leaderboard', '/final'])('renders %s before a server timestamp is available', async (path) => {
    const response = Promise.withResolvers();
    vi.stubGlobal('fetch', vi.fn(() => response.promise));
    window.history.replaceState({}, '', path);
    render(<App queryClient={testQueryClient} />);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.queryByText(/Server confirmation:/)).not.toBeInTheDocument();
    await act(async () => response.resolve({ ok: true, status: 200, json: async () => ({
      success: true,
      data: { game: { id: null, name: 'Race preview', status: 'DRAFT' }, teams: [], boardCells: [], leaderboard: [] },
      meta: { stateVersion: 0, eventSequence: 0, serverTime: '2026-11-11T00:00:00.000Z' }
    }) }));
    expect(await screen.findByText('2026-11-11T00:00:00.000Z')).toBeInTheDocument();
  });

  it('renders the public board at root and fetches its snapshot without pairing', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          game: { id: null, name: 'F1 Leadership Race', status: 'DRAFT' },
          teams: [], boardCells: [], leaderboard: []
        },
        meta: { stateVersion: 0, eventSequence: 0, serverTime: new Date().toISOString() }
      })
    });

    const { container } = render(<App queryClient={testQueryClient} />);

    expect(screen.getByText('F1 Leadership Race')).toBeInTheDocument();
    expect(container.querySelectorAll('.race-grid > li')).toHaveLength(50);
    expect(screen.getByRole('note')).toHaveTextContent(/laptop \/ PC for the optimal gameboard experience/i);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/v1/public/game', expect.objectContaining({ method: 'GET' }));
    });
  });

  it.each(['/leaderboard', '/final'])('renders %s with unified board-simple style and without mobile gameboard notice', async (path) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({
        success: true,
        data: { game: { id: null, name: 'Race preview', status: 'DRAFT' }, teams: [], boardCells: [], leaderboard: [] },
        meta: { stateVersion: 0, eventSequence: 0, serverTime: '2026-11-11T00:00:00.000Z' }
      })
    }));
    window.history.replaceState({}, '', path);
    const { container } = render(<App queryClient={testQueryClient} />);
    const main = container.querySelector('main');
    expect(main).toHaveClass('board-simple');
    expect(container.querySelector('.mobile-gameboard-notice')).toBeNull();
  });

  it('renders NotFoundPage with 404 message and home link', () => {
    render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>
    );

    expect(screen.getByText(/404 — Page Not Found/i)).toBeInTheDocument();
    expect(screen.getByText('Back to Home')).toBeInTheDocument();
  });
});
