import { z } from 'zod';
import { gameIdSchema, gameVersionSchema } from './gameSetup.js';

const heartbeatSchema = z.strictObject({ controllerLeaseToken: z.string().regex(/^[a-f0-9]{64}$/) });
const takeoverSchema = gameVersionSchema.extend({ confirmed: z.literal(true) });

/** Strict input validation excludes browser-owned holder/expiry fields and requires a stable command key. */
export function validateControllerRequest(operation) {
  const schema = operation === 'heartbeat' ? heartbeatSchema
    : operation === 'take-over' ? takeoverSchema : gameVersionSchema;
  return (req, _res, next) => {
    try {
      req.gameInput = { gameId: gameIdSchema.parse(req.params.id),
        idempotencyKey: gameIdSchema.parse(req.get('Idempotency-Key')), input: schema.parse(req.body) };
      next();
    } catch {
      next(Object.assign(new Error('Input controller tidak valid. Periksa versi, token, konfirmasi dan Idempotency-Key.'), {
        status: 400, code: 'VALIDATION_ERROR'
      }));
    }
  };
}
