import { getSequelize } from '../config/database.js';

/**
 * Checks the operational liveness of the Node process.
 *
 * @returns {{ status: string, uptime: number, timestamp: string }}
 */
export function checkLiveness() {
  return {
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  };
}

/**
 * Checks the operational readiness of the application and its critical dependencies (MySQL, publisher, worker).
 *
 * Constraints:
 * - Tests actual database connectivity via authenticate().
 * - Verifies realtime publisher readiness when provided.
 * - Verifies background movement worker readiness when provided.
 * - Redacts credential details from connection failure errors.
 *
 * @param {import('sequelize').Sequelize} [sequelizeInstance] Database instance to probe.
 * @param {(() => boolean) | { isRealtimeReady?: () => boolean, isWorkerReady?: () => boolean }}
 *   [realtimeReadyOrOptions] Options object or realtime readiness probe.
 * @param {() => boolean} [isWorkerReadyFn] Function returning boolean indicating worker readiness.
 * @returns {Promise<{
 *   status: 'ready' | 'not_ready',
 *   database: { status: 'connected' | 'disconnected', error?: string },
 *   publisher?: { status: 'ready' | 'not_ready' },
 *   worker?: { status: 'ready' | 'not_ready' },
 *   timestamp: string
 * }>}
 */
export async function checkReadiness(sequelizeInstance, realtimeReadyOrOptions, isWorkerReadyFn) {
  const sequelize = sequelizeInstance || getSequelize();
  const timestamp = new Date().toISOString();

  let isRealtimeReady;
  let isWorkerReady;

  if (typeof realtimeReadyOrOptions === 'object' && realtimeReadyOrOptions !== null) {
    isRealtimeReady = realtimeReadyOrOptions.isRealtimeReady;
    isWorkerReady = realtimeReadyOrOptions.isWorkerReady;
  } else {
    isRealtimeReady = realtimeReadyOrOptions;
    isWorkerReady = isWorkerReadyFn;
  }

  try {
    await sequelize.authenticate();
    const realtimeOk = typeof isRealtimeReady !== 'function' || isRealtimeReady();
    const workerOk = typeof isWorkerReady !== 'function' || isWorkerReady();
    const allReady = realtimeOk && workerOk;

    return {
      status: allReady ? 'ready' : 'not_ready',
      database: {
        status: 'connected'
      },
      ...(typeof isRealtimeReady === 'function' ? { publisher: { status: realtimeOk ? 'ready' : 'not_ready' } } : {}),
      ...(typeof isWorkerReady === 'function' ? { worker: { status: workerOk ? 'ready' : 'not_ready' } } : {}),
      timestamp
    };
  } catch (err) {
    const rawMessage = err && err.message ? err.message : 'Database connection error';
    const sanitizedError = rawMessage.replace(/:\/\/[^:]+:[^@]+@/, '://[REDACTED]@[REDACTED]:');

    return {
      status: 'not_ready',
      database: {
        status: 'disconnected',
        error: sanitizedError
      },
      timestamp
    };
  }
}

/**
 * Gathers system operational metrics for monitoring and staging health checks.
 *
 * @param {import('sequelize').Sequelize} [sequelizeInstance]
 * @returns {Promise<{
 *   uptimeSeconds: number,
 *   timestamp: string,
 *   memory: { heapUsedBytes: number, heapTotalBytes: number, rssBytes: number, externalBytes: number },
 *   database: { status: string },
 *   process: { pid: number, version: string, platform: string }
 * }>}
 */
export async function getSystemMetrics(sequelizeInstance) {
  const memory = process.memoryUsage();
  let dbStatus = 'disconnected';
  try {
    const sequelize = sequelizeInstance || getSequelize();
    await sequelize.authenticate();
    dbStatus = 'connected';
  } catch {
    // database remains disconnected
  }

  return {
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    memory: {
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
      rssBytes: memory.rss,
      externalBytes: memory.external
    },
    database: {
      status: dbStatus
    },
    process: {
      pid: process.pid,
      version: process.version,
      platform: process.platform
    }
  };
}
