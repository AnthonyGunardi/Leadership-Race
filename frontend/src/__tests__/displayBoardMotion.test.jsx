import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DisplayBoardPage } from '../pages/DisplayBoardPage.jsx';

const mockUseDisplayBoard = vi.fn();
vi.mock('../hooks/useDisplayBoard.js', () => ({
  useDisplayBoard: (...args) => mockUseDisplayBoard(...args)
}));

describe('DisplayBoardPage Focus Mode and Motion integration (AT-45, AT-48, AT-53)', () => {
  beforeEach(() => {
    mockUseDisplayBoard.mockReset();
  });

  it('preserves the full grid, highlighted path and single token overlay without dashboard elements', () => {
    const teams = [
      { id: 'team-7', code: 'T7', name: 'Team Red', color: '#ef4444', position: 22, sortOrder: 1, totalScore: 100 }
    ];
    const cells = Array.from({ length: 50 }, (_, i) => ({
      number: i + 1,
      row: Math.floor(i / 10) + 1,
      column: (Math.floor(i / 10) % 2 === 0) ? (i % 10 + 1) : (10 - (i % 10)),
      title: `Kotak ${i + 1}`,
      category: 'ACTION',
      categoryLabel: 'Action',
      categoryCode: 'A',
      isInPath: [19, 20, 21, 22].includes(i + 1),
      isCurrentStep: i + 1 === 20,
      chips: [],
      hidden: 0,
      count: 0
    }));

    const mockView = {
      game: { id: 'g1', name: 'Race GP 2026', status: 'RUNNING', currentTeamId: 'team-7' },
      teams,
      activeTeam: teams[0],
      isFocusMode: true,
      configuredCount: 50,
      sourceNotice: null,
      timeline: {
        isMoving: true,
        phase: 'MOVING',
        stepIndex: 1,
        currentCell: 20,
        isBounce: false,
        hasPenalty: false,
        statusLabel: 'BERGERAK',
        movement: {
          turnId: 'turn-1',
          teamId: 'team-7',
          diceValue: 4,
          from: 18,
          dicePath: [19, 20, 21, 22],
          penaltyPath: [],
          fullPath: [19, 20, 21, 22],
          landingCell: 22,
          finalPosition: 22
        }
      },
      cells,
      start: { chips: [], hidden: 0, count: 0 }
    };

    mockUseDisplayBoard.mockReturnValue({
      status: 'connected',
      error: null,
      view: mockView,
      activeMovement: mockView.timeline.movement,
      timeline: mockView.timeline,
      turnStatus: 'ANIMATING',
      snapshot: {
        meta: { serverTime: '2026-11-10T10:00:00.000Z', eventSequence: 5 }
      },
      retry: vi.fn(),
      pairPath: '/display/g1/pair'
    });

    render(
      <MemoryRouter initialEntries={['/display/g1/board']}>
        <Routes>
          <Route path="/display/:id/board" element={<DisplayBoardPage />} />
        </Routes>
      </MemoryRouter>
    );

    // Header & Game Info
    expect(screen.getByText('Race GP 2026')).toBeInTheDocument();

    // Focus Mode grid has active class
    const grid = screen.getByLabelText(/50-cell race board/i);
    expect(grid).toHaveClass('focus-mode-active');

    expect(within(grid).getAllByRole('listitem')).toHaveLength(50);
    expect(screen.getByLabelText(/Cell 20,/i)).toHaveClass('is-current-step');
    expect(screen.getByLabelText(/Cell 19,/i)).toHaveClass('is-in-path');
    expect(screen.getByLabelText(/Cell 21,/i)).toHaveClass('is-in-path');
    expect(screen.getByLabelText(/Cell 22,/i)).toHaveClass('is-in-path');
    expect(screen.queryByLabelText('Active Team HUD')).not.toBeInTheDocument();

    // MovementOverlay token is placed at current cell
    expect(screen.getByText('Token T7 at cell 20')).toBeInTheDocument();

    expect(screen.queryByTestId('team-position-tracker')).not.toBeInTheDocument();
  });
});
