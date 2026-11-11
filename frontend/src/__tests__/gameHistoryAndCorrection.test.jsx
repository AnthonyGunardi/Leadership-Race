import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GameHistoryPage } from '../pages/GameHistoryPage.jsx';
import { gameRequest, downloadGameCsv } from '../services/games.js';

vi.mock('../services/games.js', () => ({
  gameRequest: vi.fn(),
  downloadGameCsv: vi.fn()
}));

describe('GameHistoryPage & Score Correction UI (G12)', () => {
  let queryClient;
  const session = {
    accessToken: 'test-admin-token',
    user: { id: 'admin-1', email: 'panitia@example.test', role: 'SUPER_ADMIN' }
  };

  const mockHistoryData = {
    game: {
      id: 'game-123',
      name: 'F1 Grand Prix Senayan',
      status: 'RUNNING',
      stateVersion: 12,
      turnNumber: 5
    },
    teams: [
      { id: 'team-1', name: 'Scuderia Ferrari', code: 'T1', color: '#ff0000', position: 14, totalScore: 25 },
      { id: 'team-2', name: 'Mercedes AMG', code: 'T2', color: '#00ffff', position: 12, totalScore: 10 }
    ],
    turns: [
      {
        id: 'turn-1',
        turnNumber: 1,
        teamId: 'team-1',
        teamName: 'Scuderia Ferrari',
        teamCode: 'T1',
        teamColor: '#ff0000',
        diceValue: 4,
        fromPosition: 0,
        landingCell: 4,
        finalPosition: 4,
        status: 'COMPLETED',
        requiresChallenge: true,
        voidedAt: null,
        voidReason: null,
        createdAt: '2026-11-10T10:00:00.000Z',
        resolvedAt: '2026-11-10T10:01:00.000Z',
        challengeResult: {
          id: 'cr-1',
          scoringMethod: 'BUTTON',
          outcome: 'SUCCESS',
          awardedPoints: 15,
          note: null
        }
      }
    ],
    scoreLedger: [
      {
        id: 'ledger-1',
        teamId: 'team-1',
        teamName: 'Scuderia Ferrari',
        teamCode: 'T1',
        turnId: 'turn-1',
        challengeResultId: 'cr-1',
        deltaPoints: 15,
        source: 'CHALLENGE_BUTTON',
        reason: null,
        actorUserId: 'admin-1',
        actorEmail: 'panitia@example.test',
        compensatesEntryId: null,
        createdAt: '2026-11-10T10:01:00.000Z'
      }
    ],
    auditLogs: [
      {
        id: 'audit-1',
        action: 'GAME_STARTED',
        actorType: 'USER',
        actorUserId: 'admin-1',
        actorEmail: 'panitia@example.test',
        before: { status: 'READY' },
        after: { status: 'RUNNING' },
        reason: 'Start race',
        requestId: 'req-1',
        occurredAt: '2026-11-10T09:55:00.000Z'
      }
    ]
  };

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });
  });

  function renderHistoryPage(gameId = 'game-123') {
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/admin/games/${gameId}/history`]}>
          <Routes>
            <Route
              path="/admin/games/:id/history"
              element={<GameHistoryPage session={session} />}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  it('renders history, turns table, score ledger, and audit trail', async () => {
    gameRequest.mockResolvedValue({
      success: true,
      data: mockHistoryData
    });

    renderHistoryPage();

    expect(screen.getByText('Loading game history…')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('F1 Grand Prix Senayan')).toBeInTheDocument();
      expect(screen.getByTestId('game-status')).toHaveTextContent('RUNNING');
      expect(screen.getByTestId('turns-table')).toBeInTheDocument();
      expect(screen.getByTestId('ledger-table')).toBeInTheDocument();
      expect(screen.getByTestId('audit-table')).toBeInTheDocument();
    });

    // Check team score chips
    expect(screen.getAllByText(/Scuderia Ferrari/).length).toBeGreaterThan(0);
    expect(screen.getByText(/25 pts/)).toBeInTheDocument();
  });

  it('filters history by tab category', async () => {
    const user = userEvent.setup();
    gameRequest.mockResolvedValue({
      success: true,
      data: mockHistoryData
    });

    renderHistoryPage();

    await waitFor(() => {
      expect(screen.getByTestId('turns-table')).toBeInTheDocument();
    });

    // Click Turns tab -> should show turns table only
    const turnsTab = screen.getByRole('tab', { name: /Turns/i });
    await user.click(turnsTab);

    await waitFor(() => {
      expect(screen.getByTestId('turns-table')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('ledger-table')).not.toBeInTheDocument();
    expect(screen.queryByTestId('audit-table')).not.toBeInTheDocument();
  });

  it('submits authoritative score correction with validation and preview', async () => {
    const user = userEvent.setup();
    gameRequest.mockImplementation(async ({ method }) => {
      if (method === 'POST') {
        return {
          success: true,
          data: {
            correctionId: 'corr-1',
            teamId: 'team-1',
            deltaPoints: 10,
            newTotalScore: 35,
            reason: 'Koreksi penambahan poin dari panitia'
          },
          meta: { stateVersion: 13, eventSequence: 20 }
        };
      }
      return { success: true, data: mockHistoryData };
    });

    renderHistoryPage();

    await waitFor(() => {
      expect(screen.getByTestId('toggle-correction-form-btn')).toBeInTheDocument();
    });

    // Open correction form
    await user.click(screen.getByTestId('toggle-correction-form-btn'));
    expect(screen.getByTestId('correction-form-section')).toBeInTheDocument();

    // Select team 1
    const teamSelect = screen.getByTestId('correction-team-select');
    await user.selectOptions(teamSelect, 'team-1');

    // Input delta points +10
    const deltaInput = screen.getByTestId('correction-delta-input');
    await user.type(deltaInput, '10');

    // Verify preview: 25 -> 35
    expect(screen.getByTestId('score-preview')).toHaveTextContent('35 pts');

    // Input reason
    const reasonInput = screen.getByTestId('correction-reason-input');
    await user.type(reasonInput, 'Koreksi penambahan poin dari panitia');

    // Check confirm checkbox
    const confirmCheckbox = screen.getByTestId('correction-confirm-checkbox');
    await user.click(confirmCheckbox);

    // Submit
    const submitBtn = screen.getByTestId('submit-correction-btn');
    expect(submitBtn).not.toBeDisabled();
    await user.click(submitBtn);

    await waitFor(() => {
      expect(gameRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          path: '/game-123/corrections',
          body: expect.objectContaining({
            teamId: 'team-1',
            deltaPoints: 10,
            reason: 'Koreksi penambahan poin dari panitia',
            confirmed: true,
            expectedStateVersion: 12
          })
        })
      );
      expect(screen.getByTestId('correction-success-banner')).toHaveTextContent('35 pts');
    });
  });

  it('prevents submitting correction if new score would be below zero', async () => {
    const user = userEvent.setup();
    gameRequest.mockResolvedValue({
      success: true,
      data: mockHistoryData
    });

    renderHistoryPage();

    await waitFor(() => {
      expect(screen.getByTestId('toggle-correction-form-btn')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('toggle-correction-form-btn'));
    await user.selectOptions(screen.getByTestId('correction-team-select'), 'team-1');

    // Input -50 (Team 1 has 25 points, so 25 - 50 = -25 < 0)
    await user.type(screen.getByTestId('correction-delta-input'), '-50');
    await user.type(screen.getByTestId('correction-reason-input'), 'Pengurangan besar');
    await user.click(screen.getByTestId('correction-confirm-checkbox'));

    expect(screen.getByTestId('score-preview')).toHaveTextContent('Total team score cannot be negative');
    expect(screen.getByTestId('submit-correction-btn')).toBeDisabled();
  });

  it('triggers downloadGameCsv when clicking export CSV button (G13)', async () => {
    const user = userEvent.setup();
    gameRequest.mockResolvedValue({
      success: true,
      data: mockHistoryData
    });
    downloadGameCsv.mockResolvedValue('leadership-race-senayan-game-123.csv');

    renderHistoryPage();

    await waitFor(() => {
      expect(screen.getByTestId('export-csv-btn')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('export-csv-btn'));

    await waitFor(() => {
      expect(downloadGameCsv).toHaveBeenCalledWith({
        accessToken: 'test-admin-token',
        gameId: 'game-123',
        scope: 'all',
        teamId: undefined
      });
    });
  });
});
