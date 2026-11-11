import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GameControlPage } from '../pages/GameControlPage.jsx';
import { DisplayFinalPage } from '../pages/DisplayFinalPage.jsx';
import { gameRequest } from '../services/games.js';

const mockUseDisplayBoard = vi.fn();
vi.mock('../services/games.js', () => ({ gameRequest: vi.fn() }));
vi.mock('../hooks/useDisplayBoard.js', () => ({
  useDisplayBoard: (...args) => mockUseDisplayBoard(...args)
}));

describe('Game Lifecycle UI (G11)', () => {
  let queryClient;
  const session = {
    accessToken: 'test-admin-token',
    user: { id: 'admin-1', email: 'panitia@example.test', role: 'SUPER_ADMIN' }
  };

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });
  });

  function renderControl(gameId = 'game-123') {
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/admin/games/${gameId}/control`]}>
          <Routes>
            <Route
              path="/admin/games/:id/control"
              element={<GameControlPage session={session} />}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  function renderFinal(gameId = 'game-123') {
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/display/${gameId}/final`]}>
          <Routes>
            <Route path="/display/:id/final" element={<DisplayFinalPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  it('renders Pause button when RUNNING and executes pause command', async () => {
    const user = userEvent.setup();
    gameRequest.mockResolvedValueOnce({
      success: true,
      data: {
        game: { id: 'game-123', name: 'Test Race', status: 'RUNNING', turnNumber: 2 },
        teams: [
          { id: 't1', name: 'Ferrari', code: 'T1', color: '#ff0000', sortOrder: 1, position: 5, totalScore: 20 },
          { id: 't2', name: 'McLaren', code: 'T2', color: '#ff8000', sortOrder: 2, position: 3, totalScore: 10 }
        ],
        boardCells: [],
        turn: null,
        turnStatus: 'READY_FOR_ROLL',
        activeMovement: null,
        pendingResult: null,
        leaderboard: [
          { teamId: 't1', name: 'Ferrari', code: 'T1', rank: 1, totalScore: 20 },
          { teamId: 't2', name: 'McLaren', code: 'T2', rank: 2, totalScore: 10 }
        ],
        controller: { holderUserId: 'admin-1', expiresAt: new Date(Date.now() + 20000).toISOString(), version: 1 },
        finalResults: null
      },
      meta: { stateVersion: 10, serverTime: new Date().toISOString() }
    });

    renderControl();
    await waitFor(() => expect(screen.getByTestId('game-status')).toHaveTextContent('RUNNING'));

    const pauseButton = screen.getByRole('button', { name: /Pause Race/i });
    expect(pauseButton).toBeInTheDocument();

    gameRequest.mockResolvedValueOnce({
      success: true,
      data: {
        game: { id: 'game-123', name: 'Test Race', status: 'PAUSED', turnNumber: 2 },
        teams: [],
        boardCells: [],
        turn: null,
        turnStatus: 'READY_FOR_ROLL',
        activeMovement: null,
        pendingResult: null,
        leaderboard: [],
        controller: null,
        finalResults: null
      },
      meta: { stateVersion: 11, serverTime: new Date().toISOString() }
    });

    await user.click(pauseButton);
    expect(gameRequest).toHaveBeenCalledWith(expect.objectContaining({
      path: '/game-123/pause',
      method: 'POST',
      body: { expectedStateVersion: 10 }
    }));
  });

  it('renders Resume button when PAUSED and executes resume command', async () => {
    const user = userEvent.setup();
    gameRequest.mockResolvedValueOnce({
      success: true,
      data: {
        game: { id: 'game-123', name: 'Test Race', status: 'PAUSED', turnNumber: 2 },
        teams: [],
        boardCells: [],
        turn: null,
        turnStatus: 'READY_FOR_ROLL',
        activeMovement: null,
        pendingResult: null,
        leaderboard: [],
        controller: null,
        finalResults: null
      },
      meta: { stateVersion: 11, serverTime: new Date().toISOString() }
    });

    renderControl();
    await waitFor(() => expect(screen.getByTestId('game-status')).toHaveTextContent('PAUSED'));
    expect(screen.getByText(/Game is paused/i)).toBeInTheDocument();

    const resumeButton = screen.getByRole('button', { name: /Resume Race/i });
    expect(resumeButton).toBeInTheDocument();

    gameRequest.mockResolvedValueOnce({
      success: true,
      data: {
        game: { id: 'game-123', name: 'Test Race', status: 'RUNNING' },
        teams: [],
        boardCells: [],
        turn: null,
        turnStatus: 'READY_FOR_ROLL',
        activeMovement: null,
        pendingResult: null,
        leaderboard: [],
        controller: null,
        finalResults: null
      },
      meta: { stateVersion: 12, serverTime: new Date().toISOString() }
    });

    await user.click(resumeButton);
    expect(gameRequest).toHaveBeenCalledWith(expect.objectContaining({
      path: '/game-123/resume',
      method: 'POST',
      body: { expectedStateVersion: 11 }
    }));
  });

  it('shows confirmation dialog before finishing game', async () => {
    const user = userEvent.setup();
    gameRequest.mockResolvedValueOnce({
      success: true,
      data: {
        game: { id: 'game-123', name: 'Test Race', status: 'RUNNING', turnNumber: 5 },
        teams: [],
        boardCells: [],
        turn: null,
        turnStatus: 'READY_FOR_ROLL',
        activeMovement: null,
        pendingResult: null,
        leaderboard: [],
        controller: null,
        finalResults: null
      },
      meta: { stateVersion: 15, serverTime: new Date().toISOString() }
    });

    renderControl();
    await waitFor(() => expect(screen.getByTestId('game-status')).toHaveTextContent('RUNNING'));

    const finishButton = screen.getByRole('button', { name: /Finish Game/i });
    await user.click(finishButton);

    expect(screen.getByRole('dialog', { name: /Confirm Game Finish/i })).toBeInTheDocument();
    expect(screen.getByText(/Are you sure you want to finish this race\?/i)).toBeInTheDocument();

    const confirmButton = screen.getByRole('button', { name: /Yes, Finish Game Now/i });

    gameRequest.mockResolvedValueOnce({
      success: true,
      data: {
        game: { id: 'game-123', name: 'Test Race', status: 'FINISHED' },
        teams: [],
        boardCells: [],
        turn: null,
        turnStatus: 'READY_FOR_ROLL',
        activeMovement: null,
        pendingResult: null,
        leaderboard: [],
        controller: null,
        finalResults: {
          winners: [{ teamId: 't1', name: 'Ferrari', code: 'T1', rank: 1, totalScore: 50 }]
        }
      },
      meta: { stateVersion: 16, serverTime: new Date().toISOString() }
    });

    await user.click(confirmButton);
    expect(gameRequest).toHaveBeenCalledWith(expect.objectContaining({
      path: '/game-123/finish',
      method: 'POST',
      body: { expectedStateVersion: 15, confirmed: true }
    }));
  });

  it('renders DisplayFinalPage with winners and standings when FINISHED', async () => {
    mockUseDisplayBoard.mockReturnValue({
      status: 'connected',
      pairPath: '/display/game-123/pair',
      retry: vi.fn(),
      snapshot: { meta: { serverTime: '2026-11-10T12:00:00.000Z' } },
      view: {
        game: { id: 'game-123', name: 'Championship Grand Prix', status: 'FINISHED' },
        teams: [
          { id: 't1', name: 'Ferrari', code: 'T1', color: '#ff0000', sortOrder: 1, position: 20, totalScore: 45 },
          { id: 't2', name: 'Red Bull', code: 'T2', color: '#001a30', sortOrder: 2, position: 15, totalScore: 30 }
        ],
        leaderboard: [
          { teamId: 't1', name: 'Ferrari', code: 'T1', color: '#ff0000', rank: 1, totalScore: 45 },
          { teamId: 't2', name: 'Red Bull', code: 'T2', color: '#001a30', rank: 2, totalScore: 30 }
        ],
        finalResults: {
          finishedAt: new Date().toISOString(),
          winners: [{ teamId: 't1', name: 'Ferrari', code: 'T1', color: '#ff0000', rank: 1, totalScore: 45 }],
          results: [
            { teamId: 't1', name: 'Ferrari', code: 'T1', color: '#ff0000', rank: 1, score: 45, isWinner: true },
            { teamId: 't2', name: 'Red Bull', code: 'T2', color: '#001a30', rank: 2, score: 30, isWinner: false }
          ]
        }
      }
    });

    renderFinal();
    await waitFor(() => expect(screen.getByText(/Race Finished!/i)).toBeInTheDocument());
    expect(screen.getByText('Championship Grand Prix — Final Results')).toBeInTheDocument();
    expect(screen.getByText(/Race Winners/i)).toBeInTheDocument();
    expect(screen.getAllByText('Ferrari').length).toBeGreaterThan(0);
  });
});
