import { describe, expect, it } from 'vitest';
import { calculateMovement } from '../domain/movement.js';
import { getPrdBoardTemplate } from '../data/boardTemplate.js';

const boardCells = getPrdBoardTemplate().boardCells;

describe('server movement from the configured board', () => {
  it.each([
    [0, 3, [1, 2, 3], [], 3],
    [48, 6, [49, 50, 1, 2, 3, 4], [], 4],
    [48, 4, [49, 50, 1, 2], [], 2],
    [50, 3, [1, 2, 3], [], 3],
    [49, 2, [50, 1], [], 1],
    [14, 3, [15, 16, 17], [16, 15, 14, 13, 12], 12],
    [32, 3, [33, 34, 35], [34, 33, 32, 31, 30], 30],
    [49, 1, [50], [], 50],
    [0, 6, [1, 2, 3, 4, 5, 6], [], 6]
  ])('position %i and dice %i produce the exact committed path', (from, diceValue, dicePath, penaltyPath, finalPosition) => {
    expect(calculateMovement({ from, diceValue, boardCells })).toEqual({
      from, diceValue, dicePath, landingCell: dicePath.at(-1), penaltyPath,
      fullPath: [...dicePath, ...penaltyPath], finalPosition, requiresChallenge: penaltyPath.length === 0
    });
  });

  it('uses configured penalties once and stops at START without mutating configuration', () => {
    const custom = boardCells.map((cell) => cell.number === 5 ? { ...cell, penaltySteps: 50 } : { ...cell });
    const before = globalThis.structuredClone(custom);
    expect(calculateMovement({ from: 4, diceValue: 1, boardCells: custom })).toMatchObject({
      landingCell: 5, penaltyPath: [4, 3, 2, 1, 0], finalPosition: 0, requiresChallenge: false
    });
    expect(custom).toEqual(before);
  });

  it.each([-1, 51, 1.5, '3', NaN, Infinity, null])('rejects invalid position %s', (from) => {
    expect(() => calculateMovement({ from, diceValue: 3, boardCells })).toThrow();
  });
  it.each([0, 7, 1.5, '3', NaN, Infinity, null])('rejects invalid dice %s', (diceValue) => {
    expect(() => calculateMovement({ from: 0, diceValue, boardCells })).toThrow();
  });
  it('rejects incomplete, duplicate or incoherent server board configuration', () => {
    for (const invalid of [boardCells.slice(1), [boardCells[1], ...boardCells.slice(1)],
      boardCells.map((cell) => cell.number === 5 ? { ...cell, penaltySteps: 0 } : cell)]) {
      expect(() => calculateMovement({ from: 0, diceValue: 3, boardCells: invalid })).toThrow();
    }
  });
});
