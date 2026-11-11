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
});
