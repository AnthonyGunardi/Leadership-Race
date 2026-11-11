import { useState } from 'react';
import { useGameSetup } from '../hooks/useGameSetup.js';
import { useSimpleAdmin } from '../hooks/useSimpleAdmin.js';
import { AdminTeamSettings } from './AdminTeamSettings.jsx';
import { AdminPointSettings } from './AdminPointSettings.jsx';
import { ChallengeScoringForm } from './ChallengeScoringForm.jsx';

/** Four operator tasks share one page; existing hooks keep gameplay and persistence out of the render layer. */
export function SimpleGameWorkspace({ session, snapshot, install, reload, saved, view }) {
  const setup = useGameSetup({ session, snapshot, install, reload, currentStatus: view.status });
  const controls = useSimpleAdmin({ session, gameId: snapshot.data.game.id, view, setup });
  const [showVoidConfirm, setShowVoidConfirm] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [showFinishConfirm, setShowFinishConfirm] = useState(false);

  const canFinish = ['RUNNING', 'PAUSED'].includes(view.status) && view.turnStatus === 'READY_FOR_ROLL' && !view.disabled;

  return <>
    <div className="simple-admin-columns">
      <form className="simple-settings" aria-label="Configure teams and points" onSubmit={setup.save}>
        <AdminTeamSettings setup={setup} busy={controls.blocked} />
        <AdminPointSettings setup={setup} controls={controls} />
        {setup.editable && <div className="simple-save-actions">
          <button type="submit" disabled={!setup.canSave || controls.blocked}>Save teams and points</button>
          {setup.dirty && <span role="status">Unsaved changes exist.</span>}
          {saved && !setup.dirty && <span role="status">Teams and points saved.</span>}
        </div>}
        {setup.command.error && <div role="alert" className="auth-error">
          <p>{setup.command.error.message}</p>
          {setup.command.uncertain
            ? <button type="button" disabled={!setup.online || setup.command.pending}
              onClick={setup.command.retry}>Retry save</button>
            : <button type="button" className="secondary" onClick={setup.reloadSetup}>Reload settings</button>}
        </div>}
      </form>
      <section id="admin-position" className="simple-section simple-play" aria-labelledby="simple-position-title">
        <h2 id="simple-position-title">Pawn positions</h2>
        <ul className="simple-positions" aria-label="Team positions">
          {view.query.data?.data?.teams?.map((team) => <li key={team.id}
            aria-current={team.id === view.currentTeam?.id ? 'true' : undefined}>
            <span><strong>{team.code} · {team.name}</strong>
              {team.id === view.currentTeam?.id && <small>Active turn</small>}</span>
            <span>{team.position === 0 ? 'START' : `Cell ${team.position}`}<small>{team.totalScore} pts</small></span>
          </li>)}
        </ul>

        {view.lastTurn?.status === 'VOIDED' && view.turnStatus === 'READY_FOR_ROLL' && (
          <div className="status-banner void-banner" role="status" data-testid="void-status-banner">
            <p>
              <strong>Roll #{view.lastTurn.turnNumber} voided (VOIDED).</strong>
              {view.lastTurn.voidReason ? ` Reason: "${view.lastTurn.voidReason}".` : ''} Turn returned to team to roll dice again.
            </p>
          </div>
        )}

        {controls.editable && <>
          <p>Save teams and points, then start to enter physical dice.</p>
          <button type="button" disabled={!controls.canStart} onClick={controls.start}>
            {controls.launching ? 'Preparing game…' : 'Start game'}
          </button>
        </>}
        {view.status === 'RUNNING' && <>
          <p id="simple-dice-label">Enter physical dice for <strong>{view.currentTeam?.name}</strong>.</p>
          <div className="simple-dice" role="group" aria-labelledby="simple-dice-label">
            {[1, 2, 3, 4, 5, 6].map((number) => <button type="button" key={number} aria-label={`Dice ${number}`}
              disabled={!view.canRoll || controls.blocked} onClick={() => view.roll(number)}>{number}</button>)}
          </div>
          {view.active && !view.ownsLease && <>
            <p role="status">Dice input is in use by another browser.</p>
            <button type="button" className="secondary" disabled={view.disabled || controls.blocked}
              onClick={view.takeOver}>Use control here</button>
          </>}
          {!view.active && <button type="button" className="secondary" disabled={view.disabled || controls.blocked}
            onClick={view.acquire}>Enable dice input</button>}
        </>}
        {view.turnStatus === 'ANIMATING' && <p role="status">Token is moving. Please wait until finished.</p>}
        {view.turnStatus === 'AWAITING_RESULT' && <ChallengeScoringForm pendingResult={view.pendingResult}
          disabled={!view.canSubmitResult || controls.blocked} submitting={view.command.pending}
          onSubmit={view.submitResult} />}

        {view.canVoid && !showVoidConfirm && (
          <div className="simple-void-trigger">
            <button
              type="button"
              className="secondary void-roll-button"
              data-testid="void-roll-btn"
              disabled={!view.canVoid || controls.blocked}
              onClick={() => {
                setVoidReason('');
                setShowVoidConfirm(true);
              }}
            >
              Void Last Roll
            </button>
          </div>
        )}

        {showVoidConfirm && view.lastTurn && (
          <div className="finish-confirm-dialog void-confirm-dialog" role="dialog" aria-labelledby="void-dialog-title">
            <h3 id="void-dialog-title">Confirm Void Last Roll</h3>
            <p>
              Voiding roll #{view.lastTurn.turnNumber} for team{' '}
              <strong>{view.lastTurnTeam?.name || view.lastTurn.teamId}</strong> (Dice: {view.lastTurn.diceValue}).
            </p>
            <div className="void-turn-details">
              <p>Initial position: Cell <strong>{view.lastTurn.fromPosition === 0 ? 'START (0)' : view.lastTurn.fromPosition}</strong></p>
              <p>Current position: Cell <strong>{view.lastTurn.toPosition}</strong></p>
              <p>Turn status: <strong>{view.lastTurn.status}</strong></p>
              {view.lastTurn.awardedPoints > 0 && (
                <p className="void-points-warning">
                  Points previously awarded: <strong>+{view.lastTurn.awardedPoints} pts</strong>
                  {' '}(will be compensated with a negative correction ledger entry).
                </p>
              )}
              <p>
                Team position will be{' '}
                <strong>returned to Cell {view.lastTurn.fromPosition === 0 ? 'START' : view.lastTurn.fromPosition}</strong>
                {' '}and turn will be ready to re-roll.
              </p>
            </div>
            <div className="void-reason-field">
              <label htmlFor="void-reason-input"><strong>Void reason (required):</strong></label>
              <textarea
                id="void-reason-input"
                data-testid="void-reason-input"
                rows={2}
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder="Example: Operator misentered physical dice number"
                disabled={view.command.pending}
              />
            </div>
            <div className="simple-dialog-actions">
              <button
                type="button"
                className="danger confirm-void-button"
                data-testid="confirm-void-btn"
                disabled={!voidReason.trim() || view.command.pending}
                onClick={async () => {
                  await view.voidTurn({ turnId: view.lastTurn.id, reason: voidReason });
                  setShowVoidConfirm(false);
                  setVoidReason('');
                }}
              >
                {view.command.pending ? 'Voiding...' : 'Yes, Void This Roll'}
              </button>
              <button
                type="button"
                className="secondary cancel-void-button"
                disabled={view.command.pending}
                onClick={() => {
                  setShowVoidConfirm(false);
                  setVoidReason('');
                }}
              >
                Back
              </button>
            </div>
          </div>
        )}

        {view.status === 'PAUSED' && (
          <div className="status-banner paused-banner" role="status">
            <p><strong>Game is paused (PAUSED).</strong> Turns and score entry are frozen.</p>
            <button
              type="button"
              className="secondary resume-game-btn"
              data-testid="resume-game-btn"
              disabled={view.disabled || controls.blocked}
              onClick={view.resumeGame}
            >
              Resume game
            </button>
          </div>
        )}

        {view.status === 'FINISHED' && (
          <div className="status-banner finished-banner" role="status">
            <p>
              <strong>Game finished (FINISHED).</strong> Final standings and scores are frozen.
              {' '}Reset to play again.
            </p>
            {view.finalResults?.winners && view.finalResults.winners.length > 0 && (
              <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
                {view.finalResults.winners.map((winner) => (
                  <li key={winner.teamId}>
                    🏆 <strong>{winner.name} ({winner.code})</strong> — {winner.totalScore} pts
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="simple-actions-row">
          {view.status === 'RUNNING' && view.turnStatus === 'READY_FOR_ROLL' && (
            <button
              type="button"
              className="secondary pause-game-btn"
              data-testid="pause-game-btn"
              disabled={view.disabled || controls.blocked}
              onClick={view.pauseGame}
            >
              Pause game
            </button>
          )}

          {canFinish && !showFinishConfirm && (
            <button
              type="button"
              className="secondary finish-game-button"
              data-testid="finish-game-btn"
              disabled={!canFinish || controls.blocked}
              onClick={() => setShowFinishConfirm(true)}
            >
              Finish game
            </button>
          )}

          <button type="button" className="secondary simple-reload" disabled={!view.online || controls.blocked}
            onClick={view.reload}>Reload status</button>
        </div>

        {showFinishConfirm && (
          <div className="finish-confirm-dialog" role="dialog" aria-labelledby="finish-dialog-title">
            <h3 id="finish-dialog-title">Confirm Finish Game</h3>
            <p>
              This action will manually end the F1 Leadership Race game.
              Final standings and winners will be frozen based on current total scores.
            </p>
            <p><strong>Attention:</strong> This action cannot be undone (game cannot be reopened).</p>
            <div className="simple-dialog-actions">
              <button
                type="button"
                className="danger confirm-finish-btn"
                data-testid="confirm-finish-btn"
                disabled={view.command.pending}
                onClick={async () => {
                  await view.finishGame();
                  setShowFinishConfirm(false);
                }}
              >
                {view.command.pending ? 'Finishing...' : 'Yes, Finish Game'}
              </button>
              <button
                type="button"
                className="secondary cancel-finish-btn"
                disabled={view.command.pending}
                onClick={() => setShowFinishConfirm(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {view.command.pending && <p role="status">Saving changes…</p>}
        {view.command.error && <p role="alert" className="auth-error">{view.command.error.message}</p>}
        {view.command.uncertain && <button type="button" disabled={!view.online || view.command.pending}
          onClick={view.command.retry}>Retry same input</button>}
        {controls.command.error && <p role="alert" className="auth-error">{controls.command.error.message}</p>}
        {controls.command.uncertain && <button type="button" disabled={!view.online || controls.launching}
          onClick={controls.retry}>Retry same action</button>}
      </section>
    </div>
    <section id="admin-reset" className="simple-section simple-reset" aria-labelledby="simple-reset-title">
      <div><h2 id="simple-reset-title">Reset game</h2>
        <p>Scores, pawn positions, and turns reset to start. Saved teams and points remain;
          history is archived.</p></div>
      <button type="button" className="danger" disabled={!controls.canReset} onClick={controls.reset}>Reset game</button>
    </section>
  </>;
}
