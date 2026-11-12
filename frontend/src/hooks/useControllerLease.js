import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { gameRequest } from '../services/games.js';
import { useGameCommand, useGameConnectivity } from './useGames.js';

/**
 * Only this mounted session holds its lease token; query caches, URLs and browser storage contain no credential.
 * Polling observes other controllers, while heartbeat uses a fresh idempotent intent every ten seconds.
 * A monotonic estimate of server time prevents a misconfigured client clock from extending UI control rights.
 */
export function useControllerLease(session, gameId, { autoAcquire = false } = {}) {
  const token = useRef(null);
  const [credentialVersion, setCredentialVersion] = useState(null);
  const [monotonicNow, setMonotonicNow] = useState(() => globalThis.performance.now());
  const online = useGameConnectivity();
  const query = useQuery({
    queryKey: ['controller', session.user.id, gameId],
    retry: (failureCount, error) => error?.status !== 401 && error?.status !== 403 && failureCount < 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 5000),
    refetchInterval: (currentQuery) => (currentQuery.state.data?.data?.turnStatus === 'ANIMATING' ? 1000 : 5000),
    refetchIntervalInBackground: true, refetchOnWindowFocus: true,
    queryFn: async ({ signal }) => ({
      ...await gameRequest({ accessToken: session.accessToken, path: `/${gameId}/snapshot`, signal }),
      receivedAt: globalThis.performance.now()
    })
  });
  const reload = query.refetch;
  const onSuccess = useCallback((result) => {
    if (result.data?.controllerLeaseToken) token.current = result.data.controllerLeaseToken;
    if (result.data?.controller?.version) setCredentialVersion(result.data.controller.version);
    reload();
  }, [reload]);
  const command = useGameCommand(session, onSuccess);
  const execute = command.execute;
  const autoAttempt = useRef(null);
  const controller = query.data?.data?.controller;
  const estimatedServerTime = Date.parse(query.data?.meta?.serverTime)
    + Math.max(0, monotonicNow - (query.data?.receivedAt ?? monotonicNow));
  const remainingSeconds = controller?.expiresAt
    ? Math.max(0, Math.ceil((Date.parse(controller.expiresAt) - estimatedServerTime) / 1000)) : 0;
  const active = Boolean(controller?.holderUserId && remainingSeconds > 0);
  const ownsLease = active && controller.holderUserId === session.user.id && credentialVersion !== null
    && controller.version === credentialVersion && command.error?.code !== 'CONTROLLER_NOT_HELD';
  const status = query.data?.data?.game?.status;
  const allowed = ['RUNNING', 'PAUSED'].includes(status);
  const disabled = !online || !query.isSuccess || query.isFetching || !allowed || command.pending || command.uncertain;

  useEffect(() => {
    const interval = window.setInterval(() => setMonotonicNow(globalThis.performance.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);
  useEffect(() => {
    if (!ownsLease || !online || !allowed || command.uncertain || command.error) return;
    const interval = window.setInterval(() => execute({
      path: `/${gameId}/controller/heartbeat`, method: 'POST', body: { controllerLeaseToken: token.current }
    }), 10000);
    return () => window.clearInterval(interval);
  }, [ownsLease, online, allowed, command.uncertain, command.error, execute, gameId]);
  useEffect(() => {
    if (command.error?.status === 409) reload();
  }, [command.error, reload]);
  useEffect(() => {
    const version = query.data?.meta?.stateVersion;
    if (!autoAcquire || disabled || active || status !== 'RUNNING' || command.error
      || autoAttempt.current === version) return;
    autoAttempt.current = version;
    execute({ path: `/${gameId}/controller/acquire`, method: 'POST', body: { expectedStateVersion: version } });
  }, [autoAcquire, disabled, active, status, command.error, query.data?.meta?.stateVersion, execute, gameId]);

  /** A failed command never silently becomes a new intent against the freshly fetched state. */
  function acquire() {
    if (disabled || active) return;
    command.execute({
      path: `/${gameId}/controller/acquire`, method: 'POST', body: {
        expectedStateVersion: query.data.meta.stateVersion
      }
    });
  }
  /** Confirmation names the observed holder; a concurrent change is still rejected by the server's version check. */
  function takeOver() {
    if (disabled || !active || ownsLease) return;
    if (!window.confirm(`Ambil alih controller dari admin ${controller.holderUserId}? Kontrol browser sebelumnya akan dicabut.`)) {
      return;
    }
    command.execute({
      path: `/${gameId}/controller/take-over`, method: 'POST', body: {
        expectedStateVersion: query.data.meta.stateVersion, confirmed: true
      }
    });
  }

  const turnStatus = query.data?.data?.turnStatus ?? 'READY_FOR_ROLL';
  const teams = query.data?.data?.teams ?? [];
  const currentTeam = teams.find((t) => t.id === query.data?.data?.game?.currentTeamId) ?? null;
  const activeMovement = query.data?.data?.activeMovement ?? null;
  const activeMovements = query.data?.data?.activeMovements ?? (activeMovement ? [activeMovement] : []);
  const turn = query.data?.data?.turn ?? null;
  const pendingResults = query.data?.data?.pendingResults
    ?? (query.data?.data?.pendingResult ? [query.data.data.pendingResult] : []);
  const pendingResult = pendingResults[0] ?? query.data?.data?.pendingResult ?? null;

  const pendingTeamIds = new Set(pendingResults.map((p) => p.teamId));
  const animatingTeamIds = new Set(activeMovements.map((m) => m.teamId));

  const canRollAny = ownsLease && status === 'RUNNING' && !disabled;
  const canRollTeam = (teamId) => canRollAny && !pendingTeamIds.has(teamId) && !animatingTeamIds.has(teamId);
  const canRoll = canRollAny && (currentTeam ? canRollTeam(currentTeam.id) : true);

  /** Physical dice input (1-6) committed atomically with pure engine movement calculation. */
  function roll(diceOrObj, maybeTeamId) {
    if (!canRollAny) return;
    const diceValue = typeof diceOrObj === 'object' && diceOrObj !== null ? diceOrObj.diceValue : diceOrObj;
    const targetTeamId = typeof diceOrObj === 'object' && diceOrObj !== null
      ? diceOrObj.teamId
      : (maybeTeamId || currentTeam?.id);

    command.execute({
      path: `/${gameId}/turns/roll`,
      method: 'POST',
      body: {
        diceValue,
        ...(targetTeamId ? { teamId: targetTeamId } : {}),
        expectedStateVersion: query.data.meta.stateVersion,
        expectedTurnNumber: (query.data?.data?.game?.turnNumber ?? 0) + 1,
        controllerLeaseToken: token.current
      }
    });
  }

  const leaderboard = query.data?.data?.leaderboard ?? [];
  const finalResults = query.data?.data?.finalResults ?? null;
  const canSubmitResult = allowed && status === 'RUNNING' && !disabled && (pendingResults.length > 0 || Boolean(pendingResult));

  /** Submits challenge scoring result (BUTTON or MANUAL) for an awaiting turn. */
  function submitResult({ turnId: targetTurnId, scoringMethod = 'BUTTON', outcome, points, note }) {
    const effectiveTurnId = targetTurnId || pendingResult?.turnId || turn?.id;
    if (!canSubmitResult || !effectiveTurnId) return;
    command.execute({
      path: `/${gameId}/turns/${effectiveTurnId}/result`,
      method: 'POST',
      body: {
        scoringMethod,
        ...(outcome ? { outcome } : {}),
        ...(points !== undefined ? { points } : {}),
        ...(note ? { note } : {}),
        expectedStateVersion: query.data.meta.stateVersion
      }
    });
  }

  /** Pauses the running game; uncompleted turn/result remains preserved. */
  function pauseGame() {
    if (!online || command.pending || status !== 'RUNNING') return;
    command.execute({
      path: `/${gameId}/pause`,
      method: 'POST',
      body: {
        expectedStateVersion: query.data.meta.stateVersion
      }
    });
  }

  /** Resumes the paused game back to RUNNING. */
  function resumeGame() {
    if (!online || command.pending || status !== 'PAUSED') return;
    command.execute({
      path: `/${gameId}/resume`,
      method: 'POST',
      body: {
        expectedStateVersion: query.data.meta.stateVersion
      }
    });
  }

  /** Finishes the game manually with explicit confirmation. */
  function finishGame() {
    if (!online || command.pending || !['RUNNING', 'PAUSED'].includes(status)) return;
    command.execute({
      path: `/${gameId}/finish`,
      method: 'POST',
      body: {
        expectedStateVersion: query.data.meta.stateVersion,
        confirmed: true
      }
    });
  }

  const lastTurn = query.data?.data?.lastTurn ?? null;
  const lastTurnTeam = lastTurn ? query.data?.data?.teams?.find((t) => t.id === lastTurn.teamId) : null;
  const canVoid = allowed && turnStatus !== 'ANIMATING' && !disabled && Boolean(lastTurn)
    && lastTurn.status !== 'VOIDED' && ['AWAITING_RESULT', 'COMPLETED'].includes(lastTurn.status);

  /** Voids the latest eligible committed roll (R-05–R-07, R-12; SPEC §4.6). */
  function voidTurn({ turnId, reason }) {
    if (!turnId || !reason?.trim() || disabled) return;
    command.execute({
      path: `/${gameId}/turns/${turnId}/void`,
      method: 'POST',
      body: {
        expectedStateVersion: query.data.meta.stateVersion,
        reason: reason.trim(),
        confirmed: true
      }
    });
  }

  return {
    query, command, online, allowed, status, active, ownsLease, disabled, remainingSeconds,
    holder: ownsLease ? 'Anda' : controller?.holderUserId, acquire, takeOver, reload,
    setupPath: `/admin/games/${gameId}/setup`,
    turnStatus, currentTeam, activeMovement, activeMovements, turn, canRoll, canRollAny, canRollTeam, roll,
    pendingResult, pendingResults, leaderboard, canSubmitResult, submitResult,
    pauseGame, resumeGame, finishGame, finalResults,
    lastTurn, lastTurnTeam, canVoid, voidTurn
  };
}
