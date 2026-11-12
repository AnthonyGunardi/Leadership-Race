import { z } from 'zod';

export const gameIdSchema = z.uuid().regex(/^[a-f0-9-]{36}$/);
const currentGameSchema = z.strictObject({ name: z.string().trim().min(1).max(160) });
const safeCounter = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const points = z.number().int().min(0).max(2147483647);
const text = z.string().trim().max(4000).nullable().default(null);
const teamSchema = z.strictObject({
  id: gameIdSchema.optional(), name: z.string().trim().min(1).max(100),
  color: z.string().regex(/^#[a-fA-F0-9]{6}$/), sortOrder: z.number().int().min(1).max(15)
});
const cellSchema = z.strictObject({
  id: gameIdSchema.optional(), number: z.number().int().min(1).max(50),
  category: z.enum(['ACTION', 'REWARD', 'RACE_STRENGTH', 'PIT_STOP', 'INDISIPLINER']),
  title: z.string().trim().min(1).max(160), instruction: text, backupText: text,
  durationText: z.string().trim().max(255).nullable().default(null),
  successPoints: points, allowManualPoints: z.boolean(), defaultScoringMethod: z.enum(['BUTTON', 'MANUAL']),
  pointsPerUnit: points.min(1).nullable().default(null), penaltySteps: z.number().int().min(0).max(50)
}).superRefine((cell, context) => {
  const penalty = cell.category === 'INDISIPLINER';
  if ((penalty && (cell.penaltySteps < 1 || cell.successPoints !== 0 || cell.allowManualPoints
    || cell.pointsPerUnit !== null || cell.defaultScoringMethod !== 'BUTTON'))
    || (!penalty && (cell.penaltySteps !== 0 || !cell.allowManualPoints))) {
    context.addIssue({ code: 'custom', message: 'Konfigurasi poin atau penalti tidak sesuai kategori kotak.' });
  }
});

export const boardCategoryCounts = { ACTION: 15, REWARD: 10, RACE_STRENGTH: 9, PIT_STOP: 8, INDISIPLINER: 8 };
export const completeBoardSchema = z.array(cellSchema).length(50, 'Board harus berisi tepat 50 kotak.')
  .superRefine((cells, context) => {
    if (new Set(cells.map((cell) => cell.number)).size !== cells.length) {
      context.addIssue({ code: 'custom', message: 'Nomor kotak 1–50 harus unik tanpa celah.' });
    }
    for (const [category, required] of Object.entries(boardCategoryCounts)) {
      const actual = cells.filter((cell) => cell.category === category).length;
      if (actual !== required) {
        context.addIssue({ code: 'custom', message: `Jumlah ${category} harus ${required}; saat ini ${actual}.` });
      }
    }
  });
export const gameVersionSchema = z.strictObject({ expectedStateVersion: safeCounter });
const finishGameSchema = z.strictObject({
  expectedStateVersion: safeCounter,
  confirmed: z.literal(true),
  confirmToken: z.string().trim().max(100).optional()
});
const boardTemplateSchema = z.strictObject({
  expectedStateVersion: safeCounter, templateId: z.literal('prd-appendix-a-v1')
});
const boardImportSchema = z.strictObject({ expectedStateVersion: safeCounter, configuration: z.strictObject({
  format: z.literal('leadership-race-board'), schemaVersion: z.literal(1),
  boardCells: completeBoardSchema.refine((cells) => cells.every((cell) => !cell.id), {
    message: 'Impor tidak menerima ID record dari game lain.'
  })
}) });
export const setupGameSchema = z.strictObject({
  name: currentGameSchema.shape.name, expectedStateVersion: safeCounter,
  teams: z.array(teamSchema).min(2).max(15), boardCells: z.array(cellSchema).max(50)
}).superRefine((setup, context) => {
  const names = setup.teams.map((team) => team.name.toLocaleLowerCase('id'));
  const orders = setup.teams.map((team) => team.sortOrder);
  const numbers = setup.boardCells.map((cell) => cell.number);
  const teamIds = setup.teams.filter((team) => team.id).map((team) => team.id);
  const cellIds = setup.boardCells.filter((cell) => cell.id).map((cell) => cell.id);
  if (new Set(names).size !== names.length || new Set(orders).size !== orders.length
    || orders.some((order) => order > setup.teams.length) || new Set(numbers).size !== numbers.length
    || new Set(teamIds).size !== teamIds.length || new Set(cellIds).size !== cellIds.length) {
    context.addIssue({ code: 'custom', message: 'Nama tim, urutan, ID, dan nomor kotak harus unik; urutan tim mulai 1 tanpa celah.' });
  }
});

const archiveListSchema = z.strictObject({
  page: z.string().regex(/^[1-9][0-9]*$/).transform(Number).pipe(z.number().int().max(1000000)).default(1),
  limit: z.string().regex(/^[1-9][0-9]*$/).transform(Number).pipe(z.number().int().max(100)).default(20)
});

const scoreCorrectionSchema = gameVersionSchema.extend({
  teamId: gameIdSchema,
  deltaPoints: z.number().int().refine((val) => val !== 0, {
    message: 'deltaPoints harus bernilai integer bukan nol.'
  }).refine((val) => val >= -1000 && val <= 1000, {
    message: 'deltaPoints berada dalam rentang -1000 hingga 1000.'
  }),
  reason: z.string().trim().min(3, 'Alasan koreksi minimal 3 karakter.').max(255),
  confirmed: z.literal(true, {
    errorMap: () => ({ message: 'Konfirmasi koreksi wajib bernilai true.' })
  }),
  compensatesEntryId: gameIdSchema.optional().nullable(),
  turnId: gameIdSchema.optional().nullable(),
  challengeResultId: gameIdSchema.optional().nullable()
});

const gameHistoryQuerySchema = z.object({
  type: z.enum(['all', 'turns', 'ledger', 'audit']).default('all'),
  teamId: gameIdSchema.optional(),
  limit: z.union([
    z.string().regex(/^[1-9][0-9]*$/).transform(Number),
    z.number().int().min(1)
  ]).pipe(z.number().int().min(1).max(200)).default(50),
  offset: z.union([
    z.string().regex(/^[0-9]+$/).transform(Number),
    z.number().int().min(0)
  ]).pipe(z.number().int().min(0)).default(0)
});

const gameExportQuerySchema = z.object({
  scope: z.enum(['all', 'standings', 'results', 'turns', 'ledger']).optional(),
  type: z.enum(['all', 'standings', 'results', 'turns', 'ledger']).optional(),
  teamId: gameIdSchema.optional()
}).transform((data) => ({
  scope: data.scope || data.type || 'all',
  teamId: data.teamId
}));

/** Rejects malformed inputs before controllers, including unexpected browser-owned score/position fields. */
export function validateGameRequest(operation) {
  return (req, _res, next) => {
    try {
      req.gameInput = {
        ...(!['archives', 'current', 'template'].includes(operation)
          ? { gameId: gameIdSchema.parse(req.params.id) } : {}),
        ...(operation === 'archives' ? { query: archiveListSchema.parse(req.query) } : {}),
        ...(operation === 'current' ? { input: currentGameSchema.parse(req.body) } : {}),
        ...(operation === 'setup' ? { input: setupGameSchema.parse(req.body) } : {}),
        ...(operation === 'template' ? { templateId: z.literal('prd-appendix-a-v1').parse(req.params.templateId) } : {}),
        ...(operation === 'board-template' ? { input: boardTemplateSchema.parse(req.body) } : {}),
        ...(operation === 'board-import' ? { input: boardImportSchema.parse(req.body) } : {}),
        ...(['validate', 'start', 'pause', 'resume'].includes(operation) ? { input: gameVersionSchema.parse(req.body) } : {}),
        ...(operation === 'finish' ? { input: finishGameSchema.parse(req.body) } : {}),
        ...(operation === 'reset' ? { input: gameVersionSchema.extend({ confirmed: z.literal(true) }).parse(req.body) } : {}),
        ...(operation === 'correction' ? { input: scoreCorrectionSchema.parse(req.body) } : {}),
        ...(operation === 'history' ? { query: gameHistoryQuerySchema.parse(req.query) } : {}),
        ...(operation === 'export' ? { query: gameExportQuerySchema.parse(req.query) } : {}),
        ...(['current', 'reset', 'setup', 'board-template', 'board-import', 'validate', 'start', 'pause', 'resume', 'finish', 'correction'].includes(operation)
          ? { idempotencyKey: gameIdSchema.parse(req.get('Idempotency-Key')) } : {})
      };
      next();
    } catch {
      const message = operation === 'board-import'
        ? 'Impor tidak valid. Gunakan JSON leadership-race-board versi 1, tepat 50 nomor unik, komposisi kategori benar, tanpa ID record atau field tambahan.'
        : operation === 'correction'
          ? 'Input koreksi skor tidak valid. Periksa teamId, deltaPoints (bukan 0), reason, confirmed, versi, dan Idempotency-Key.'
          : operation === 'history'
            ? 'Parameter riwayat tidak valid.'
            : operation === 'export'
              ? 'Parameter ekspor CSV tidak valid.'
              : 'Input game tidak valid. Periksa nama, tim, urutan, kotak, versi, dan Idempotency-Key.';
      const error = new Error(message);
      error.status = 400;
      error.code = 'VALIDATION_ERROR';
      next(error);
    }
  };
}
