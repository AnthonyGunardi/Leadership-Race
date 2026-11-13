import { Server } from 'socket.io';
import { assertValidOrigin } from '../middleware/adminAuth.js';
import { authorizeAdminAccess } from '../services/adminSessions.js';
import { getGameSnapshot } from '../services/gameSetup.js';
import { GameError } from '../services/gameCommands.js';
import { assertPublicGame } from '../services/singleGame.js';
import { createOutboxPublisher } from '../services/outboxPublisher.js';
import { socketAuthSchema, socketJoinSchema } from '../validation/gameRead.js';

/** Middleware alone is insufficient: every join, scan and outbound event rechecks the same durable REST session. */
export function createGameGateway({ server, sequelize, scanIntervalMs = 1000, publishIntervalMs = 250 }) {
  // Same-origin deployment; Origin is checked for WebSocket as well as HTTP long-polling handshakes.
  // https://socket.io/docs/v4/server-options/#allowrequest
  const io = new Server(server, { maxHttpBufferSize: 16384, serveClient: false,
    allowRequest: (request, callback) => {
      try { assertValidOrigin(request); callback(null, true); } catch { callback('Forbidden origin', false); }
    } });
  async function authorize(socket) {
    const { gameId, accessToken } = socket.data.identity;
    if (accessToken) await authorizeAdminAccess({ sequelize, accessToken });
    else await assertPublicGame({ sequelize, gameId });
  }
  function invalidate(socket, error) {
    socket.emit('session:invalidated', { code: error.status === 503 ? 'SERVICE_UNAVAILABLE' : 'UNAUTHENTICATED' });
    socket.disconnect(true);
  }
  const namespaces = [io.of('/'), io.of('/leadership-race')];
  for (const nsp of namespaces) {
    nsp.use(async (socket, next) => {
      try {
        const input = socketAuthSchema.parse(socket.handshake.auth);
        socket.data.identity = input;
        await authorize(socket);
        next();
      } catch (error) {
        const failure = new Error('Koneksi display tidak diotorisasi.');
        failure.data = { code: error.status === 503 ? 'SERVICE_UNAVAILABLE' : 'UNAUTHENTICATED' };
        next(failure);
      }
    });
    nsp.on('connection', (socket) => {
      socket.on('game:join', async (raw, ack) => {
        if (typeof ack !== 'function') return;
        try {
          const { gameId } = socketJoinSchema.parse(raw);
          if (gameId !== socket.data.identity.gameId) throw new GameError('FORBIDDEN', 'Scope game tidak sah.', 403);
          await authorize(socket);
          await getGameSnapshot({ sequelize, gameId });
          if (!socket.connected) return;
          await socket.join(`game:${gameId}`);
          ack({ success: true, data: { gameId } });
        } catch (error) {
          ack({ success: false, error: { code: error.code || 'VALIDATION_ERROR', message: 'Subscription ditolak.' } });
        }
      });
      socket.on('game:leave', () => socket.leave(`game:${socket.data.identity.gameId}`));
    });
  }
  let securityScan = null;
  const scan = setInterval(() => {
    if (securityScan) return;
    const allSockets = namespaces.flatMap((nsp) => [...nsp.sockets.values()]);
    securityScan = Promise.all(allSockets.map(async (socket) => {
      try { await authorize(socket); } catch (error) { invalidate(socket, error); }
    })).finally(() => { securityScan = null; });
  }, scanIntervalMs);
  scan.unref();
  const publisher = createOutboxPublisher({ sequelize, intervalMs: publishIntervalMs,
    publish: async (event) => {
      const room = `game:${event.gameId}`;
      const allSockets = namespaces.flatMap((nsp) => [...nsp.sockets.values()]);
      for (const socket of allSockets) {
        if (!socket.rooms.has(room)) continue;
        try { await authorize(socket); } catch (error) { invalidate(socket, error); continue; }
        // Never broadcast directly to a room: an authorization failure must prevent this outbound payload.
        if (socket.connected && socket.rooms.has(room)) {
          socket.emit(event.type, socket.data.identity.public && !socket.data.identity.accessToken
            ? { ...event, payload: {} } : event);
        }
      }
    } });
  return { io, publisher,
    async stop() {
      clearInterval(scan);
      await Promise.all([publisher.stop(), securityScan]);
      io.disconnectSockets(true);
      io.engine.close();
    } };
}
