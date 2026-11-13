import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { calculateMovementTimeline, normalizeMovement } from '../services/movementTimeline.js';

const IDLE_TIMELINE = {
  movement: null,
  isMoving: false,
  phase: 'IDLE',
  stepIndex: -1,
  currentCell: null,
  prevCell: null,
  subStepProgress: 0,
  isBounce: false,
  hasPenalty: false,
  statusLabel: 'IDLE',
  progress: 0
};

/**
 * Manages the client movement animation timeline driven by authoritative server clock offset.
 *
 * Requirements:
 * - PRD §7.5, AT-14, AT-45–AT-48, AT-53.
 * - Compensates for client-server clock skew via serverTime offset and monotonic anchor.
 * - Handles mid-flight reconnects: resumes from the exact elapsed step without restarting.
 * - Enforces unified monotonic progress: stepIndex and coordinates never jump backwards.
 * - Supports prefers-reduced-motion by resolving immediately to final destination.
 */
export function useMovementTimeline({ activeMovement, serverTime, anchor, onSettled } = {}) {
  const movement = useMemo(() => normalizeMovement(activeMovement), [activeMovement]);
  const anchorRef = useRef(anchor);
  const currentTurnIdRef = useRef(null);
  const maxElapsedMsRef = useRef(0);
  const hasStartedRef = useRef(false);
  const offsetRef = useRef(0);
  const movementRef = useRef(movement);
  const onSettledRef = useRef(onSettled);

  useEffect(() => {
    movementRef.current = movement;
    onSettledRef.current = onSettled;
    anchorRef.current = anchor;
  });

  useLayoutEffect(() => {
    if (anchor && Number.isFinite(anchor.serverTimeAtRecvMs) && Number.isFinite(anchor.localMonotonicRecvMs)) {
      anchorRef.current = anchor;
    } else if (serverTime) {
      const parsed = Date.parse(serverTime);
      if (!Number.isNaN(parsed)) {
        offsetRef.current = parsed - Date.now();
      }
    }
  }, [serverTime, anchor]);

  const getServerNow = () => {
    const curAnchor = anchorRef.current;
    if (curAnchor && Number.isFinite(curAnchor.serverTimeAtRecvMs) && Number.isFinite(curAnchor.localMonotonicRecvMs)) {
      const localNow = (typeof globalThis.performance !== 'undefined' && typeof globalThis.performance.now === 'function')
        ? globalThis.performance.now()
        : Date.now();
      return curAnchor.serverTimeAtRecvMs + Math.max(0, localNow - curAnchor.localMonotonicRecvMs);
    }
    return Date.now() + offsetRef.current;
  };

  const prefersReducedMotion = typeof window !== 'undefined'
    && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);

  const turnId = movement?.turnId || null;
  const [prevTurnId, setPrevTurnId] = useState(turnId);

  const [timeline, setTimeline] = useState(() => {
    if (!movement) return IDLE_TIMELINE;
    if (prefersReducedMotion) {
      return calculateMovementTimeline(movement, Date.parse(movement.endAt) + 10);
    }
    return IDLE_TIMELINE;
  });

  if (turnId !== prevTurnId) {
    setPrevTurnId(turnId);
    if (!movement) {
      setTimeline(IDLE_TIMELINE);
    } else if (prefersReducedMotion) {
      setTimeline(calculateMovementTimeline(movement, Date.parse(movement.endAt) + 10));
    }
  }

  // Align a new snapshot's visual position before the browser can paint its committed final position.
  useLayoutEffect(() => {
    if (turnId !== currentTurnIdRef.current) {
      currentTurnIdRef.current = turnId;
      maxElapsedMsRef.current = 0;
      hasStartedRef.current = false;
    }

    if (!movement) {
      currentTurnIdRef.current = null;
      maxElapsedMsRef.current = 0;
      hasStartedRef.current = false;
      return undefined;
    }

    if (prefersReducedMotion) {
      const landed = calculateMovementTimeline(movement, Date.parse(movement.endAt) + 10);
      onSettledRef.current?.(landed);
      return undefined;
    }

    const now = getServerNow();
    const currentTimeline = calculateMovementTimeline(movement, now, {
      minElapsedMs: maxElapsedMsRef.current,
      hasStarted: hasStartedRef.current
    });
    if (currentTimeline.hasStarted) {
      hasStartedRef.current = true;
      maxElapsedMsRef.current = Math.max(maxElapsedMsRef.current, currentTimeline.elapsedMs);
    }
    setTimeline(currentTimeline);

    if (!currentTimeline.isMoving && currentTimeline.phase === 'LANDED') {
      onSettledRef.current?.(currentTimeline);
      return undefined;
    }

    let rafId = null;
    let timerId = null;

    const tick = () => {
      const serverNow = getServerNow();
      const next = calculateMovementTimeline(movementRef.current, serverNow, {
        minElapsedMs: maxElapsedMsRef.current,
        hasStarted: hasStartedRef.current
      });
      if (next.hasStarted) {
        hasStartedRef.current = true;
        maxElapsedMsRef.current = Math.max(maxElapsedMsRef.current, next.elapsedMs);
      }
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
  }, [movement, turnId, prefersReducedMotion]);

  return movement ? timeline : IDLE_TIMELINE;
}
