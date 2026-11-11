import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { validateTurnRequest } from '../validation/turn.js';

describe('validateTurnRequest middleware', () => {
  const rollMiddleware = validateTurnRequest('roll');
  const resultMiddleware = validateTurnRequest('result');
  const validToken = 'a'.repeat(64);

  function createRequest(body, headers = {}, params = {}) {
    return {
      params: { id: randomUUID(), ...params },
      get: (header) => (header.toLowerCase() === 'idempotency-key' ? headers['Idempotency-Key'] || randomUUID() : null),
      body
    };
  }

  it('accepts valid roll request with dice 1-6, version, and lease token', () => {
    const req = createRequest({
      diceValue: 4,
      expectedStateVersion: 12,
      expectedTurnNumber: 1,
      controllerLeaseToken: validToken
    });
    const next = vi.fn();
    rollMiddleware(req, {}, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.gameInput.input.diceValue).toBe(4);
    expect(req.gameInput.input.expectedStateVersion).toBe(12);
    expect(req.gameInput.input.expectedTurnNumber).toBe(1);
    expect(req.gameInput.input.controllerLeaseToken).toBe(validToken);
  });

  it('accepts valid roll request without optional expectedTurnNumber', () => {
    const req = createRequest({
      diceValue: 1,
      expectedStateVersion: 0,
      controllerLeaseToken: validToken
    });
    const next = vi.fn();
    rollMiddleware(req, {}, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.gameInput.input.diceValue).toBe(1);
    expect(req.gameInput.input.expectedTurnNumber).toBeUndefined();
  });

  it('rejects diceValue below 1 or above 6', () => {
    for (const invalidDice of [0, 7, -1, 3.5, '3', null]) {
      const req = createRequest({
        diceValue: invalidDice,
        expectedStateVersion: 1,
        controllerLeaseToken: validToken
      });
      const next = vi.fn();
      rollMiddleware(req, {}, next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({
        status: 400,
        code: 'VALIDATION_ERROR'
      }));
    }
  });

  it('rejects invalid or missing controllerLeaseToken', () => {
    for (const invalidToken of ['too-short', 'z'.repeat(64), 12345, null, undefined]) {
      const req = createRequest({
        diceValue: 3,
        expectedStateVersion: 1,
        controllerLeaseToken: invalidToken
      });
      const next = vi.fn();
      rollMiddleware(req, {}, next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({
        status: 400,
        code: 'VALIDATION_ERROR'
      }));
    }
  });

  it('rejects missing or invalid Idempotency-Key', () => {
    const req = {
      params: { id: randomUUID() },
      get: () => 'not-a-uuid',
      body: {
        diceValue: 3,
        expectedStateVersion: 1,
        controllerLeaseToken: validToken
      }
    };
    const next = vi.fn();
    rollMiddleware(req, {}, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      status: 400,
      code: 'VALIDATION_ERROR'
    }));
  });

  it('accepts valid BUTTON SUCCESS and FAIL results', () => {
    for (const outcome of ['SUCCESS', 'FAIL']) {
      const turnId = randomUUID();
      const req = createRequest({
        scoringMethod: 'BUTTON',
        outcome,
        expectedStateVersion: 5
      }, {}, { turnId });
      const next = vi.fn();
      resultMiddleware(req, {}, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.gameInput.turnId).toBe(turnId);
      expect(req.gameInput.input.scoringMethod).toBe('BUTTON');
      expect(req.gameInput.input.outcome).toBe(outcome);
    }
  });

  it('rejects BUTTON result if points are provided', () => {
    const req = createRequest({
      scoringMethod: 'BUTTON',
      outcome: 'SUCCESS',
      points: 20,
      expectedStateVersion: 5
    }, {}, { turnId: randomUUID() });
    const next = vi.fn();
    resultMiddleware(req, {}, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      status: 400,
      code: 'VALIDATION_ERROR'
    }));
  });

  it('rejects BUTTON result with invalid outcome', () => {
    const req = createRequest({
      scoringMethod: 'BUTTON',
      outcome: 'PARTIAL',
      expectedStateVersion: 5
    }, {}, { turnId: randomUUID() });
    const next = vi.fn();
    resultMiddleware(req, {}, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      status: 400,
      code: 'VALIDATION_ERROR'
    }));
  });

  it('accepts valid MANUAL result and rejects if outcome is provided', () => {
    const turnId = randomUUID();
    const validReq = createRequest({
      scoringMethod: 'MANUAL',
      points: 20,
      note: '4 origami x 5 poin',
      expectedStateVersion: 5
    }, {}, { turnId });
    const next = vi.fn();
    resultMiddleware(validReq, {}, next);
    expect(next).toHaveBeenCalledWith();
    expect(validReq.gameInput.input.scoringMethod).toBe('MANUAL');
    expect(validReq.gameInput.input.points).toBe(20);
    expect(validReq.gameInput.input.note).toBe('4 origami x 5 poin');

    const invalidReq = createRequest({
      scoringMethod: 'MANUAL',
      points: 20,
      outcome: 'SUCCESS',
      expectedStateVersion: 5
    }, {}, { turnId });
    const nextInvalid = vi.fn();
    resultMiddleware(invalidReq, {}, nextInvalid);
    expect(nextInvalid).toHaveBeenCalledWith(expect.objectContaining({
      status: 400,
      code: 'VALIDATION_ERROR'
    }));
  });

  it('validates MANUAL points boundaries (0 to 200) and rejects floats/negatives/overflow (AT-27, D-03)', () => {
    const turnId = randomUUID();

    // 0 is valid (AT-30)
    const zeroReq = createRequest({ scoringMethod: 'MANUAL', points: 0, expectedStateVersion: 1 }, {}, { turnId });
    const nextZero = vi.fn();
    resultMiddleware(zeroReq, {}, nextZero);
    expect(nextZero).toHaveBeenCalledWith();
    expect(zeroReq.gameInput.input.points).toBe(0);

    // 200 is valid (exact max limit)
    const maxReq = createRequest({ scoringMethod: 'MANUAL', points: 200, expectedStateVersion: 1 }, {}, { turnId });
    const nextMax = vi.fn();
    resultMiddleware(maxReq, {}, nextMax);
    expect(nextMax).toHaveBeenCalledWith();
    expect(maxReq.gameInput.input.points).toBe(200);

    // Invalid values: 201 (limit + 1), negative, float, string, unsafe integers
    const invalidPointsList = [201, -1, -50, 35.5, '20', null, undefined, Number.MAX_SAFE_INTEGER + 10];
    for (const invalidPoint of invalidPointsList) {
      const req = createRequest({
        scoringMethod: 'MANUAL',
        points: invalidPoint,
        expectedStateVersion: 1
      }, {}, { turnId });
      const next = vi.fn();
      resultMiddleware(req, {}, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({
        status: 400,
        code: 'VALIDATION_ERROR'
      }));
    }
  });

  it('rejects unknown or invalid scoringMethod', () => {
    const req = createRequest({
      scoringMethod: 'HYBRID',
      points: 20,
      expectedStateVersion: 1
    }, {}, { turnId: randomUUID() });
    const next = vi.fn();
    resultMiddleware(req, {}, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      status: 400,
      code: 'VALIDATION_ERROR'
    }));
  });

  describe('void middleware (G18)', () => {
    const voidMiddleware = validateTurnRequest('void');

    it('accepts valid void request with reason, confirmed=true, and expectedStateVersion', () => {
      const turnId = randomUUID();
      const req = createRequest({
        expectedStateVersion: 5,
        reason: 'Salah input dadu fisik',
        confirmed: true
      }, {}, { turnId });
      const next = vi.fn();
      voidMiddleware(req, {}, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.gameInput.input.reason).toBe('Salah input dadu fisik');
      expect(req.gameInput.input.confirmed).toBe(true);
      expect(req.gameInput.input.expectedStateVersion).toBe(5);
      expect(req.gameInput.turnId).toBe(turnId);
    });

    it('rejects void request with empty or whitespace-only reason', () => {
      for (const emptyReason of ['', '   ', null, undefined]) {
        const req = createRequest({
          expectedStateVersion: 5,
          reason: emptyReason,
          confirmed: true
        }, {}, { turnId: randomUUID() });
        const next = vi.fn();
        voidMiddleware(req, {}, next);

        expect(next).toHaveBeenCalledWith(expect.objectContaining({
          status: 400,
          code: 'VALIDATION_ERROR'
        }));
      }
    });

    it('rejects void request when confirmed is not true', () => {
      for (const invalidConfirmed of [false, 'true', null, undefined, 1]) {
        const req = createRequest({
          expectedStateVersion: 5,
          reason: 'Salah input dadu fisik',
          confirmed: invalidConfirmed
        }, {}, { turnId: randomUUID() });
        const next = vi.fn();
        voidMiddleware(req, {}, next);

        expect(next).toHaveBeenCalledWith(expect.objectContaining({
          status: 400,
          code: 'VALIDATION_ERROR'
        }));
      }
    });

    it('rejects void request with invalid turnId, missing version, or missing Idempotency-Key', () => {
      const invalidTurnReq = createRequest({
        expectedStateVersion: 5,
        reason: 'Salah dadu',
        confirmed: true
      }, {}, { turnId: 'not-a-uuid' });
      const next1 = vi.fn();
      voidMiddleware(invalidTurnReq, {}, next1);
      expect(next1).toHaveBeenCalledWith(expect.objectContaining({ status: 400, code: 'VALIDATION_ERROR' }));

      const noKeyReq = {
        params: { id: randomUUID(), turnId: randomUUID() },
        get: () => null,
        body: { expectedStateVersion: 5, reason: 'Salah dadu', confirmed: true }
      };
      const next2 = vi.fn();
      voidMiddleware(noKeyReq, {}, next2);
      expect(next2).toHaveBeenCalledWith(expect.objectContaining({ status: 400, code: 'VALIDATION_ERROR' }));
    });
  });
});
