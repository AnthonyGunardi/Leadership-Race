import { Op } from 'sequelize';
import { defineTurn } from '../models/turn.js';
import { databaseNow } from './gameCommands.js';
import { settleExpiredMovementIfDue } from './turnSettlement.js';
import { logger } from '../config/logger.js';

/**
 * Autonomous background worker that continuously scans for and settles expired movements.
 *
 * Requirements:
 * - Scans periodically and immediately at startup/restart without needing HTTP traffic (R-01).
 * - Best-effort timer acceleration on roll without replacing the durable worker safety net.
 * - Concurrency-safe: relies on settleExpiredMovementIfDue's atomic game-turn-team lock.
 */
export function createMovementWorker({ sequelize, scanIntervalMs = 500 }) {
  const Turn = defineTurn(sequelize);
  let active = null;
  let stopped = false;
  let lastScanSuccess = 0;
  const timers = new Map();

  async function drain() {
    const now = await databaseNow(sequelize);
    const expiredTurns = await Turn.findAll({
      where: {
        status: 'ANIMATING',
        movementEndsAt: { [Op.lte]: now }
      },
      order: [['movementEndsAt', 'ASC']],
      limit: 50
    });

    const uniqueGameIds = [...new Set(expiredTurns.map((turn) => turn.gameId))];
    for (const gameId of uniqueGameIds) {
      if (stopped) break;
      try {
        await settleExpiredMovementIfDue({ sequelize, gameId });
      } catch (err) {
        logger.error('Movement worker settlement failed for game', { gameId, error: err.message });
      }
    }
    lastScanSuccess = Date.now();
  }

  function tick() {
    if (!active && !stopped) {
      active = drain().catch((err) => {
        lastScanSuccess = 0;
        logger.error('Movement worker sweep error', { error: err.message });
      }).finally(() => {
        active = null;
      });
    }
    return active;
  }

  // Periodic background sweep
  const interval = setInterval(tick, scanIntervalMs);
  interval.unref();

  // R-01: Startup scan catches movements that expired while process was stopped
  tick();

  return {
    tick,
    isReady: () => !stopped && lastScanSuccess > Date.now() - 15000,
    scheduleSettlementTimer({ gameId, delayMs }) {
      if (stopped) return;
      if (timers.has(gameId)) {
        clearTimeout(timers.get(gameId));
      }
      const timer = setTimeout(async () => {
        timers.delete(gameId);
        if (stopped) return;
        try {
          await settleExpiredMovementIfDue({ sequelize, gameId });
        } catch (err) {
          logger.error('Movement worker timer settlement failed', { gameId, error: err.message });
        }
      }, Math.max(0, delayMs));
      if (typeof timer.unref === 'function') {
        timer.unref();
      }
      timers.set(gameId, timer);
    },
    async stop() {
      stopped = true;
      clearInterval(interval);
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
      await active;
    }
  };
}

