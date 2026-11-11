import http from 'node:http';
import { createApp } from './app.js';
import { logger } from './config/logger.js';
import { getEnv } from './config/environment.js';
import { getSequelize, closeSequelize } from './config/database.js';
import { createServerLifecycle } from './services/serverLifecycle.js';
import { createGameGateway } from './realtime/gameGateway.js';
import { createMovementWorker } from './services/movementWorker.js';

const env = getEnv();
const sequelize = getSequelize();

let lifecycleInstance = null;

const app = createApp({
  sequelize,
  isShuttingDown: () => (lifecycleInstance ? lifecycleInstance.isShuttingDown() : false)
});

const server = http.createServer(app);
const gateway = createGameGateway({ server, sequelize });
const movementWorker = createMovementWorker({ sequelize });
app.locals.movementWorker = movementWorker;
app.locals.isRealtimeReady = () => gateway.publisher.isReady();
app.locals.isWorkerReady = () => movementWorker.isReady();

lifecycleInstance = createServerLifecycle({
  server,
  logger,
  closeConnections: async () => {
    await movementWorker.stop();
    await gateway.stop();
  },
  closeDatabase: closeSequelize,
  shutdownTimeoutMs: env.SERVER_SHUTDOWN_TIMEOUT_MS,
  headersTimeoutMs: env.SERVER_HEADERS_TIMEOUT_MS,
  requestTimeoutMs: env.SERVER_REQUEST_TIMEOUT_MS,
  keepAliveTimeoutMs: env.SERVER_KEEPALIVE_TIMEOUT_MS
});

lifecycleInstance.attachProcessHandlers();

const port = env.PORT || 3000;

/**
 * Starts listening for incoming HTTP connections.
 *
 * @param {number} [listenPort=port] Port to bind server on.
 * @returns {Promise<http.Server>} Resolves when server is listening.
 */
export function startServer(listenPort = port) {
  return new Promise((resolve, reject) => {
    server.once('error', (err) => {
      logger.error(`Server failed to start on port ${listenPort}: ${err.message}`, { stack: err.stack });
      reject(err);
    });

    server.listen(listenPort, () => {
      const address = server.address();
      const boundPort = typeof address === 'object' && address !== null ? address.port : listenPort;
      logger.info(`HTTP server running on port ${boundPort} [env=${env.NODE_ENV}]`);

      if (typeof process.send === 'function') {
        process.send({ type: 'server-started', port: boundPort });
      }

      resolve(server);
    });
  });
}

// Auto-start server when invoked as primary entry point
/* istanbul ignore next -- startup/bootstrap code: executed only when server.js is invoked directly via node CLI */
const isMain = process.argv[1] && (
  process.argv[1].endsWith('server.js') ||
  process.argv[1].endsWith('server')
);

/* istanbul ignore next -- startup/bootstrap code: auto-start execution handler */
if (isMain) {
  startServer().catch(() => {
    process.exit(1);
  });
}

export { server, app, lifecycleInstance as lifecycle };
