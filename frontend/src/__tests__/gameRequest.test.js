import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gameRequest } from '../services/games.js';

describe('gameRequest clock compensation & anchor calculation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('subtracts server durationMs from RTT to prevent clock overshoot into future', async () => {
    const t0 = 1000;
    const serverTimestampStr = '2026-11-13T10:00:00.000Z';
    const serverTimeMs = Date.parse(serverTimestampStr);

    let callCount = 0;
    vi.spyOn(globalThis.performance, 'now').mockImplementation(() => {
      callCount += 1;
      // tFetchStart = 1000, tFetchEnd = 1500 (total RTT = 500ms)
      return callCount === 1 ? t0 : t0 + 500;
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: { game: { id: 'g1' } },
        meta: {
          serverTime: serverTimestampStr,
          durationMs: 460 // Server took 460ms to query DB and build JSON
        }
      }),
      headers: {
        get: () => 'total;dur=460'
      }
    });

    const res = await gameRequest({ path: '/current' });

    // RTT = 500ms, durationMs = 460ms -> networkRtt = 40ms -> downlink = 20ms
    // If naive rtt/2 was used, anchor would be serverTimeMs + 250ms (+230ms overshoot!)
    // With fix: anchor is serverTimeMs + 20ms
    expect(res.meta.anchor).toBeDefined();
    expect(res.meta.anchor.serverTimeAtRecvMs).toBe(serverTimeMs + 20);
    expect(res.meta.anchor.localMonotonicRecvMs).toBe(1500);
  });

  it('falls back to Server-Timing header if meta.durationMs is not provided', async () => {
    const t0 = 2000;
    const serverTimestampStr = '2026-11-13T10:00:00.000Z';
    const serverTimeMs = Date.parse(serverTimestampStr);

    let callCount = 0;
    vi.spyOn(globalThis.performance, 'now').mockImplementation(() => {
      callCount += 1;
      return callCount === 1 ? t0 : t0 + 300; // total RTT = 300ms
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: { game: { id: 'g1' } },
        meta: {
          serverTime: serverTimestampStr
        }
      }),
      headers: {
        get: (name) => (name === 'Server-Timing' ? 'total;dur=200' : null)
      }
    });

    const res = await gameRequest({ path: '/current' });

    // RTT = 300ms, Server-Timing = 200ms -> networkRtt = 100ms -> downlink = 50ms
    expect(res.meta.anchor.serverTimeAtRecvMs).toBe(serverTimeMs + 50);
  });
});

