import { z } from 'zod';
import { gameIdSchema } from './gameSetup.js';

const counter = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const digits = z.string().regex(/^(0|[1-9][0-9]*)$/).transform(Number).pipe(counter);
const eventQuerySchema = z.strictObject({
  afterSequence: digits, limit: digits.pipe(counter.min(1).max(500)).default(100)
});

export const socketAuthSchema = z.union([
  z.strictObject({ gameId: gameIdSchema, accessToken: z.string().min(1).max(256) }),
  z.strictObject({ gameId: gameIdSchema, public: z.literal(true) })
]);
export const socketJoinSchema = z.strictObject({ gameId: gameIdSchema });

/** Public and admin reads share cursor validation, while their routers enforce separate authorization. */
export function validateGameRead(operation) {
  return (req, _res, next) => {
    try {
      req.gameInput = { gameId: gameIdSchema.parse(req.params.id),
        ...(operation === 'events' ? { query: eventQuerySchema.parse(req.query) } : {}) };
      next();
    } catch {
      next(Object.assign(new Error('ID game atau parameter replay tidak valid.'), {
        code: 'VALIDATION_ERROR', status: 400
      }));
    }
  };
}
