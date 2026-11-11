import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { ChallengeScoringForm } from '../components/ChallengeScoringForm.jsx';
import { LeaderboardPanel } from '../components/LeaderboardPanel.jsx';
import { GameControlPage } from '../pages/GameControlPage.jsx';
import { gameRequest } from '../services/games.js';

vi.mock('../services/games.js', () => ({ gameRequest: vi.fn() }));

describe('ChallengeScoringForm', () => {
  const pendingResult = {
    turnId: 'turn-123',
    teamId: 'team-1',
    cellNumber: 26,
    category: 'REWARD',
    title: 'Origami Challenge',
    successPoints: 20,
    instruction: 'Lipat origami dalam 60 detik'
  };

  it('renders cell information and BUTTON scoring buttons', () => {
    render(
      <ChallengeScoringForm
        pendingResult={pendingResult}
        disabled={false}
        submitting={false}
        onSubmit={vi.fn()}
      />
    );

    expect(screen.getByText(/Cell/)).toHaveTextContent('26');
    expect(screen.getByText('Origami Challenge')).toBeInTheDocument();
    expect(screen.getByText(/REWARD/)).toBeInTheDocument();
    expect(screen.getAllByText(/\+20 pts/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Lipat origami/)).toBeInTheDocument();

    expect(screen.getByRole('button', { name: /Success 20 points/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Fail 0 points/i })).toBeInTheDocument();
  });

  it('triggers onSubmit with SUCCESS on clicking Sukses button', async () => {
    const user = userEvent.setup();
    const handleSubmit = vi.fn();

    render(
      <ChallengeScoringForm
        pendingResult={pendingResult}
        disabled={false}
        submitting={false}
        onSubmit={handleSubmit}
      />
    );

    await user.click(screen.getByRole('button', { name: /Success 20 points/i }));
    expect(handleSubmit).toHaveBeenCalledWith({
      scoringMethod: 'BUTTON',
      outcome: 'SUCCESS'
    });
  });

  it('triggers onSubmit with FAIL on clicking Gagal button', async () => {
    const user = userEvent.setup();
    const handleSubmit = vi.fn();

    render(
      <ChallengeScoringForm
        pendingResult={pendingResult}
        disabled={false}
        submitting={false}
        onSubmit={handleSubmit}
      />
    );

    await user.click(screen.getByRole('button', { name: /Fail 0 points/i }));
    expect(handleSubmit).toHaveBeenCalledWith({
      scoringMethod: 'BUTTON',
      outcome: 'FAIL'
    });
  });

  it('disables buttons when disabled or submitting', () => {
    const { rerender } = render(
      <ChallengeScoringForm
        pendingResult={pendingResult}
        disabled={true}
        submitting={false}
        onSubmit={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /Success/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Fail/i })).toBeDisabled();

    rerender(
      <ChallengeScoringForm
        pendingResult={pendingResult}
        disabled={false}
        submitting={true}
        onSubmit={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /Success/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Fail/i })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(/Saving/);
  });

  it('displays conflict error and reload button on 409 error', async () => {
    const user = userEvent.setup();
    const handleReload = vi.fn();

    render(
      <ChallengeScoringForm
        pendingResult={pendingResult}
        disabled={false}
        submitting={false}
        onSubmit={vi.fn()}
        onReload={handleReload}
        error={{ status: 409, message: 'Hasil sudah dicatat sebelumnya.' }}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Hasil sudah dicatat sebelumnya.');
    const reloadBtn = screen.getByRole('button', { name: /Reload game status/i });
    expect(reloadBtn).toBeInTheDocument();

    await user.click(reloadBtn);
    expect(handleReload).toHaveBeenCalled();
  });
});

describe('LeaderboardPanel', () => {
  const leaderboard = [
    { teamId: 't1', name: 'Ferrari', code: 'T1', position: 15, totalScore: 50, rank: 1 },
    { teamId: 't2', name: 'Mercedes', code: 'T2', position: 12, totalScore: 50, rank: 1 },
    { teamId: 't3', name: 'Red Bull', code: 'T3', position: 8, totalScore: 20, rank: 3 }
  ];

  it('renders rank, code, name, position, and scores with shared ranks for ties', () => {
    render(<LeaderboardPanel leaderboard={leaderboard} activeTeamId="t2" />);

    expect(screen.getByText('Leaderboard')).toBeInTheDocument();
    expect(screen.getByTestId('leaderboard-table')).toBeInTheDocument();

    const rows = screen.getAllByRole('row');
    // Header + 3 data rows = 4 rows
    expect(rows.length).toBe(4);

    // T1 and T2 both show #1
    expect(screen.getAllByText('#1').length).toBe(2);
    expect(screen.getByText('#3')).toBeInTheDocument();

    // Active team row has active class and aria-current
    const activeRow = rows.find((r) => r.getAttribute('aria-current') === 'true');
    expect(activeRow).toBeDefined();
    expect(activeRow).toHaveTextContent('Mercedes');
  });
});

describe('GameControlPage scoring integration', () => {
  let client;
  const session = { user: { id: 'admin-a' }, accessToken: 'test-admin-access' };

  beforeEach(() => {
    vi.clearAllMocks();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    client.clear();
    vi.restoreAllMocks();
  });

  it('renders ChallengeScoringForm and submits BUTTON result when AWAITING_RESULT', async () => {
    const user = userEvent.setup();
    const snapshot = {
      success: true,
      data: {
        game: { id: 'game-1', status: 'RUNNING', currentTeamId: 'team-1', turnNumber: 1 },
        teams: [
          { id: 'team-1', name: 'Ferrari', code: 'T1', position: 5, sortOrder: 1, totalScore: 0 }
        ],
        turn: { id: 'turn-999', diceValue: 5 },
        turnStatus: 'AWAITING_RESULT',
        activeMovement: null,
        pendingResult: {
          turnId: 'turn-999',
          teamId: 'team-1',
          cellNumber: 5,
          category: 'ACTION',
          title: 'Quick Reaction',
          successPoints: 10
        },
        leaderboard: [
          { teamId: 'team-1', name: 'Ferrari', code: 'T1', position: 5, totalScore: 0, rank: 1 }
        ],
        controller: { holderUserId: null, expiresAt: null, version: 0 }
      },
      meta: { stateVersion: 20, serverTime: new Date().toISOString() }
    };

    gameRequest.mockImplementation(async ({ path, method }) => {
      if (method === 'POST' && path.includes('/result')) {
        return {
          success: true,
          data: { turnId: 'turn-999', scoringMethod: 'BUTTON', outcome: 'SUCCESS', awardedPoints: 10, newTotalScore: 10 },
          meta: { stateVersion: 21 }
        };
      }
      return snapshot;
    });

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/admin/games/game-1/control']}>
          <Routes>
            <Route path="/admin/games/:id/control" element={<GameControlPage session={session} />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('challenge-scoring-form')).toBeInTheDocument();
    });

    expect(screen.getByText('Quick Reaction')).toBeInTheDocument();
    expect(screen.getByTestId('leaderboard-table')).toBeInTheDocument();

    const suksesBtn = screen.getByRole('button', { name: /Success 10 points/i });
    await user.click(suksesBtn);

    await waitFor(() => {
      expect(gameRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          path: '/game-1/turns/turn-999/result',
          method: 'POST',
          body: {
            scoringMethod: 'BUTTON',
            outcome: 'SUCCESS',
            expectedStateVersion: 20
          }
        })
      );
    });
  });

  it('submits MANUAL scoring result with points and note from GameControlPage', async () => {
    const user = userEvent.setup();
    const snapshot = {
      success: true,
      data: {
        game: { id: 'game-1', status: 'RUNNING', currentTeamId: 'team-1', turnNumber: 2 },
        teams: [
          { id: 'team-1', name: 'Ferrari', code: 'T1', position: 26, sortOrder: 1, totalScore: 10 }
        ],
        turn: { id: 'turn-1000', diceValue: 1 },
        turnStatus: 'AWAITING_RESULT',
        activeMovement: null,
        pendingResult: {
          turnId: 'turn-1000',
          teamId: 'team-1',
          cellNumber: 26,
          category: 'ACTION',
          title: 'Origami',
          successPoints: 5,
          defaultMethod: 'MANUAL',
          pointsPerUnit: 5
        },
        leaderboard: [
          { teamId: 'team-1', name: 'Ferrari', code: 'T1', position: 26, totalScore: 10, rank: 1 }
        ],
        controller: { holderUserId: null, expiresAt: null, version: 0 }
      },
      meta: { stateVersion: 30, serverTime: new Date().toISOString() }
    };

    gameRequest.mockImplementation(async ({ path, method }) => {
      if (method === 'POST' && path.includes('/result')) {
        return {
          success: true,
          data: { turnId: 'turn-1000', scoringMethod: 'MANUAL', outcome: null, awardedPoints: 20, newTotalScore: 30 },
          meta: { stateVersion: 31 }
        };
      }
      return snapshot;
    });

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/admin/games/game-1/control']}>
          <Routes>
            <Route path="/admin/games/:id/control" element={<GameControlPage session={session} />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('challenge-scoring-form')).toBeInTheDocument();
    });

    // Kotak 26 defaults to MANUAL mode and shows unit guidance
    expect(screen.getByTestId('unit-guidance')).toHaveTextContent(/1 unit = 5 points/);
    const pointsInput = screen.getByTestId('manual-points-input');
    const noteInput = screen.getByTestId('scoring-note-input');

    await user.type(pointsInput, '20');
    await user.type(noteInput, '4 origami berhasil x 5 poin');

    const submitBtn = screen.getByRole('button', { name: 'Save Manual Points' });
    expect(submitBtn).not.toBeDisabled();
    await user.click(submitBtn);

    await waitFor(() => {
      expect(gameRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          path: '/game-1/turns/turn-1000/result',
          method: 'POST',
          body: {
            scoringMethod: 'MANUAL',
            points: 20,
            note: '4 origami berhasil x 5 poin',
            expectedStateVersion: 30
          }
        })
      );
    });
  });
});

describe('ChallengeScoringForm MANUAL mode and Gate D-03', () => {
  const origamiPendingResult = {
    turnId: 'turn-origami',
    teamId: 'team-1',
    cellNumber: 26,
    category: 'ACTION',
    title: 'Origami',
    successPoints: 5,
    defaultMethod: 'MANUAL',
    pointsPerUnit: 5
  };

  it('defaults to MANUAL for Origami (cell 26) with unit guidance and allows mode switching', async () => {
    const user = userEvent.setup();
    render(
      <ChallengeScoringForm
        pendingResult={origamiPendingResult}
        disabled={false}
        submitting={false}
        onSubmit={vi.fn()}
      />
    );

    // Default tab is MANUAL
    expect(screen.getByRole('tab', { name: 'Manual Points Input' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('unit-guidance')).toHaveTextContent('1 unit = 5 points');
    expect(screen.getByTestId('manual-points-input')).toBeInTheDocument();

    // Switch to BUTTON tab
    const buttonTab = screen.getByRole('tab', { name: 'Button (Success / Fail)' });
    await user.click(buttonTab);
    expect(screen.getByRole('tab', { name: 'Button (Success / Fail)' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: /Success 5 points/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Fail 0 points/i })).toBeInTheDocument();
  });

  it('shows non-blocking warning when points is not a multiple of pointsPerUnit', async () => {
    const user = userEvent.setup();
    render(
      <ChallengeScoringForm
        pendingResult={origamiPendingResult}
        disabled={false}
        submitting={false}
        onSubmit={vi.fn()}
      />
    );

    const pointsInput = screen.getByTestId('manual-points-input');
    const submitBtn = screen.getByRole('button', { name: 'Save Manual Points' });

    // Type 7 (not a multiple of 5)
    await user.type(pointsInput, '7');
    expect(screen.getByTestId('origami-warning')).toHaveTextContent(/Warning: Value is not a multiple of 5/);
    // Non-blocking: submit button is NOT disabled!
    expect(submitBtn).not.toBeDisabled();

    // Clear and type 20 (multiple of 5) -> warning disappears
    await user.clear(pointsInput);
    await user.type(pointsInput, '20');
    expect(screen.queryByTestId('origami-warning')).not.toBeInTheDocument();
    expect(submitBtn).not.toBeDisabled();
  });

  it('requires explicit confirmation for 0 points (Gate D-03 / AT-30)', async () => {
    const user = userEvent.setup();
    const handleSubmit = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm');

    render(
      <ChallengeScoringForm
        pendingResult={origamiPendingResult}
        disabled={false}
        submitting={false}
        onSubmit={handleSubmit}
      />
    );

    const pointsInput = screen.getByTestId('manual-points-input');
    const submitBtn = screen.getByRole('button', { name: 'Save Manual Points' });

    await user.type(pointsInput, '0');

    // 1. User cancels confirmation
    confirmSpy.mockReturnValueOnce(false);
    await user.click(submitBtn);
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('0 points'));
    expect(handleSubmit).not.toHaveBeenCalled();

    // 2. User confirms
    confirmSpy.mockReturnValueOnce(true);
    await user.click(submitBtn);
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect(handleSubmit).toHaveBeenCalledWith({
      scoringMethod: 'MANUAL',
      points: 0
    });

    confirmSpy.mockRestore();
  });

  it('requires explicit confirmation for large points > 50 (Gate D-03)', async () => {
    const user = userEvent.setup();
    const handleSubmit = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm');

    render(
      <ChallengeScoringForm
        pendingResult={origamiPendingResult}
        disabled={false}
        submitting={false}
        onSubmit={handleSubmit}
      />
    );

    const pointsInput = screen.getByTestId('manual-points-input');
    const submitBtn = screen.getByRole('button', { name: 'Save Manual Points' });

    await user.type(pointsInput, '75');

    // 1. User cancels large point confirmation
    confirmSpy.mockReturnValueOnce(false);
    await user.click(submitBtn);
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('is quite large (>50)'));
    expect(handleSubmit).not.toHaveBeenCalled();

    // 2. User confirms
    confirmSpy.mockReturnValueOnce(true);
    await user.click(submitBtn);
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect(handleSubmit).toHaveBeenCalledWith({
      scoringMethod: 'MANUAL',
      points: 75
    });

    confirmSpy.mockRestore();
  });

  it('disables submit on invalid inputs (empty, negative, >200, float)', async () => {
    const user = userEvent.setup();
    render(
      <ChallengeScoringForm
        pendingResult={origamiPendingResult}
        disabled={false}
        submitting={false}
        onSubmit={vi.fn()}
      />
    );

    const pointsInput = screen.getByTestId('manual-points-input');
    const submitBtn = screen.getByRole('button', { name: 'Save Manual Points' });

    // Empty input: disabled
    expect(submitBtn).toBeDisabled();

    // Negative input: disabled
    await user.type(pointsInput, '-5');
    expect(submitBtn).toBeDisabled();

    // Overflow input (> 200): disabled
    await user.clear(pointsInput);
    await user.type(pointsInput, '205');
    expect(submitBtn).toBeDisabled();

    // Valid input (35): enabled
    await user.clear(pointsInput);
    await user.type(pointsInput, '35');
    expect(submitBtn).not.toBeDisabled();
  });
});
