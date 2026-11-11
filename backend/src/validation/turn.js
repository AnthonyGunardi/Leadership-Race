import { z } from 'zod';
import { gameIdSchema, gameVersionSchema } from './gameSetup.js';

const rollDiceSchema = gameVersionSchema.extend({
  diceValue: z.number().int().min(1).max(6),
  expectedTurnNumber: z.number().int().min(1).optional(),
  controllerLeaseToken: z.string().regex(/^[a-f0-9]{64}$/)
});

const buttonResultSchema = gameVersionSchema.extend({
  scoringMethod: z.literal('BUTTON'),
  outcome: z.enum(['SUCCESS', 'FAIL']),
  note: z.string().max(500).optional()
}).superRefine((val, ctx) => {
  if ('points' in val && val.points !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Field points dilarang untuk metode penilaian BUTTON.'
    });
  }
});

const MAX_MANUAL_POINTS_PER_RESULT = 200;

const manualResultSchema = gameVersionSchema.extend({
  scoringMethod: z.literal('MANUAL'),
  points: z.number().int().min(0).max(MAX_MANUAL_POINTS_PER_RESULT),
  note: z.string().max(500).optional()
}).superRefine((val, ctx) => {
  if ('outcome' in val && val.outcome !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Field outcome dilarang untuk metode penilaian MANUAL.'
    });
  }
});

const turnResultSchema = z.discriminatedUnion('scoringMethod', [
  buttonResultSchema,
  manualResultSchema
]);

const voidTurnSchema = gameVersionSchema.extend({
  reason: z.string().trim().min(1, 'Alasan pembatalan tidak boleh kosong.').max(500),
  confirmed: z.literal(true, {
    errorMap: () => ({ message: 'Konfirmasi pembatalan wajib bernilai true.' })
  })
});

/**
 * Validates turn requests (roll dice, challenge result, and void turn) with strict UUID, version, and schema checks.
 *
 * @param {'roll'|'result'|'void'} operation Target operation.
 * @returns {import('express').RequestHandler}
 */
export function validateTurnRequest(operation) {
  if (operation === 'void') {
    return (req, _res, next) => {
      try {
        req.gameInput = {
          gameId: gameIdSchema.parse(req.params.id),
          turnId: gameIdSchema.parse(req.params.turnId),
          idempotencyKey: gameIdSchema.parse(req.get('Idempotency-Key')),
          input: voidTurnSchema.parse(req.body)
        };
        next();
      } catch {
        next(Object.assign(
          new Error('Input pembatalan roll tidak valid. Periksa reason, confirmed, versi, dan Idempotency-Key.'),
          { status: 400, code: 'VALIDATION_ERROR' }
        ));
      }
    };
  }

  if (operation === 'result') {
    return (req, _res, next) => {
      try {
        req.gameInput = {
          gameId: gameIdSchema.parse(req.params.id),
          turnId: gameIdSchema.parse(req.params.turnId),
          idempotencyKey: gameIdSchema.parse(req.get('Idempotency-Key')),
          input: turnResultSchema.parse(req.body)
        };
        next();
      } catch {
        next(Object.assign(
          new Error('Input hasil challenge tidak valid. Periksa metode scoring (BUTTON/MANUAL), outcome/poin, versi, dan Idempotency-Key.'),
          { status: 400, code: 'VALIDATION_ERROR' }
        ));
      }
    };
  }

  const schema = operation === 'roll' ? rollDiceSchema : z.object({});
  return (req, _res, next) => {
    try {
      req.gameInput = {
        gameId: gameIdSchema.parse(req.params.id),
        idempotencyKey: gameIdSchema.parse(req.get('Idempotency-Key')),
        input: schema.parse(req.body)
      };
      next();
    } catch {
      next(Object.assign(
        new Error('Input roll tidak valid. Periksa dadu (1-6), versi, token dan Idempotency-Key.'),
        { status: 400, code: 'VALIDATION_ERROR' }
      ));
    }
  };
}
