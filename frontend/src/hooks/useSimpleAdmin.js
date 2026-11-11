import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useGameCommand } from './useGames.js';

/** Keeps preflight/start sequential and retries the frozen failed step before proceeding to the next one. */
export function useSimpleAdmin({ session, gameId, view, setup }) {
  const queryClient = useQueryClient();
  const starting = useRef(false);
  const busy = useRef(false);
  const [launching, setLaunching] = useState(false);
  const [selectedCell, setSelectedCell] = useState('');
  const reload = view.reload;
  const onSuccess = useCallback(() => {
    reload();
    queryClient.invalidateQueries({ queryKey: ['public-game'] });
  }, [reload, queryClient]);
  const command = useGameCommand(session, onSuccess);
  const blocked = !view.online || !view.query.isSuccess || view.query.isFetching || launching
    || command.pending || command.uncertain || view.command.pending || view.command.uncertain
    || setup.command.pending || setup.command.uncertain;
  const editable = ['DRAFT', 'READY'].includes(view.status);
  const canStart = editable && !blocked && !setup.dirty && setup.teams.length >= 2;
  const canReset = !blocked && view.turnStatus !== 'ANIMATING';
  const challengeCells = setup.cells.filter((cell) => cell.category !== 'INDISIPLINER');
  const cell = challengeCells.find((item) => String(item.number) === selectedCell) ?? challengeCells[0];
  const cellIndex = setup.cells.indexOf(cell);

  /** A confirmed READY response supplies the next version; a failed/unknown response never advances the workflow. */
  async function continueStart(result) {
    if (starting.current && result?.data?.game?.status === 'READY') {
      result = await command.execute({ path: `/${gameId}/start`, method: 'POST',
        body: { expectedStateVersion: result.meta.stateVersion } });
    }
    if (result) {
      starting.current = false;
      queryClient.invalidateQueries({ queryKey: ['game', session.user.id, gameId] });
    }
  }

  /** One operator action retains both server preflight and Start guards, without a separate readiness page. */
  async function start() {
    if (!canStart || busy.current || !window.confirm('Start playing? Teams and point settings will be locked.')) return;
    busy.current = true;
    starting.current = true;
    setLaunching(true);
    try {
      const result = view.status === 'DRAFT'
        ? await command.execute({ path: `/${gameId}/validate`, method: 'POST',
          body: { expectedStateVersion: view.query.data.meta.stateVersion } })
        : view.query.data;
      await continueStart(result);
    } finally {
      busy.current = false;
      setLaunching(false);
    }
  }

  /** Retrying an uncertain validation must still complete Start; an uncertain reset must never become a new reset. */
  async function retry() {
    if (busy.current || !view.online) return;
    busy.current = true;
    setLaunching(true);
    try { await continueStart(await command.retry()); }
    finally { busy.current = false; setLaunching(false); }
  }

  /** Reset archives the current session using its confirmed server version, even when local settings are unsaved. */
  function reset() {
    if (!canReset || busy.current || !window.confirm('Reset game? Scores, positions, and turns will reset to start. '
      + 'Saved teams and points remain. Session history is saved; unsaved changes are discarded.')) return;
    starting.current = false;
    command.execute({ path: `/${gameId}/reset`, method: 'POST', body: {
      expectedStateVersion: view.query.data.meta.stateVersion, confirmed: true
    } });
  }

  return { command, blocked, editable, canStart, canReset, start, retry, reset, launching,
    challengeCells, cell, cellIndex, selectedCell: cell ? String(cell.number) : '', setSelectedCell };
}
