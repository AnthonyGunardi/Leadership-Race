import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { publicGameRequest } from '../services/games.js';
import { useGameCommand, useGameConnectivity } from './useGames.js';

/** Initial setup claims the single operational game; the workspace owns subsequent commands. */
export function useSingleGame(session) {
  const queryClient = useQueryClient();
  const online = useGameConnectivity();
  const query = useQuery({
    queryKey: ['public-game'],
    queryFn: ({ signal }) => publicGameRequest({ path: '/game', signal }),
    retry: (failureCount, error) => error?.status !== 401 && error?.status !== 403 && failureCount < 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 5000),
    refetchInterval: 2000
  });
  const onSuccess = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['public-game'] });
    queryClient.invalidateQueries({ queryKey: ['game-archives'] });
  }, [queryClient]);
  const command = useGameCommand(session, onSuccess);
  const game = query.data?.data?.game;
  const disabled = !online || command.pending || command.uncertain || query.isError;

  /** Only the first setup creates a game; concurrent attempts return the already claimed singleton. */
  function create(event) {
    event.preventDefault();
    if (!disabled) command.execute({ path: '/current', method: 'POST', body: { name: 'F1 Leadership Race' } });
  }
  return { query, game, create, command, online, disabled };
}
