import { expect, it, vi } from 'vitest';
import { createDisplayConnection } from '../services/displayConnection.js';

const gameId = '11111111-1111-4111-8111-111111111111';
const makeEvent = (sequence) => ({
  eventId: `11111111-1111-4111-8111-${String(sequence).padStart(12, '0')}`, gameId,
  type: 'game:state_changed', sequence, stateVersion: sequence, occurredAt: '2026-11-10T00:00:00.000Z', payload: {}
});
const snapshot = (sequence) => ({ success: true,
  data: { game: { id: gameId, name: `Confirmed ${sequence}` }, teams: [], boardCells: [] },
  meta: { eventSequence: sequence, stateVersion: sequence }
});

/** A fake network transport controls delivery timing; recovery itself runs unchanged against delayed HTTP responses. */
function transport() {
  const handlers = new Map();
  let receive;
  return { connected: false,
    on: (type, callback) => handlers.set(type, callback), onAny: (callback) => { receive = callback; },
    offAny() {}, removeAllListeners() { handlers.clear(); }, timeout() { return this; },
    emit(_type, _input, ack) { ack(null, { success: true }); },
    connect() { this.connected = true; handlers.get('connect')(); },
    disconnect() { this.connected = false; handlers.get('disconnect')?.(); },
    event(event) { receive(event.type, event); }
  };
}

it('never installs a late pre-event snapshot and reconciles duplicate/out-of-order notifications from server state', async () => {
  const socket = transport();
  const initial = Promise.withResolvers();
  const started = Promise.withResolvers();
  const states = [];
  let version = 1;
  let first = true;
  const connection = createDisplayConnection({ gameId, socket, onState: (state) => states.push(state),
    request: async ({ path }) => {
      if (path.endsWith('/snapshot')) {
        if (first) { first = false; started.resolve(); return initial.promise; }
        return snapshot(version);
      }
      const cursor = Number(new globalThis.URL(`https://example.test${path}`).searchParams.get('afterSequence'));
      const events = Array.from({ length: version - cursor }, (_, index) => makeEvent(cursor + index + 1));
      return { data: { events }, meta: { nextAfterSequence: version, hasMore: false } };
    } });
  try {
    await started.promise;
    version = 2;
    socket.event(makeEvent(2));
    initial.resolve(snapshot(1));
    await vi.waitFor(() => expect(states.at(-1).snapshot?.data.game.name).toBe('Confirmed 2'));
    expect(states.filter((state) => state.snapshot?.meta.eventSequence === 1)).toEqual([]);
    socket.event(makeEvent(2));
    version = 4;
    socket.event(makeEvent(4));
    socket.event(makeEvent(3));
    await vi.waitFor(() => expect(states.at(-1).snapshot?.meta.eventSequence).toBe(4));
    socket.disconnect();
    expect(states.at(-1).status).toBe('disconnected');
    expect(states.at(-1).snapshot.data.game.name).toBe('Confirmed 4');
  } finally { connection.stop(); }
});

it('connects a public display using GET only, without pairing or session synchronization', async () => {
  const socket = transport();
  const states = [];
  const request = vi.fn(async ({ path }) => path.includes('/events?')
    ? { data: { events: [] }, meta: { nextAfterSequence: 1, hasMore: false } } : snapshot(1));
  const connection = createDisplayConnection({ gameId, socket, request,
    onState: (state) => states.push(state) });
  try {
    await vi.waitFor(() => expect(states.at(-1).status).toBe('connected'));
    expect(states.at(-1).snapshot.data.game.id).toBe(gameId);
    expect(request.mock.calls.every(([call]) => call.path.startsWith(`/games/${gameId}/`)
      && !call.method && !call.body)).toBe(true);
    expect(request.mock.calls.some(([call]) => call.path.includes('display-session'))).toBe(false);
  } finally { connection.stop(); }
});

it('skips redundant /events call on steady-state live notification when snapshot covers sequence', async () => {
  const socket = transport();
  const states = [];
  let currentSequence = 1;
  const request = vi.fn(async ({ path }) => {
    if (path.includes('/snapshot')) {
      return snapshot(currentSequence);
    }
    return { data: { events: [] }, meta: { nextAfterSequence: currentSequence, hasMore: false } };
  });

  const connection = createDisplayConnection({
    gameId,
    socket,
    request,
    onState: (state) => states.push(state)
  });

  try {
    socket.connect();
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('connected'));
    expect(states.at(-1).snapshot.meta.eventSequence).toBe(1);

    // Initial connection fetched /snapshot only, not /events
    expect(request.mock.calls.some(([call]) => call.path.includes('/events?'))).toBe(false);

    // Live notification for sequence 2 arrives; snapshot fetched during recovery returns sequence 2
    currentSequence = 2;
    socket.event(makeEvent(2));

    await vi.waitFor(() => expect(states.at(-1)?.snapshot?.meta.eventSequence).toBe(2));

    // Because snapshot covered sequence 2 (cursor >= bufferedHighWater), /events was not called
    expect(request.mock.calls.some(([call]) => call.path.includes('/events?'))).toBe(false);
  } finally {
    connection.stop();
  }
});

