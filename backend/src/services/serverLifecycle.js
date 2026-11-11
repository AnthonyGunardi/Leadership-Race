/**
 * Creates and configures server lifecycle management for an HTTP server instance.
 *
 * Why:
 * - Implements graceful shutdown semantics (SIGINT, SIGTERM, IPC message).
 * - Tracks active socket connections to gracefully drain requests before deadline.
 * - Enforces safety nets to prevent hanging processes by terminating stalled sockets.
 * - Marks readiness as unavailable (503) immediately once shutdown begins.
 * - Ensures database connections and other persistent resources are closed cleanly.
 *
 * @param {object} params Lifecycle initialization parameters.
 * @param {import('node:http').Server} params.server Node.js HTTP server instance.
 * @param {object} params.logger Logger instance conforming to info/warn/error interface.
 * @param {() => Promise<void>} [params.closeDatabase] Async cleanup handler for database connection.
 * @param {number} [params.shutdownTimeoutMs=10000] Timeout before destroying remaining open sockets.
 * @param {number} [params.forceTimeoutMs=1000] Timeout after socket destruction before forcing exit.
 * @param {number} [params.keepAliveTimeoutMs=61000] Node HTTP server keepAliveTimeout in ms.
 * @param {number} [params.headersTimeoutMs=65000] Node HTTP server headersTimeout in ms.
 * @param {number} [params.requestTimeoutMs=60000] Node HTTP server requestTimeout in ms.
 * @param {(code: number) => void} [params.exitFn=process.exit] Exit function for dependency injection in tests.
 * @returns {object} Lifecycle controller interface.
 */
export function createServerLifecycle({
  server,
  logger,
  closeDatabase,
  closeConnections,
  shutdownTimeoutMs = 10000,
  forceTimeoutMs = 1000,
  keepAliveTimeoutMs = 61000,
  headersTimeoutMs = 65000,
  requestTimeoutMs = 60000,
  exitFn = (code) => process.exit(code)
}) {
  // TIMEOUT TUNING: Ensure headersTimeout > keepAliveTimeout per Node.js HTTP recommendations
  server.keepAliveTimeout = keepAliveTimeoutMs;
  server.headersTimeout = headersTimeoutMs;
  server.requestTimeout = requestTimeoutMs;

  // CONNECTION MANAGEMENT: Track live sockets for graceful draining
  const connections = new Set();
  server.on('connection', (socket) => {
    connections.add(socket);
    socket.on('close', () => connections.delete(socket));
  });

  // SHUTDOWN STATE & CONNECTION CLOSING HEADER
  let isShuttingDown = false;
  server.on('request', (req, res) => {
    if (isShuttingDown) {
      res.setHeader('Connection', 'close');
    }
  });

  let shutdownPromise = null;

  /**
   * Initiates graceful shutdown sequence.
   *
   * @param {string} signal Name of triggering signal or event.
   * @returns {Promise<void>}
   */
  async function gracefulShutdown(signal) {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    isShuttingDown = true;
    logger.info(`${signal} received. Starting graceful shutdown...`);

    shutdownPromise = new Promise((resolve) => {
      // SAFETY NET: Force close remaining sockets if graceful drain exceeds deadline
      const drainTimer = setTimeout(() => {
        logger.warn('Graceful period expired. Closing remaining connections...');
        for (const socket of connections) {
          if (!socket.destroyed && !socket.writableEnded) {
            socket.destroy();
          }
        }

        const forceTimer = setTimeout(() => {
          logger.error('Forcing immediate shutdown.');
          exitFn(1);
          resolve();
        }, forceTimeoutMs);

        if (typeof forceTimer.unref === 'function') {
          forceTimer.unref();
        }
      }, shutdownTimeoutMs);

      if (typeof drainTimer.unref === 'function') {
        drainTimer.unref();
      }

      // Close the HTTP server to stop accepting new connections
      Promise.resolve().then(() => closeConnections?.()).catch(() => {
        logger.error('Realtime cleanup failed during shutdown.');
      }).then(() => server.close(async (err) => {
        clearTimeout(drainTimer);

        if (err) {
          logger.error(`Error closing server: ${err.message}`, { stack: err.stack });
          if (closeDatabase) {
            try {
              await closeDatabase();
            } catch (dbErr) {
              logger.error(`Error closing database during failure shutdown: ${dbErr.message}`);
            }
          }
          exitFn(1);
          return resolve();
        }

        logger.info('Server closed successfully.');
        if (closeDatabase) {
          try {
            await closeDatabase();
          } catch (dbErr) {
            logger.error(`Error closing database: ${dbErr.message}`);
            exitFn(1);
            return resolve();
          }
        }

        exitFn(0);
        resolve();
      }));
    });

    return shutdownPromise;
  }

  /**
   * Attaches standard process signal and fatal error handlers.
   *
   * @param {NodeJS.Process} [processRef=process] Process object for event listening.
   * @returns {() => void} Teardown function removing attached listeners.
   */
  function attachProcessHandlers(processRef = process) {
    const handleSigint = () => gracefulShutdown('SIGINT');
    const handleSigterm = () => gracefulShutdown('SIGTERM');
    const handleMessage = (msg) => {
      if (msg === 'shutdown' || (msg && msg.type === 'shutdown')) {
        gracefulShutdown('IPC_SHUTDOWN');
      }
    };
    const handleUnhandledRejection = (reason) => {
      logger.error('Unhandled Rejection:', reason instanceof Error ? reason : { message: String(reason) });
      processRef.exitCode = 1;
    };
    const handleUncaughtException = (err) => {
      logger.error('Uncaught Exception:', err);
      gracefulShutdown('UNCAUGHT_EXCEPTION').finally(() => {
        exitFn(1);
      });
    };

    processRef.on('SIGINT', handleSigint);
    processRef.on('SIGTERM', handleSigterm);
    processRef.on('message', handleMessage);
    processRef.on('unhandledRejection', handleUnhandledRejection);
    processRef.on('uncaughtException', handleUncaughtException);

    return () => {
      processRef.removeListener('SIGINT', handleSigint);
      processRef.removeListener('SIGTERM', handleSigterm);
      processRef.removeListener('message', handleMessage);
      processRef.removeListener('unhandledRejection', handleUnhandledRejection);
      processRef.removeListener('uncaughtException', handleUncaughtException);
    };
  }

  return {
    connections,
    isShuttingDown: () => isShuttingDown,
    gracefulShutdown,
    attachProcessHandlers
  };
}
