import { describe, expect, it } from 'vitest';
import { calculateLeaderboard } from '../domain/scoring.js';

describe('calculateLeaderboard', () => {
  it('sorts by totalScore DESC and stable sortOrder ASC', () => {
    const teams = [
      { id: 't1', name: 'Team Alpha', sortOrder: 1, totalScore: 20, position: 5 },
      { id: 't2', name: 'Team Beta', sortOrder: 2, totalScore: 50, position: 10 },
      { id: 't3', name: 'Team Gamma', sortOrder: 3, totalScore: 30, position: 8 }
    ];

    const result = calculateLeaderboard(teams);
    expect(result.map((r) => r.teamId)).toEqual(['t2', 't3', 't1']);
    expect(result.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it('assigns shared rank 1 to tied highest scores without using sortOrder as tie-breaker', () => {
    const teams = [
      { id: 't1', name: 'Team Alpha', sortOrder: 1, totalScore: 50, position: 5 },
      { id: 't2', name: 'Team Beta', sortOrder: 2, totalScore: 50, position: 12 },
      { id: 't3', name: 'Team Gamma', sortOrder: 3, totalScore: 20, position: 20 }
    ];

    const result = calculateLeaderboard(teams);
    expect(result[0].rank).toBe(1);
    expect(result[1].rank).toBe(1);
    expect(result[2].rank).toBe(3);
    expect(result[0].teamId).toBe('t1');
    expect(result[1].teamId).toBe('t2');
  });

  it('handles all teams tied at 0 points at start', () => {
    const teams = [
      { id: 't1', name: 'Team 1', sortOrder: 1, totalScore: 0 },
      { id: 't2', name: 'Team 2', sortOrder: 2, totalScore: 0 },
      { id: 't3', name: 'Team 3', sortOrder: 3, totalScore: 0 }
    ];

    const result = calculateLeaderboard(teams);
    expect(result.every((r) => r.rank === 1)).toBe(true);
    expect(result.map((r) => r.sortOrder)).toEqual([1, 2, 3]);
  });

  it('handles multiple distinct tie groups (standard competition ranking)', () => {
    const teams = [
      { id: 't1', name: 'Team 1', sortOrder: 1, totalScore: 100 },
      { id: 't2', name: 'Team 2', sortOrder: 2, totalScore: 80 },
      { id: 't3', name: 'Team 3', sortOrder: 3, totalScore: 80 },
      { id: 't4', name: 'Team 4', sortOrder: 4, totalScore: 40 },
      { id: 't5', name: 'Team 5', sortOrder: 5, totalScore: 40 },
      { id: 't6', name: 'Team 6', sortOrder: 6, totalScore: 10 }
    ];

    const result = calculateLeaderboard(teams);
    expect(result.map((r) => r.rank)).toEqual([1, 2, 2, 4, 4, 6]);
  });

  it('generates code T{sortOrder} if code is not provided', () => {
    const teams = [
      { id: 't1', name: 'Team 1', sortOrder: 5, totalScore: 10 }
    ];

    const result = calculateLeaderboard(teams);
    expect(result[0].code).toBe('T5');
  });
});

