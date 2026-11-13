import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMovementTimeline } from '../hooks/useMovementTimeline.js';

const serverNow = Date.parse('2026-11-11T10:00:00.000Z');
const movement = {
  turnId: 'turn-1', teamId: 'team-1', from: 2, diceValue: 3,
  dicePath: [3, 4, 5], penaltyPath: [], fullPath: [3, 4, 5], finalPosition: 5,
  startAt: new Date(serverNow + 400).toISOString(),
  endAt: new Date(serverNow + 1750).toISOString(), stepDurationMs: 450
};

describe('Server-scheduled movement hook', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(serverNow);
    vi.stubGlobal('requestAnimationFrame', (callback) => window.setTimeout(() => callback(Date.now()), 16));
    vi.stubGlobal('cancelAnimationFrame', (id) => window.clearTimeout(id));
    // Fail immediately on React update loops instead of leaving a runaway test renderer.
    vi.spyOn(console, 'error').mockImplementation((message) => { throw new Error(String(message)); });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('waits at cell 2, walks through 3, 4, 5, and settles once after landing', () => {
    const onSettled = vi.fn();
    const { result } = renderHook(() => useMovementTimeline({
      activeMovement: movement, serverTime: new Date(serverNow).toISOString(), onSettled
    }));
    expect(result.current).toMatchObject({ phase: 'STARTING', currentCell: 2 });
    act(() => vi.advanceTimersByTime(32));
    expect(onSettled).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(400));
    expect(result.current).toMatchObject({ isMoving: true, currentCell: 3 });
    act(() => vi.advanceTimersByTime(450));
    expect(result.current.currentCell).toBe(4);
    act(() => vi.advanceTimersByTime(450));
    expect(result.current.currentCell).toBe(5);
    act(() => vi.advanceTimersByTime(450));
    expect(result.current).toMatchObject({ phase: 'LANDED', currentCell: 5, isMoving: false });
    expect(onSettled).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ phase: 'LANDED' }));
  });

  it('compensates clock skew and reconnects at the elapsed step without replaying', () => {
    vi.setSystemTime(serverNow + 60000);
    const { result } = renderHook(() => useMovementTimeline({
      activeMovement: movement, serverTime: new Date(serverNow + 1000).toISOString()
    }));
    expect(result.current).toMatchObject({ isMoving: true, currentCell: 4 });
  });

  it('does not replay an expired movement', () => {
    const { result } = renderHook(() => useMovementTimeline({
      activeMovement: movement, serverTime: new Date(serverNow + 2000).toISOString()
    }));
    expect(result.current).toMatchObject({ phase: 'LANDED', currentCell: 5 });
  });

  it('resolves reduced motion directly to the destination without scheduling animation', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const { result } = renderHook(() => useMovementTimeline({ activeMovement: movement }));
    expect(result.current).toMatchObject({ phase: 'LANDED', currentCell: 5 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels movement on reset and stays idle for missing or invalid movement data', () => {
    const { result, rerender } = renderHook((props) => useMovementTimeline(props), {
      initialProps: { activeMovement: movement }
    });
    rerender({ activeMovement: null });
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current).toMatchObject({ phase: 'IDLE', currentCell: null });
    rerender({ activeMovement: { turnId: 'invalid' }, serverTime: 'invalid' });
    expect(result.current).toMatchObject({ phase: 'IDLE', currentCell: null });
  });

  it('prevents backward progress jump when serverTime jitters backwards during active movement', () => {
    const { result, rerender } = renderHook((props) => useMovementTimeline(props), {
      initialProps: {
        activeMovement: movement,
        serverTime: new Date(serverNow).toISOString()
      }
    });

    // Advance to cell 4 (elapsed = 400ms start delay + 450ms step 0 + 100ms into step 1 = 950ms)
    act(() => vi.advanceTimersByTime(950));
    expect(result.current).toMatchObject({ isMoving: true, currentCell: 4, stepIndex: 1 });

    // Snapshot refresh with aged timestamp (simulating 200ms backwards skew)
    rerender({
      activeMovement: movement,
      serverTime: new Date(Date.now() - 200).toISOString()
    });

    // Monotonic guard ensures token does NOT regress to cell 3
    expect(result.current.currentCell).toBe(4);
    expect(result.current.stepIndex).toBe(1);
    expect(result.current.phase).toBe('MOVING');

    // Continues forward cleanly to cell 5 once server time crosses step 2 (>= 900ms elapsed)
    act(() => vi.advanceTimersByTime(650));
    expect(result.current.currentCell).toBe(5);
    expect(result.current.stepIndex).toBe(2);
  });

  it('anchors server time using monotonic anchor metadata', () => {
    const anchor = {
      serverTimeAtRecvMs: serverNow + 300,
      localMonotonicRecvMs: globalThis.performance.now()
    };
    const { result } = renderHook(() => useMovementTimeline({
      activeMovement: movement,
      anchor
    }));
    // startAt is serverNow + 400; anchor is serverNow + 300, so it starts at STARTING (100ms before start)
    expect(result.current).toMatchObject({ phase: 'STARTING', currentCell: 2 });
    act(() => vi.advanceTimersByTime(150));
    // 50ms into step 0 -> cell 3
    expect(result.current).toMatchObject({ isMoving: true, currentCell: 3 });
  });

  it('handles late arrival crossing one step without skipping or crashing (Tahap 5.2)', () => {
    // startAt = serverNow + 400, stepDuration = 450.
    // Elapsed = 500ms -> serverTime = serverNow + 400 + 500 = serverNow + 900.
    // Step 0 was 0..450ms (cell 3).
    // Elapsed 500ms is 50ms into step 1 (cell 4).
    const { result } = renderHook(() => useMovementTimeline({
      activeMovement: movement,
      serverTime: new Date(serverNow + 900).toISOString()
    }));

    expect(result.current).toMatchObject({
      isMoving: true,
      phase: 'MOVING',
      stepIndex: 1,
      currentCell: 4,
      prevCell: 3
    });
    expect(result.current.subStepProgress).toBeCloseTo(50 / 450, 2);
  });

  it('handles mid-flight reconnect at step 2 and seamlessly continues (Tahap 5.3)', () => {
    // startAt = serverNow + 400.
    // Reconnect at elapsed 700ms -> serverTime = serverNow + 1100.
    // Step 1: 450..900ms -> 250ms into step 1.
    const { result } = renderHook(() => useMovementTimeline({
      activeMovement: movement,
      serverTime: new Date(serverNow + 1100).toISOString()
    }));

    expect(result.current).toMatchObject({
      isMoving: true,
      phase: 'MOVING',
      stepIndex: 1,
      currentCell: 4,
      prevCell: 3
    });
    expect(result.current.subStepProgress).toBeCloseTo(250 / 450, 2);

    // Advancing 250ms -> elapsed 950ms (> 900ms) -> step 2 (cell 5)
    act(() => vi.advanceTimersByTime(250));
    expect(result.current.stepIndex).toBe(2);
    expect(result.current.currentCell).toBe(5);
  });

  it('immediately positions at final destination when snapshot arrives after movement completes (Tahap 5.4)', () => {
    // endAt is serverNow + 1750.
    // Snapshot arrives at serverNow + 1800.
    const { result } = renderHook(() => useMovementTimeline({
      activeMovement: movement,
      serverTime: new Date(serverNow + 1800).toISOString()
    }));

    expect(result.current).toMatchObject({
      isMoving: false,
      phase: 'LANDED',
      currentCell: 5
    });
  });
});
