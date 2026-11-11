import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DisplayBoardPage } from '../pages/DisplayBoardPage.jsx';
import { TokenCluster } from '../components/TokenCluster.jsx';
import { LeaderboardPanel } from '../components/LeaderboardPanel.jsx';
import { buildBoardView } from '../services/boardView.js';

const mockUseDisplayBoard = vi.fn();
vi.mock('../hooks/useDisplayBoard.js', () => ({
  useDisplayBoard: (...args) => mockUseDisplayBoard(...args)
}));

describe('G17 — Venue Display & Big-Screen Readability Verification', () => {
  beforeEach(() => {
    mockUseDisplayBoard.mockReset();
  });

  const sampleTeams = [
    { id: 't1', code: 'RBR', name: 'Red Bull Racing', color: '#1e41ff', position: 10, totalScore: 120, sortOrder: 1 },
    { id: 't2', code: 'FER', name: 'Scuderia Ferrari', color: '#e10600', position: 10, totalScore: 115, sortOrder: 2 },
    { id: 't3', code: 'MER', name: 'Mercedes-AMG', color: '#00d2be', position: 10, totalScore: 110, sortOrder: 3 },
    { id: 't4', code: 'MCL', name: 'McLaren F1', color: '#ff8700', position: 10, totalScore: 105, sortOrder: 4 }
  ];

  it('preserves text and code readability for color-blind and grayscale viewers', () => {
    // AT-49, AT-50: Token chip must never rely on color alone; team code must be visible
    render(<TokenCluster occupants={sampleTeams} count={4} />);

    expect(screen.getByText('RBR')).toBeInTheDocument();
    expect(screen.getByText('FER')).toBeInTheDocument();
    expect(screen.getByText('MER')).toBeInTheDocument();
    expect(screen.getByText('+1')).toBeInTheDocument();
    expect(screen.getByText('4 TEAMS')).toBeInTheDocument();
  });

  it('keeps active team identity, position and score readable in the leaderboard without a separate HUD', () => {
    render(
      <LeaderboardPanel activeTeamId="t1" leaderboard={sampleTeams.map((team, index) => ({
        ...team, teamId: team.id, rank: index + 1
      }))} />
    );

    expect(screen.getByText('Red Bull Racing')).toBeInTheDocument();
    expect(screen.getByText('RBR')).toBeInTheDocument();
    expect(screen.getByText('120')).toBeInTheDocument();
    expect(screen.getByText('Red Bull Racing').closest('tr')).toHaveAttribute('aria-current', 'true');
  });

  it('announces disconnect in the title while preserving the last confirmed board and scores', () => {
    const view = buildBoardView({ data: {
      game: { id: 'test-game', name: 'Venue LED Test Game', status: 'RUNNING' },
      teams: sampleTeams, boardCells: [],
      leaderboard: sampleTeams.map((team, index) => ({ ...team, teamId: team.id, rank: index + 1 }))
    } });
    mockUseDisplayBoard.mockReturnValue({
      view, status: 'disconnected', retry: vi.fn()
    });

    render(
      <MemoryRouter initialEntries={['/display/test-game']}>
        <Routes>
          <Route path="/display/:id" element={<DisplayBoardPage />} />
        </Routes>
      </MemoryRouter>
    );

    // SPEC §10 / PRD §14.1: Disconnected — showing last confirmed state
    const disconnectedBanner = screen.getByText(/displaying last confirmed state/i);
    expect(disconnectedBanner).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toContainElement(disconnectedBanner);
    expect(screen.getAllByRole('listitem')).toHaveLength(50);
    expect(screen.getByText('120')).toBeInTheDocument();
  });
});
