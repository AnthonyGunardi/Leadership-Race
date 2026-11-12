/**
 * Movement timeline and step interpolation based on authoritative server clock offset.
 *
 * Requirements:
 * - PRD §7.5, AT-04–AT-08, AT-14, AT-38, AT-45–AT-48, AT-53.
 * - Rest movementStartsAt/EndsAt and event startAt/endAt normalized to startAt/endAt.
 * - Mid-flight reconnect resumes from the exact elapsed step without replaying from step 0.
 * - Completed movement does not replay; expired movement resolves directly to destination.
 */

/** Normalizes movement payload from either REST snapshot or WebSocket event. */
export function normalizeMovement(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const startAt = raw.startAt || raw.movementStartsAt;
  const endAt = raw.endAt || raw.movementEndsAt;
  if (!startAt || !endAt) return null;

  const dicePath = Array.isArray(raw.dicePath) ? raw.dicePath : [];
  const penaltyPath = Array.isArray(raw.penaltyPath) ? raw.penaltyPath : [];
  const fullPath = Array.isArray(raw.fullPath) ? raw.fullPath : [...dicePath, ...penaltyPath];
  const from = Number.isFinite(raw.from) ? raw.from : 0;
  const landingCell = Number.isFinite(raw.landingCell)
    ? raw.landingCell
    : (dicePath.length > 0 ? dicePath[dicePath.length - 1] : from);
  const finalPosition = Number.isFinite(raw.finalPosition)
    ? raw.finalPosition
    : (fullPath.length > 0 ? fullPath[fullPath.length - 1] : from);

  return {
    turnId: raw.turnId || null,
    teamId: raw.teamId || null,
    diceValue: raw.diceValue ?? null,
    from,
    dicePath,
    penaltyPath,
    fullPath,
    landingCell,
    finalPosition,
    startAt,
    endAt,
    stepDurationMs: raw.stepDurationMs || 450
  };
}

/** Determines bounce or penalty characteristics of a movement. */
export function getMovementFlags(movement) {
  if (!movement) return { isBounce: false, hasPenalty: false };
  const hasPenalty = Boolean(movement.penaltyPath && movement.penaltyPath.length > 0);
  return { isBounce: false, hasPenalty };
}

/**
 * Calculates current visual position and phase along the timeline.
 *
 * @param {Object} movement - Normalized movement payload
 * @param {number} serverNowMs - Estimated server epoch time in milliseconds
 */
export function calculateMovementTimeline(movement, serverNowMs) {
  if (!movement || !Array.isArray(movement.fullPath) || movement.fullPath.length === 0) {
    return {
      movement: null,
      isMoving: false,
      phase: 'IDLE',
      stepIndex: -1,
      currentCell: null,
      isBounce: false,
      hasPenalty: false,
      statusLabel: 'IDLE',
      progress: 0
    };
  }

  const startMs = Date.parse(movement.startAt);
  const endMs = Date.parse(movement.endAt);
  const { isBounce, hasPenalty } = getMovementFlags(movement);

  if (Number.isNaN(startMs) || Number.isNaN(endMs) || serverNowMs >= endMs) {
    return {
      movement,
      isMoving: false,
      phase: 'LANDED',
      stepIndex: movement.fullPath.length - 1,
      currentCell: movement.finalPosition,
      isBounce,
      hasPenalty,
      statusLabel: 'LANDING',
      progress: 1
    };
  }

  if (serverNowMs < startMs) {
    return {
      movement,
      isMoving: false,
      phase: 'STARTING',
      stepIndex: -1,
      currentCell: movement.from,
      isBounce,
      hasPenalty,
      statusLabel: hasPenalty ? 'MUNDUR' : 'BERSIAP',
      progress: 0
    };
  }

  const elapsedMs = Math.max(0, serverNowMs - startMs);
  const stepDuration = Math.max(50, movement.stepDurationMs || 450);
  const stepIndex = Math.min(movement.fullPath.length - 1, Math.floor(elapsedMs / stepDuration));
  const currentCell = movement.fullPath[stepIndex];
  const progress = Math.min(1, Math.max(0, elapsedMs / Math.max(1, endMs - startMs)));

  let phase = 'MOVING';
  let statusLabel = 'BERGERAK';

  if (hasPenalty && stepIndex >= movement.dicePath.length) {
    phase = 'PENALTY';
    statusLabel = 'MUNDUR';
  }

  return {
    movement,
    isMoving: true,
    phase,
    stepIndex,
    currentCell,
    isBounce,
    hasPenalty,
    statusLabel,
    progress
  };
}
