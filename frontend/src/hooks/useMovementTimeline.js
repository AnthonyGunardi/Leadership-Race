import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { calculateMovementTimeline, normalizeMovement } from '../services/movementTimeline.js';

/**
 * Manages the client movement animation timeline driven by authoritative server clock offset.
 *
 * Requirements:
 * - PRD §7.5, AT-14, AT-45–AT-48, AT-53.
 * - Compensates for client-server clock skew via serverTime offset.
 * - Handles mid-flight reconnects: resumes from the exact elapsed step without restarting.
 * - Supports prefers-reduced-motion by resolving immediately to final destination.
 */
export function useMovementTimeline({ activeMovement, serverTime, onSettled } = {}) {
  const movement = useMemo(() => normalizeMovement(activeMovement), [activeMovement]);
  const offsetRef = useRef(0);
  const movementRef = useRef(movement);
  const onSettledRef = useRef(onSettled);

  useEffect(() => {
    movementRef.current = movement;
    onSettledRef.current = onSettled;
  });

  useLayoutEffect(() => {
    if (serverTime) {
      const parsed = Date.parse(serverTime);
      if (!Number.isNaN(parsed)) {
        offsetRef.current = parsed - Date.now();
      }
    }
  }, [serverTime]);

  const [timeline, setTimeline] = useState(() => ({
    movement: null,
    isMoving: false,
    phase: 'IDLE',
    stepIndex: -1,
    currentCell: null,
    isBounce: false,
    hasPenalty: false,
    statusLabel: 'IDLE',
    progress: 0
  }));

  // Align a new snapshot's visual position before the browser can paint its committed final position.
  useLayoutEffect(() => {
    if (!movement) {
      setTimeline(calculateMovementTimeline(null, Date.now() + offsetRef.current));
      return undefined;
    }

    const prefersReducedMotion = typeof window !== 'undefined'
      && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);

    const now = Date.now() + offsetRef.current;
    if (prefersReducedMotion) {
      const landed = calculateMovementTimeline(movement, Date.parse(movement.endAt) + 10);
      setTimeline(landed);
      onSettledRef.current?.(landed);
      return undefined;
    }

    const currentTimeline = calculateMovementTimeline(movement, now);
    setTimeline(currentTimeline);

    if (!currentTimeline.isMoving && currentTimeline.phase === 'LANDED') {
      onSettledRef.current?.(currentTimeline);
      return undefined;
    }

    let rafId = null;
    let timerId = null;

    const tick = () => {
      const serverNow = Date.now() + offsetRef.current;
      const next = calculateMovementTimeline(movementRef.current, serverNow);
      setTimeline(next);

      if (next.isMoving || next.phase === 'STARTING') {
        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
          rafId = window.requestAnimationFrame(tick);
        } else {
          timerId = setTimeout(tick, 50);
        }
      } else {
        onSettledRef.current?.(next);
      }
    };

    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      rafId = window.requestAnimationFrame(tick);
    } else {
      timerId = setTimeout(tick, 50);
    }

    return () => {
      if (rafId && typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(rafId);
      }
      if (timerId) {
        clearTimeout(timerId);
      }
    };
  }, [movement]);

  return timeline;
}
