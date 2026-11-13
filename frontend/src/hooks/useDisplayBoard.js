import { useEffect, useRef, useState } from 'react';
import { createDisplayConnection } from '../services/displayConnection.js';
import { buildBoardView } from '../services/boardView.js';
import { useMovementTimeline } from './useMovementTimeline.js';
import { useQuery } from '@tanstack/react-query';
import { publicGameRequest } from '../services/games.js';

const initialBoard = { data: { game: { id: null, name: 'F1 Leadership Race', status: 'DRAFT' },
  teams: [], boardCells: [], leaderboard: [] } };

/**
 * Each route owns one subscription.
 * Integrates movement timeline for step-by-step visual motion.
 */
export function useDisplayBoard() {
  const current = useQuery({
    queryKey: ['public-game'],
    queryFn: ({ signal }) => publicGameRequest({ path: '/game', signal }),
    retry: (failureCount, error) => error?.status !== 401 && error?.status !== 403 && failureCount < 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 5000),
    refetchInterval: 2000
  });
  const subscribedGameId = current.data?.data?.game?.id;
  const [state, setState] = useState({ snapshot: null, status: 'connecting', error: null });
  const connection = useRef(null);

  useEffect(() => {
    if (!subscribedGameId) return;
    const instance = createDisplayConnection({ gameId: subscribedGameId, onState: setState });
    connection.current = instance;
    return () => {
      instance.stop();
      connection.current = null;
    };
  }, [subscribedGameId]);

  const confirmed = state.snapshot && state.snapshot.data?.game?.id === subscribedGameId ? state.snapshot : null;
  const polled = current.data;
  const snapshot = polled && (!confirmed || polled.meta.eventSequence > confirmed.meta.eventSequence)
    ? polled
    : confirmed || initialBoard;
  const activeMovement = snapshot?.data?.activeMovement || null;
  const serverTime = snapshot?.meta?.serverTime || null;
  const anchor = snapshot?.meta?.anchor || null;

  const timeline = useMovementTimeline({ activeMovement, serverTime, anchor });
  const view = buildBoardView(snapshot, timeline);
  let status = state.status;
  if (current.isError) {
    status = 'disconnected';
  } else if (!subscribedGameId && current.isSuccess) {
    status = 'connected';
  } else if (state.status === 'connected' || (current.isSuccess && polled?.data?.game?.id === subscribedGameId)) {
    status = 'connected';
  }

  return {
    ...state,
    snapshot,
    status,
    view,
    retry: () => { current.refetch(); connection.current?.retry(); }
  };
}
