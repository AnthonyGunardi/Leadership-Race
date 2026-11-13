import { io } from 'socket.io-client';
import { publicGameRequest } from './games.js';
import { SOCKET_URL, SOCKET_NAMESPACE, SOCKET_PATH } from '../config/api.js';

const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const uuid = /^[a-f0-9-]{36}$/;

/** Socket data only invalidates confirmed state; a consistent server snapshot supplies all board/team configuration. */
function validEvent(event, gameId) {
  return event?.gameId === gameId && uuid.test(event.eventId) && integer(event.sequence)
    && event.sequence > 0 && integer(event.stateVersion) && typeof event.type === 'string'
    && typeof event.occurredAt === 'string' && event.payload && typeof event.payload === 'object';
}

/**
 * Listeners precede join ACK, then buffer → snapshot → contiguous gap replay → dedup.
 * G4 state_changed does not contain full setup, so new events require a snapshot covering their boundary.
 * https://socket.io/docs/v4/delivery-guarantees/
 */
export function createDisplayConnection({
  gameId,
  onState,
  request = publicGameRequest,
  socket = io(`${SOCKET_URL}${SOCKET_NAMESPACE}`, {
    path: SOCKET_PATH,
    autoConnect: false,
    withCredentials: true,
    auth: { gameId, public: true },
    reconnectionDelayMax: 5000
  })
}) {
  let stopped = false;
  let joined = false;
  let generation = 0;
  let current = null;
  let recovering = null;
  let syncing = false;
  let retryTimer;
  const buffer = new Map();
  const abort = new globalThis.AbortController();
  const call = (path, options = {}) => request({
    path: `/games/${gameId}${path}`, signal: abort.signal, ...options
  });
  function report(status, error = null) {
    if (!stopped) onState({ snapshot: current, status, error });
  }
  function failure(error) {
    if (stopped) return;
    report(error.status === 401 || error.status === 403 ? 'unauthenticated' : 'disconnected', error);
  }
  async function recover(epoch) {
    for (let attempt = 0; attempt < 3 && !stopped && epoch === generation; attempt += 1) {
      const snapshot = await call('/snapshot');
      const sequence = snapshot.meta?.eventSequence;
      const version = snapshot.meta?.stateVersion;
      if (snapshot.data?.game?.id !== gameId || !integer(sequence) || !integer(version)
        || !Array.isArray(snapshot.data.teams) || !Array.isArray(snapshot.data.boardCells)) {
        throw new Error('Invalid display snapshot.');
      }
      if (current && (sequence < current.meta.eventSequence || version < current.meta.stateVersion)) continue;
      let cursor = sequence;
      let page;
      const bufferedHighWater = Math.max(sequence, ...buffer.keys());
      if (bufferedHighWater > sequence) {
        try {
          do {
            page = await call(`/events?afterSequence=${cursor}`);
            if (!Array.isArray(page.data?.events)) throw new Error('Invalid replay events.');
            for (const event of page.data.events) {
              if (!validEvent(event, gameId) || event.sequence !== cursor + 1) {
                throw new Error('Incomplete event sequence.');
              }
              cursor = event.sequence;
            }
            if (page.meta.nextAfterSequence !== cursor || (page.meta.hasMore && page.data.events.length === 0)) {
              throw new Error('Invalid event cursor.');
            }
          } while (page.meta.hasMore && !stopped && epoch === generation);
        } catch (error) {
          if (['EVENT_HISTORY_UNAVAILABLE', 'STALE_STATE'].includes(error.code)) continue;
          throw error;
        }
        if (cursor < bufferedHighWater) continue;
      }
      if (stopped || !joined || epoch !== generation) return;
      current = snapshot;
      for (const sequence of buffer.keys()) {
        if (sequence <= current.meta.eventSequence) buffer.delete(sequence);
      }
      report('connected');
      return;
    }
    if (!stopped && epoch === generation && joined) {
      report('recovering');
      clearTimeout(retryTimer);
      retryTimer = setTimeout(scheduleRecovery, 1000);
    }
  }
  function scheduleRecovery() {
    if (stopped || !joined || recovering) return;
    const epoch = generation;
    recovering = recover(epoch).catch(failure).finally(() => {
      recovering = null;
      if (!stopped && joined && (epoch !== generation || buffer.size > 0)) {
        clearTimeout(retryTimer);
        retryTimer = setTimeout(scheduleRecovery, buffer.size > 0 ? 0 : 1000);
      }
    });
  }
  function receive(type, payload) {
    if (!type.startsWith('game:')) return;
    const event = { ...payload, type };
    if (!validEvent(event, gameId)) { scheduleRecovery(); return; }
    if (current && event.sequence <= current.meta.eventSequence) return;
    // A sequence collision or unknown schema is reconciled by a fresh authoritative snapshot.
    buffer.set(event.sequence, event);
    if (buffer.size > 500) buffer.clear();
    scheduleRecovery();
  }
  socket.onAny(receive);
  socket.on('connect', () => {
    const epoch = ++generation;
    joined = false;
    report('recovering');
    socket.timeout(5000).emit('game:join', { gameId }, (error, result) => {
      if (stopped || epoch !== generation) return;
      if (error || !result?.success) {
        failure(Object.assign(new Error('Display subscription failed.'), { code: result?.error?.code }));
        return;
      }
      joined = true;
      scheduleRecovery();
    });
  });
  socket.on('disconnect', () => { joined = false; generation += 1; report('disconnected'); });
  socket.on('connect_error', (error) => {
    failure(Object.assign(new Error('Display connection not yet available.'), {
      status: error.data?.code === 'UNAUTHENTICATED' ? 401 : 503
    }));
  });
  socket.on('session:invalidated', (error) => {
    joined = false;
    generation += 1;
    socket.disconnect();
    failure(Object.assign(new Error('Loading latest game session.'), {
      status: error.code === 'SERVICE_UNAVAILABLE' ? 503 : 401
    }));
  });
  async function sync() {
    if (stopped || syncing) return;
    syncing = true;
    try {
      await call('/snapshot');
      if (stopped) return;
      if (!socket.connected) socket.connect();
      else if (joined) scheduleRecovery();
    } catch (error) {
      if (error.status === 401 || error.status === 403) socket.disconnect();
      failure(error);
    } finally { syncing = false; }
  }
  const syncTimer = setInterval(sync, 15000);
  report('connecting');
  sync();
  return { retry: sync, stop() {
    stopped = true;
    generation += 1;
    abort.abort();
    clearInterval(syncTimer);
    clearTimeout(retryTimer);
    socket.offAny(receive);
    socket.removeAllListeners();
    socket.disconnect();
  } };
}
