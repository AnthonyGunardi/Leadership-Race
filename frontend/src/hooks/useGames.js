import { useState, useRef, useCallback, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { gameRequest } from '../services/games.js';

/** Subscribes to browser connectivity; successful server reads remain the authority for application health. */
function subscribeConnectivity(callback) {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

/** Disables writes immediately on an observed network loss without dropping confirmed state. */
export function useGameConnectivity() {
  return useSyncExternalStore(subscribeConnectivity, () => navigator.onLine !== false);
}

/** One intent retains one key until the server confirms its outcome; rapid clicks never overlap. */
export function useGameCommand(session, onSuccess) {
  const intent = useRef(null);
  const busy = useRef(false);
  const [state, setState] = useState({ pending: false, error: null, uncertain: false });
  const execute = useCallback(async (request) => {
    if (busy.current) return;
    busy.current = true;
    if (!intent.current) intent.current = { ...request, key: globalThis.crypto.randomUUID() };
    setState({ pending: true, error: null, uncertain: false });
    try {
      const result = await gameRequest({ ...intent.current, accessToken: session.accessToken });
      intent.current = null;
      setState({ pending: false, error: null, uncertain: false });
      onSuccess(result);
      return result;
    } catch (error) {
      if (!error.unknownOutcome) intent.current = null;
      setState({ pending: false, error, uncertain: Boolean(error.unknownOutcome) });
    } finally {
      busy.current = false;
    }
  }, [session.accessToken, onSuccess]);
  return { ...state, execute, retry: () => intent.current && execute(intent.current) };
}

/** Setup does not poll/refetch in the background, so an unsaved editor cannot be silently overwritten. */
export function useGameSnapshot(session, gameId) {
  const queryClient = useQueryClient();
  const [savedGameId, setSavedGameId] = useState(null);
  const queryKey = ['game', session.user.id, gameId];
  const query = useQuery({
    queryKey, queryFn: ({ signal }) => gameRequest({
      accessToken: session.accessToken, path: `/${gameId}/snapshot`, signal
    }), retry: false, refetchOnReconnect: false, refetchOnMount: 'always'
  });
  const install = useCallback((result) => {
    queryClient.setQueryData(['game', session.user.id, gameId], result);
    queryClient.invalidateQueries({ queryKey: ['games', session.user.id] });
    queryClient.invalidateQueries({ queryKey: ['controller', session.user.id, gameId] });
    setSavedGameId(gameId);
  }, [queryClient, session.user.id, gameId]);
  return { query, install, saved: savedGameId === gameId };
}
