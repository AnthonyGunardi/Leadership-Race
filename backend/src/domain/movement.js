import { z } from 'zod';

const cellSchema = z.object({
  number: z.number().int().min(1).max(50),
  category: z.enum(['ACTION', 'REWARD', 'RACE_STRENGTH', 'PIT_STOP', 'INDISIPLINER']),
  penaltySteps: z.number().int().min(0).max(50)
}).refine((cell) => cell.category === 'INDISIPLINER' ? cell.penaltySteps > 0 : cell.penaltySteps === 0);
const movementSchema = z.object({
  from: z.number().int().min(0).max(50), diceValue: z.number().int().min(1).max(6),
  boardCells: z.array(cellSchema).length(50).refine((cells) => new Set(cells.map((cell) => cell.number)).size === 50)
});

/**
 * Server-only, pure calculation: passing cells have no effect, bounce applies at 50, and penalties apply once.
 * Configured penalties stop at START (0); they never create negative positions or trigger another landing effect.
 */
export function calculateMovement(input) {
  const { from, diceValue, boardCells } = movementSchema.parse(input);
  let position = from;
  let direction = from === 50 ? -1 : 1;
  const dicePath = [];
  for (let step = 0; step < diceValue; step += 1) {
    if (position === 50) direction = -1;
    position += direction;
    dicePath.push(position);
  }
  const landingCell = position;
  const cell = boardCells.find((cell) => cell.number === landingCell);
  const penaltyPath = [];
  for (let step = 0; step < cell.penaltySteps && position > 0; step += 1) {
    position -= 1;
    penaltyPath.push(position);
  }
  return { from, diceValue, dicePath, landingCell, penaltyPath, fullPath: [...dicePath, ...penaltyPath],
    finalPosition: position, requiresChallenge: cell.category !== 'INDISIPLINER' };
}
