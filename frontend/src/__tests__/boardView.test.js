import { describe, expect, it } from 'vitest';
import { buildBoardView } from '../services/boardView.js';

describe('Board view service and Focus Mode projections', () => {
  it.each([0, 2])('keeps the token at origin %i before the scheduled movement starts', (from) => {
    const team = { id: 'team-1', code: 'T1', sortOrder: 1, position: from + 3, name: 'Tim Satu' };
    const snapshot = { data: { game: { currentTeamId: team.id }, teams: [team] } };
    const timeline = {
      isMoving: false, phase: 'STARTING', currentCell: from,
      movement: { teamId: team.id, from, fullPath: [from + 1, from + 2, from + 3] }
    };

    const view = buildBoardView(snapshot, timeline);
    const origin = from === 0 ? view.start : view.cells[from - 1];
    expect(origin.chips.map((chip) => chip.id)).toEqual([team.id]);
    expect(origin.count).toBe(1);
    expect(view.cells[from + 2].count).toBe(0);
    expect(view.cells.reduce((count, cell) => count + cell.count, view.start.count)).toBe(1);
    expect(snapshot.data.teams[0].position).toBe(from + 3);
  });

  it('lays out 50 zigzag slots and clusters ten server-positioned teams without losing the active team', () => {
    const teams = Array.from({ length: 10 }, (_, index) => ({
      id: `team-${index + 1}`, code: `T${index + 1}`, sortOrder: index + 1, position: 0, name: `Tim ${index + 1}`
    }));
    const snapshot = {
      data: {
        game: { currentTeamId: 'team-10' },
        teams,
        boardCells: [
          { number: 1, title: 'Challenge nyata', category: 'ACTION' }
        ]
      }
    };
    const view = buildBoardView(snapshot);
    expect(view.cells).toHaveLength(50);
    expect(view.cells[0]).toMatchObject({ number: 1, row: 1, column: 1, title: 'Challenge nyata' });
    expect(view.cells[9]).toMatchObject({ number: 10, row: 1, column: 10 });
    expect(view.cells[10]).toMatchObject({ number: 11, row: 2, column: 10 });
    expect(view.cells[19]).toMatchObject({ number: 20, row: 2, column: 1 });
    expect(view.cells[20]).toMatchObject({ number: 21, row: 3, column: 1 });
    expect(view.cells[39]).toMatchObject({ number: 40, row: 4, column: 1 });
    expect(view.cells[49]).toMatchObject({ number: 50, row: 5, column: 10, category: 'UNCONFIGURED' });
    expect(view.start.chips.map((team) => team.code)).toEqual(['T10', 'T1', 'T2']);
    expect(view.start).toMatchObject({ count: 10, hidden: 7 });
    expect(view.teams).toHaveLength(10);
    expect(buildBoardView(null)).toBeNull();
  });

  it('separates motion from static occupancy: origin drops and destination does not double-render (AT-38, AT-45)', () => {
    const teams = [
      { id: 'team-1', code: 'T1', sortOrder: 1, position: 22, name: 'Tim Satu' }, // DB position committed to 22
      { id: 'team-2', code: 'T2', sortOrder: 2, position: 18, name: 'Tim Dua' }
    ];
    const snapshot = {
      data: {
        game: { currentTeamId: 'team-1' },
        teams,
        boardCells: Array.from({ length: 50 }, (_, i) => ({ number: i + 1, title: `Kotak ${i + 1}`, category: 'ACTION' }))
      }
    };

    // When team-1 is moving from 18 to 22:
    const activeTimeline = {
      isMoving: true,
      phase: 'MOVING',
      stepIndex: 1,
      currentCell: 20,
      movement: {
        teamId: 'team-1',
        from: 18,
        fullPath: [19, 20, 21, 22],
        landingCell: 22,
        finalPosition: 22
      }
    };

    const movingView = buildBoardView(snapshot, activeTimeline);

    // Cell 18 (from): only team-2 is present, team-1 is NOT in cell 18 dock
    const cell18 = movingView.cells.find((c) => c.number === 18);
    expect(cell18.chips.map((t) => t.code)).toEqual(['T2']);

    // Cell 22 (destination): team-1 is NOT yet in cell 22 dock while moving!
    const cell22 = movingView.cells.find((c) => c.number === 22);
    expect(cell22.chips).toEqual([]);
    expect(cell22.count).toBe(0);

    // Cell 20 (current overlay step): has isCurrentStep flag, but team-1 is in overlay, not static chips
    const cell20 = movingView.cells.find((c) => c.number === 20);
    expect(cell20.isCurrentStep).toBe(true);
    expect(cell20.chips).toEqual([]);

    // Path highlight flags
    expect(cell18.isInPath).toBe(false);
    expect(movingView.cells.find((c) => c.number === 19).isInPath).toBe(true);
    expect(cell20.isInPath).toBe(true);
    expect(movingView.cells.find((c) => c.number === 21).isInPath).toBe(true);
    expect(cell22.isInPath).toBe(true);
    expect(movingView.isFocusMode).toBe(true);

    // After movement lands (isMoving: false)
    const landedTimeline = {
      isMoving: false,
      phase: 'LANDED',
      movement: { teamId: 'team-1' }
    };
    const landedView = buildBoardView(snapshot, landedTimeline);
    const landedCell22 = landedView.cells.find((c) => c.number === 22);
    expect(landedCell22.chips.map((t) => t.code)).toEqual(['T1']);
    expect(landedCell22.count).toBe(1);
    expect(landedView.isFocusMode).toBe(false);
  });
});
