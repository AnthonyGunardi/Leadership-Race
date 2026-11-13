import { Op } from 'sequelize';
import { defineGameSetup } from '../models/gameSetup.js';
import { databaseNow } from './gameCommands.js';
import { eventDto } from './gameEvents.js';
import { logger } from '../config/logger.js';

/** Publication marks follow delivery: a crash may duplicate a notification but cannot lose a committed event. */
export function createOutboxPublisher({ sequelize, publish, intervalMs = 250 }) {
  const { OutboxEvent, GameEvent } = defineGameSetup(sequelize);
  let active = null;
  let pendingDrain = false;
  let stopped = false;
  let lastSuccess = 0;
  async function drain() {
    const now = await databaseNow(sequelize);
    const rows = await OutboxEvent.findAll({ where: { publishedAt: null, nextAttemptAt: { [Op.lte]: now } },
      order: [['createdAt', 'ASC'], ['id', 'ASC']], limit: 100 });
    for (const row of rows) {
      if (stopped) break;
      try {
        const event = await GameEvent.findByPk(row.gameEventId);
        if (!event || event.gameId !== row.gameId) throw new Error('Outbox event integrity failure');
        await publish(eventDto(event));
        await row.update({ publishedAt: await databaseNow(sequelize), attemptCount: row.attemptCount + 1 });
      } catch {
        logger.error('Outbox delivery failed', { gameId: row.gameId, eventId: row.gameEventId });
        await row.update({ attemptCount: row.attemptCount + 1,
          nextAttemptAt: new Date(+now + Math.min(30000, 1000 * 2 ** Math.min(row.attemptCount, 5))) });
      }
    }
    lastSuccess = Date.now();
  }
  async function runDrainLoop() {
    do {
      pendingDrain = false;
      await drain();
    } while (pendingDrain && !stopped);
  }
  function tick() {
    if (active) {
      pendingDrain = true;
      return active;
    }
    if (!stopped) {
      active = runDrainLoop().catch(() => {
        lastSuccess = 0;
        logger.error('Outbox scan failed');
      }).finally(() => { active = null; });
    }
    return active;
  }
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  tick();
  return { tick, isReady: () => !stopped && lastSuccess > Date.now() - 10000,
    async stop() { stopped = true; clearInterval(timer); await active; } };
}
