import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMovementWorker } from '../services/movementWorker.js';
import * as gameCommands from '../services/gameCommands.js';
import * as turnSettlement from '../services/turnSettlement.js';
import * as turnModel from '../models/turn.js';

describe('createMovementWorker unit', () => {
  let mockTurnModel;
  let mockSequelize;

  beforeEach(() => {
    vi.clearAllMocks();
    mockTurnModel = {
      findAll: vi.fn().mockResolvedValue([])
    };
    mockSequelize = {};
    vi.spyOn(turnModel, 'defineTurn').mockReturnValue(mockTurnModel);
    vi.spyOn(gameCommands, 'databaseNow').mockResolvedValue(new Date('2026-11-10T12:00:00.000Z'));
    vi.spyOn(turnSettlement, 'settleExpiredMovementIfDue').mockResolvedValue({ settled: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs startup scan and reports readiness when ticks succeed', async () => {
    const worker = createMovementWorker({ sequelize: mockSequelize, scanIntervalMs: 10000 });
    await worker.tick();

    expect(mockTurnModel.findAll).toHaveBeenCalled();
    expect(worker.isReady()).toBe(true);

    await worker.stop();
    expect(worker.isReady()).toBe(false);
  });

  it('drains expired movements and invokes settleExpiredMovementIfDue for unique gameIds', async () => {
    mockTurnModel.findAll.mockResolvedValueOnce([
      { id: 'turn-1', gameId: 'game-1' },
      { id: 'turn-2', gameId: 'game-1' },
      { id: 'turn-3', gameId: 'game-2' }
    ]);

    const worker = createMovementWorker({ sequelize: mockSequelize, scanIntervalMs: 10000 });
    await worker.tick();

    expect(turnSettlement.settleExpiredMovementIfDue).toHaveBeenCalledTimes(2);
    expect(turnSettlement.settleExpiredMovementIfDue).toHaveBeenCalledWith({
      sequelize: mockSequelize,
      gameId: 'game-1'
    });
    expect(turnSettlement.settleExpiredMovementIfDue).toHaveBeenCalledWith({
      sequelize: mockSequelize,
      gameId: 'game-2'
    });

    await worker.stop();
  });

  it('schedules and executes settlement timer, debouncing per gameId', async () => {
    vi.useFakeTimers();
    try {
      const worker = createMovementWorker({ sequelize: mockSequelize, scanIntervalMs: 10000 });

      worker.scheduleSettlementTimer({ gameId: 'game-1', delayMs: 500 });
      worker.scheduleSettlementTimer({ gameId: 'game-1', delayMs: 600 }); // Debounce overwrite

      expect(turnSettlement.settleExpiredMovementIfDue).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(650);

      expect(turnSettlement.settleExpiredMovementIfDue).toHaveBeenCalledWith({
        sequelize: mockSequelize,
        gameId: 'game-1'
      });

      await worker.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cleans up timers and ignores callbacks after stop', async () => {
    vi.useFakeTimers();
    try {
      const worker = createMovementWorker({ sequelize: mockSequelize, scanIntervalMs: 10000 });
      worker.scheduleSettlementTimer({ gameId: 'game-x', delayMs: 1000 });

      await worker.stop();
      await vi.advanceTimersByTimeAsync(1500);

      expect(turnSettlement.settleExpiredMovementIfDue).not.toHaveBeenCalledWith(
        expect.objectContaining({ gameId: 'game-x' })
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
