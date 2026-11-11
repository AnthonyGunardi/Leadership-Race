import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DisplayBoardPage } from '../pages/DisplayBoardPage.jsx';
import { TokenCluster } from '../components/TokenCluster.jsx';

const mockUseDisplayBoard = vi.fn();
vi.mock('../hooks/useDisplayBoard.js', () => ({
  useDisplayBoard: (...args) => mockUseDisplayBoard(...args)
}));

describe('G15 minimal display and token clustering', () => {
  beforeEach(() => {
    mockUseDisplayBoard.mockReset();
  });

  const generateTenTeams = () => Array.from({ length: 10 }, (_, index) => ({
    id: `team-${index + 1}`,
    code: `T${index + 1}`,
    name: index === 0
      ? 'Tim Scuderia Ferrari Mission Winnow HP Extreme Racing International'
      : `Tim Balap Formula ${index + 1}`,
    color: ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#64748b'][index],
    position: 26,
    sortOrder: index + 1,
    totalScore: 100 + index * 10
  }));

  describe('Adaptive Token Clustering (AT-33, AT-36, AT-43, AT-44)', () => {
    it('renders 1 individual chip for 1 occupant', () => {
      const occupants = [{ id: 't1', code: 'T1', name: 'Tim 1', color: '#ff0000', sortOrder: 1 }];
      render(<TokenCluster occupants={occupants} count={1} />);
      expect(screen.getByText('T1')).toBeInTheDocument();
      expect(screen.queryByText(/TEAMS/)).not.toBeInTheDocument();
      expect(screen.queryByText(/^\+/)).not.toBeInTheDocument();
    });

    it('renders 2-3 chips without overflow badges for 2 and 3 occupants', () => {
      const occupants3 = [
        { id: 't1', code: 'T1', name: 'Tim 1', color: '#ff0000', sortOrder: 1 },
        { id: 't2', code: 'T2', name: 'Tim 2', color: '#00ff00', sortOrder: 2 },
        { id: 't3', code: 'T3', name: 'Tim 3', color: '#0000ff', sortOrder: 3 }
      ];
      render(<TokenCluster occupants={occupants3} count={3} />);
      expect(screen.getByText('T1')).toBeInTheDocument();
      expect(screen.getByText('T2')).toBeInTheDocument();
      expect(screen.getByText('T3')).toBeInTheDocument();
      expect(screen.queryByText(/TEAMS/)).not.toBeInTheDocument();
      expect(screen.queryByText(/^\+/)).not.toBeInTheDocument();
    });

    it('renders 3 visible chips + +1 and 4 TIM for 4 occupants (AT-43)', () => {
      const occupants4 = Array.from({ length: 4 }, (_, i) => ({
        id: `t${i + 1}`, code: `T${i + 1}`, name: `Tim ${i + 1}`, sortOrder: i + 1
      }));
      render(<TokenCluster occupants={occupants4} count={4} />);
      expect(screen.getByText('T1')).toBeInTheDocument();
      expect(screen.getByText('T2')).toBeInTheDocument();
      expect(screen.getByText('T3')).toBeInTheDocument();
      expect(screen.queryByText('T4')).not.toBeInTheDocument();
      expect(screen.getByText('+1')).toBeInTheDocument();
      expect(screen.getByText('4 TEAMS')).toBeInTheDocument();
    });

    it('renders 3 visible chips + +3 and 6 TIM for 6 occupants (AT-43)', () => {
      const occupants6 = Array.from({ length: 6 }, (_, i) => ({
        id: `t${i + 1}`, code: `T${i + 1}`, name: `Tim ${i + 1}`, sortOrder: i + 1
      }));
      render(<TokenCluster occupants={occupants6} count={6} />);
      expect(screen.getByText('T1')).toBeInTheDocument();
      expect(screen.getByText('T2')).toBeInTheDocument();
      expect(screen.getByText('T3')).toBeInTheDocument();
      expect(screen.getByText('+3')).toBeInTheDocument();
      expect(screen.getByText('6 TEAMS')).toBeInTheDocument();
    });

    it('renders 3 visible chips + +7 and 10 TIM for 10 occupants at cell 26 (AT-33)', () => {
      const occupants10 = generateTenTeams();
      render(<TokenCluster occupants={occupants10} count={10} cellNumber={26} />);
      expect(screen.getByText('T1')).toBeInTheDocument();
      expect(screen.getByText('T2')).toBeInTheDocument();
      expect(screen.getByText('T3')).toBeInTheDocument();
      expect(screen.getByText('+7')).toBeInTheDocument();
      expect(screen.getByText('10 TEAMS')).toBeInTheDocument();
    });

    it('prioritizes active team in visible chips even if sort order is later (AT-44)', () => {
      const occupants10 = generateTenTeams();
      // Active team is T9 (sortOrder 9)
      render(<TokenCluster occupants={occupants10} count={10} activeTeamId="team-9" />);
      // T9 MUST be visible among the 3 chips
      expect(screen.getByText('T9')).toBeInTheDocument();
      expect(screen.getByText('+7')).toBeInTheDocument();
      expect(screen.getByText('10 TEAMS')).toBeInTheDocument();
    });
  });

  describe('DisplayBoardPage minimal public composition (PRD §7, revision 11 November 2026)', () => {
    it('renders only the title, full board and leaderboard, preserving ten-team clustering', () => {
      const teams = generateTenTeams();
      const cells = Array.from({ length: 50 }, (_, i) => ({
        number: i + 1,
        row: Math.floor(i / 10) + 1,
        column: (Math.floor(i / 10) % 2 === 0) ? (i % 10 + 1) : (10 - (i % 10)),
        title: i + 1 === 26 ? 'Origami Challenge' : `Kotak ${i + 1}`,
        category: i + 1 === 26 ? 'RACE_STRENGTH' : 'ACTION',
        categoryLabel: i + 1 === 26 ? 'Race Strength' : 'Action',
        categoryCode: i + 1 === 26 ? 'RS' : 'A',
        isInPath: false,
        isCurrentStep: false,
        chips: i + 1 === 26 ? teams.slice(0, 3) : [],
        hidden: i + 1 === 26 ? 7 : 0,
        count: i + 1 === 26 ? 10 : 0,
        occupants: i + 1 === 26 ? teams : []
      }));

      const mockLeaderboard = teams.map((t, idx) => ({
        rank: idx + 1,
        teamId: t.id,
        code: t.code,
        name: t.name,
        position: t.position,
        totalScore: t.totalScore
      }));

      const mockView = {
        game: { id: 'g1', name: 'Grand Prix 2026', status: 'RUNNING', currentTeamId: 'team-1' },
        teams,
        activeTeam: teams[0],
        isFocusMode: false,
        configuredCount: 50,
        sourceNotice: null,
        timeline: null,
        cells,
        leaderboard: mockLeaderboard,
        start: { chips: [], hidden: 0, count: 0, occupants: [] }
      };

      mockUseDisplayBoard.mockReturnValue({
        status: 'connected',
        error: null,
        view: mockView,
        activeMovement: null,
        timeline: null,
        turnStatus: 'READY_FOR_ROLL',
        snapshot: {
          meta: { serverTime: '2026-11-10T10:00:00.000Z', eventSequence: 10 }
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

      // Verify Header & Title
      expect(screen.getByText('Grand Prix 2026')).toBeInTheDocument();

      const grid = screen.getByLabelText(/50-cell race board/i);
      expect(within(grid).getAllByRole('listitem')).toHaveLength(50);
      const cell26 = within(grid).getByLabelText(/Cell 26,/i);
      expect(within(cell26).getByText('+7')).toBeInTheDocument();
      expect(within(cell26).getByText('10 TEAMS')).toBeInTheDocument();
      expect(screen.getByTestId('leaderboard-table')).toBeInTheDocument();
      expect(within(screen.getByTestId('leaderboard-table')).getAllByRole('row')).toHaveLength(11);
      expect(screen.queryByLabelText('Active Team HUD')).not.toBeInTheDocument();
      expect(screen.queryByTestId('team-position-tracker')).not.toBeInTheDocument();
      expect(screen.queryByTestId('occupancy-panel')).not.toBeInTheDocument();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
  });
});
