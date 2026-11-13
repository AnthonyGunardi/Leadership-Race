import { describe, expect, it } from 'vitest';
import {
  calculateMovementTimeline,
  getMovementFlags,
  normalizeMovement
} from '../services/movementTimeline.js';

describe('Movement timeline service', () => {
  it('normalizes REST snapshot and WebSocket event formats consistently', () => {
    const fromRest = {
      turnId: 't1',
      teamId: 'team-1',
      diceValue: 4,
      from: 18,
      dicePath: [19, 20, 21, 22],
      penaltyPath: [],
      fullPath: [19, 20, 21, 22],
      landingCell: 22,
      finalPosition: 22,
      movementStartsAt: '2026-11-10T10:00:00.400Z',
      movementEndsAt: '2026-11-10T10:00:02.200Z',
      stepDurationMs: 450
    };
    const normalizedRest = normalizeMovement(fromRest);
    expect(normalizedRest).toMatchObject({
      turnId: 't1',
      teamId: 'team-1',
      diceValue: 4,
      from: 18,
      startAt: '2026-11-10T10:00:00.400Z',
      endAt: '2026-11-10T10:00:02.200Z',
      stepDurationMs: 450
    });

    const fromWs = {
      turnId: 't1',
      teamId: 'team-1',
      diceValue: 4,
      from: 18,
      dicePath: [19, 20, 21, 22],
      penaltyPath: [],
      fullPath: [19, 20, 21, 22],
      landingCell: 22,
      finalPosition: 22,
      startAt: '2026-11-10T10:00:00.400Z',
      endAt: '2026-11-10T10:00:02.200Z',
      stepDurationMs: 450
    };
    const normalizedWs = normalizeMovement(fromWs);
    expect(normalizedWs).toEqual(normalizedRest);
    expect(normalizeMovement(null)).toBeNull();
  });

  it('detects wrap-around and penalty flags (AT-05, AT-46, AT-07, AT-47)', () => {
    const normal = normalizeMovement({
      turnId: 't1',
      from: 18,
      diceValue: 4,
      dicePath: [19, 20, 21, 22],
      fullPath: [19, 20, 21, 22],
      landingCell: 22,
      startAt: '2026-11-10T10:00:00.000Z',
      endAt: '2026-11-10T10:00:01.800Z'
    });
    expect(getMovementFlags(normal)).toEqual({ isBounce: false, hasPenalty: false });

    const wrapAround = normalizeMovement({
      turnId: 't2',
      from: 48,
      diceValue: 6,
      dicePath: [49, 50, 1, 2, 3, 4],
      fullPath: [49, 50, 1, 2, 3, 4],
      landingCell: 4,
      finalPosition: 4,
      startAt: '2026-11-10T10:00:00.000Z',
      endAt: '2026-11-10T10:00:02.700Z'
    });
    expect(getMovementFlags(wrapAround)).toEqual({ isBounce: false, hasPenalty: false });

    const penalty = normalizeMovement({
      turnId: 't3',
      from: 14,
      diceValue: 3,
      dicePath: [15, 16, 17],
      penaltyPath: [16, 15, 14, 13, 12],
      fullPath: [15, 16, 17, 16, 15, 14, 13, 12],
      landingCell: 17,
      finalPosition: 12,
      startAt: '2026-11-10T10:00:00.000Z',
      endAt: '2026-11-10T10:00:03.600Z'
    });
    expect(getMovementFlags(penalty)).toEqual({ isBounce: false, hasPenalty: true });
  });

  it('steps normal movement per kotak (AT-04, AT-45)', () => {
    const startMs = Date.parse('2026-11-10T10:00:00.000Z');
    const movement = normalizeMovement({
      turnId: 't-normal',
      from: 18,
      diceValue: 4,
      dicePath: [19, 20, 21, 22],
      fullPath: [19, 20, 21, 22],
      landingCell: 22,
      finalPosition: 22,
      startAt: new Date(startMs).toISOString(),
      endAt: new Date(startMs + 4 * 450).toISOString(),
      stepDurationMs: 450
    });

    // Before start: still preparing at origin
    const pre = calculateMovementTimeline(movement, startMs - 100);
    expect(pre.isMoving).toBe(false);
    expect(pre.phase).toBe('STARTING');
    expect(pre.currentCell).toBe(18);

    // Step 0: at cell 19
    const s0 = calculateMovementTimeline(movement, startMs + 100);
    expect(s0.isMoving).toBe(true);
    expect(s0.stepIndex).toBe(0);
    expect(s0.currentCell).toBe(19);

    // Step 1: at cell 20
    const s1 = calculateMovementTimeline(movement, startMs + 500);
    expect(s1.stepIndex).toBe(1);
    expect(s1.currentCell).toBe(20);

    // Step 2: at cell 21
    const s2 = calculateMovementTimeline(movement, startMs + 950);
    expect(s2.stepIndex).toBe(2);
    expect(s2.currentCell).toBe(21);

    // Step 3: at cell 22
    const s3 = calculateMovementTimeline(movement, startMs + 1400);
    expect(s3.stepIndex).toBe(3);
    expect(s3.currentCell).toBe(22);

    // End: landed at 22
    const end = calculateMovementTimeline(movement, startMs + 1800);
    expect(end.isMoving).toBe(false);
    expect(end.phase).toBe('LANDED');
    expect(end.currentCell).toBe(22);
  });

  it('reports BERGERAK during circuit wrap-around movement (AT-46)', () => {
    const startMs = Date.parse('2026-11-10T10:00:00.000Z');
    const wrapMovement = normalizeMovement({
      turnId: 't-wrap',
      from: 48,
      diceValue: 6,
      dicePath: [49, 50, 1, 2, 3, 4],
      fullPath: [49, 50, 1, 2, 3, 4],
      landingCell: 4,
      finalPosition: 4,
      startAt: new Date(startMs).toISOString(),
      endAt: new Date(startMs + 6 * 450).toISOString(),
      stepDurationMs: 450
    });

    const s0 = calculateMovementTimeline(wrapMovement, startMs + 100);
    expect(s0.currentCell).toBe(49);
    expect(s0.isBounce).toBe(false);
    expect(s0.statusLabel).toBe('BERGERAK');

    const s1 = calculateMovementTimeline(wrapMovement, startMs + 500);
    expect(s1.currentCell).toBe(50);
    expect(s1.statusLabel).toBe('BERGERAK');

    const s2 = calculateMovementTimeline(wrapMovement, startMs + 950);
    expect(s2.currentCell).toBe(1);
    expect(s2.phase).toBe('MOVING');
    expect(s2.statusLabel).toBe('BERGERAK');

    const s5 = calculateMovementTimeline(wrapMovement, startMs + 2300);
    expect(s5.currentCell).toBe(4);
    expect(s5.phase).toBe('MOVING');
    expect(s5.statusLabel).toBe('BERGERAK');
  });

  it('reports MUNDUR during penalty retreat phase (AT-47)', () => {
    const startMs = Date.parse('2026-11-10T10:00:00.000Z');
    const penaltyMovement = normalizeMovement({
      turnId: 't-penalty',
      from: 14,
      diceValue: 3,
      dicePath: [15, 16, 17],
      penaltyPath: [16, 15, 14, 13, 12],
      fullPath: [15, 16, 17, 16, 15, 14, 13, 12],
      landingCell: 17,
      finalPosition: 12,
      startAt: new Date(startMs).toISOString(),
      endAt: new Date(startMs + 8 * 450).toISOString(),
      stepDurationMs: 450
    });

    // Forward steps (15, 16, 17)
    const forward = calculateMovementTimeline(penaltyMovement, startMs + 100);
    expect(forward.currentCell).toBe(15);
    expect(forward.phase).toBe('MOVING');

    // Penalty retreat step at 16 (index 3 in fullPath)
    const retreat = calculateMovementTimeline(penaltyMovement, startMs + 3 * 450 + 50);
    expect(retreat.stepIndex).toBe(3);
    expect(retreat.currentCell).toBe(16);
    expect(retreat.phase).toBe('PENALTY');
    expect(retreat.statusLabel).toBe('MUNDUR');

    // Penalty final step at 12 (index 7 in fullPath)
    const finalStep = calculateMovementTimeline(penaltyMovement, startMs + 7 * 450 + 50);
    expect(finalStep.stepIndex).toBe(7);
    expect(finalStep.currentCell).toBe(12);
    expect(finalStep.phase).toBe('PENALTY');
    expect(finalStep.statusLabel).toBe('MUNDUR');
  });

  it('reconnects mid-flight without restarting from step 0 (AT-14, AT-53)', () => {
    const startMs = Date.parse('2026-11-10T10:00:00.000Z');
    const movement = normalizeMovement({
      turnId: 't-reconnect',
      from: 18,
      diceValue: 4,
      dicePath: [19, 20, 21, 22],
      fullPath: [19, 20, 21, 22],
      landingCell: 22,
      finalPosition: 22,
      startAt: new Date(startMs).toISOString(),
      endAt: new Date(startMs + 4 * 450).toISOString(),
      stepDurationMs: 450
    });

    // Reconnecting when 1000ms have already elapsed (step 2: cell 21)
    const midFlight = calculateMovementTimeline(movement, startMs + 1000);
    expect(midFlight.isMoving).toBe(true);
    expect(midFlight.stepIndex).toBe(2);
    expect(midFlight.currentCell).toBe(21);

    // Reconnecting after animation has already ended
    const postFlight = calculateMovementTimeline(movement, startMs + 2500);
    expect(postFlight.isMoving).toBe(false);
    expect(postFlight.phase).toBe('LANDED');
    expect(postFlight.currentCell).toBe(22);
  });

  it('calculates subStepProgress and prevCell adaptively for mid-step reconnect and dynamic duration', () => {
    const startMs = Date.parse('2026-11-10T10:00:00.000Z');
    const movement = normalizeMovement({
      turnId: 't-adaptive',
      from: 10,
      diceValue: 3,
      dicePath: [11, 12, 13],
      fullPath: [11, 12, 13],
      landingCell: 13,
      finalPosition: 13,
      startAt: new Date(startMs).toISOString(),
      endAt: new Date(startMs + 3 * 500).toISOString(),
      stepDurationMs: 500
    });

    // 1. Reconnect during glide phase (150ms into step 0)
    const midGlide = calculateMovementTimeline(movement, startMs + 150);
    expect(midGlide.stepIndex).toBe(0);
    expect(midGlide.currentCell).toBe(11);
    expect(midGlide.prevCell).toBe(10);
    expect(midGlide.subStepProgress).toBeCloseTo(0.3, 2);

    // 2. Reconnect during stationary phase (350ms into step 0)
    const midStationary = calculateMovementTimeline(movement, startMs + 350);
    expect(midStationary.stepIndex).toBe(0);
    expect(midStationary.currentCell).toBe(11);
    expect(midStationary.prevCell).toBe(10);
    expect(midStationary.subStepProgress).toBeCloseTo(0.7, 2);

    // 3. Step 1 prevCell points to step 0 destination (11)
    const step1 = calculateMovementTimeline(movement, startMs + 600);
    expect(step1.stepIndex).toBe(1);
    expect(step1.currentCell).toBe(12);
    expect(step1.prevCell).toBe(11);
    expect(step1.subStepProgress).toBeCloseTo(0.2, 2);

    // 4. Clamping with minElapsedMs enforces monotonicity
    const clamped = calculateMovementTimeline(movement, startMs + 200, { minElapsedMs: 600 });
    expect(clamped.stepIndex).toBe(1);
    expect(clamped.currentCell).toBe(12);
    expect(clamped.elapsedMs).toBe(600);
  });
});
