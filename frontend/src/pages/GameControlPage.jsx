import { useState } from 'react';
import { useParams } from 'react-router';
import { AdminPage } from '../components/AdminPage.jsx';
import { useControllerLease } from '../hooks/useControllerLease.js';
import { ChallengeScoringForm } from '../components/ChallengeScoringForm.jsx';
import { LeaderboardPanel } from '../components/LeaderboardPanel.jsx';
import './gameSetup.css';

/** Lease controls remain available independently from the movement/result form added in later groups. */
export function GameControlPage({ session }) {
  const { id } = useParams();
  const view = useControllerLease(session, id);
  const [showFinishConfirm, setShowFinishConfirm] = useState(false);
  const [showVoidConfirm, setShowVoidConfirm] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const canFinish = ['RUNNING', 'PAUSED'].includes(view.status) && view.turnStatus === 'READY_FOR_ROLL' && !view.disabled;

  return <AdminPage title="Game Control" gameId={id} session={session} className="control-page"
    subtitle={view.query.data?.data?.game?.name || 'Manage turns, enter physical dice, and record points outcome.'}>
    {!view.online && <p role="status">Connection lost. Controls are disabled until server status is confirmed.</p>}
    {view.query.isPending && <p role="status">Loading controller status…</p>}
    {view.query.isError && <p role="alert">{view.query.error.message}</p>}

    {view.status === 'PAUSED' && (
      <div className="status-banner paused-banner" role="status">
        <p><strong>Game is paused.</strong> Turns and score entry are frozen.</p>
      </div>
    )}

    {view.status === 'FINISHED' && (
      <div className="status-banner finished-banner" role="status">
        <p><strong>Game finished (FINISHED).</strong> Final standings and scores are frozen.</p>
      </div>
    )}

    <div className="control-layout">
      <div className="control-primary">
        {view.query.isSuccess && view.allowed && view.status !== 'FINISHED' && <section className="launch-controls movement-controls" aria-labelledby="movement-heading">
          <h2 id="movement-heading">Turns & Physical Dice</h2>
          <p role="status" className="active-turn-summary">Active team: <strong>{view.currentTeam ? `${view.currentTeam.name} (${view.currentTeam.code})` : '—'}</strong> | Position: <strong>{view.currentTeam?.position ?? 0}</strong></p>
          <p>Turn status: <strong data-testid="turn-status">{view.turnStatus}</strong></p>

          {view.lastTurn?.status === 'VOIDED' && view.turnStatus === 'READY_FOR_ROLL' && (
            <div className="status-banner void-banner" role="status" data-testid="void-status-banner">
              <p>
                <strong>Roll #{view.lastTurn.turnNumber} voided (VOIDED).</strong>
                {view.lastTurn.voidReason ? ` Reason: "${view.lastTurn.voidReason}".` : ''} Turn returned to team to roll dice again.
              </p>
            </div>
          )}

          {view.ownsLease && view.status === 'RUNNING' && view.turnStatus === 'READY_FOR_ROLL' && <div>
            <p id="dice-label">Enter physical dice number (1–6):</p>
            <div className="dice-buttons" role="group" aria-labelledby="dice-label">
              {[1, 2, 3, 4, 5, 6].map((num) => (
                <button key={num} type="button" disabled={!view.canRoll} onClick={() => view.roll(num)}
                  aria-label={`Dice ${num}`}>
                  {num}
                </button>
              ))}
            </div>
          </div>}
          {view.turnStatus === 'ANIMATING' && <div role="status" aria-live="polite">
            <p>Token is moving on screen...</p>
            {view.activeMovement && <p>
          Dice: {view.turn?.diceValue} | Path: {view.activeMovement.fullPath.join(' → ')} | Final position: {view.activeMovement.finalPosition}
            </p>}
          </div>}
          {view.turnStatus === 'AWAITING_RESULT' && (
            <ChallengeScoringForm
              pendingResult={view.pendingResult}
              disabled={!view.canSubmitResult}
              submitting={view.command.pending}
              onSubmit={view.submitResult}
              onReload={view.reload}
              error={view.command.error}
            />
          )}
          {!view.ownsLease && <p>Acquire or Take Over controller to enter dice.</p>}

          {view.canVoid && !showVoidConfirm && (
            <div className="row-actions void-trigger" style={{ marginTop: '1.25rem' }}>
              <button
                type="button"
                className="secondary void-roll-button"
                disabled={!view.canVoid || view.command.pending}
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
            You will void the last roll (Turn #{view.lastTurn.turnNumber}).
            This action is permanent and will return the turn to the team to roll dice again.
              </p>
              <div className="void-turn-details">
                <p><strong>Team:</strong> {view.lastTurnTeam ? `${view.lastTurnTeam.name} (${view.lastTurnTeam.code})` : '—'}</p>
                <p><strong>Dice Value:</strong> {view.lastTurn.diceValue}</p>
                <p>
                  <strong>Current position:</strong> {view.lastTurn.finalPosition}
                  {' → '}
                  <strong>Restored position:</strong> {view.lastTurn.from}
                </p>
                <p><strong>Compensated points:</strong> {view.lastTurn.awardedPoints ?? 0} pts</p>
              </div>
              <div className="void-reason-field">
                <label htmlFor="void-reason-input">
                  <strong>Void reason (required):</strong>
                </label>
                <textarea
                  id="void-reason-input"
                  rows={3}
                  value={voidReason}
                  onChange={(e) => setVoidReason(e.target.value)}
                  placeholder="Example: Physical dice entered incorrectly, should be 2"
                  disabled={view.command.pending}
                />
              </div>
              <div className="row-actions">
                <button
                  type="button"
                  className="danger"
                  disabled={!voidReason.trim() || view.command.pending}
                  onClick={() => {
                    view.voidTurn({
                      turnId: view.lastTurn.id,
                      reason: voidReason.trim()
                    });
                    setShowVoidConfirm(false);
                  }}
                >
              Confirm Void Roll
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={view.command.pending}
                  onClick={() => setShowVoidConfirm(false)}
                >
              Cancel
                </button>
              </div>
            </div>
          )}
        </section>}
        {view.query.isSuccess && view.status !== 'FINISHED' && <section className="launch-controls controller-controls" aria-labelledby="controller-heading">
          <h2 id="controller-heading">Active Controller</h2>
          {!view.allowed && <p>Start game from setup to activate controller.</p>}
          <p role="status">{view.active ? <>Active controller: <strong>{view.holder}</strong></> : 'No active controller yet.'}</p>
          {view.active && <p>Lease remaining <span role="timer" aria-label="Remaining lease">{view.remainingSeconds} seconds</span>.</p>}
          <div className="row-actions">
            <button type="button" disabled={view.disabled || view.active} onClick={view.acquire}>Acquire controller</button>
            <button type="button" className="secondary" disabled={view.disabled || !view.active || view.ownsLease}
              onClick={view.takeOver}>Take Over</button>
          </div>
          <details className="controller-help"><summary>About browser control</summary>
            {view.ownsLease && <p>Control is on this browser.
              30-second lease is automatically extended every 10 seconds.</p>}
            <p>Closing page or losing connection lets lease expire. Page reload requires acquire
        after expiry or confirmed Take Over.</p>
          </details>
        </section>}
        {view.query.isSuccess && (
          <section className="launch-controls lifecycle-controls" aria-labelledby="lifecycle-heading">
            <h2 id="lifecycle-heading">Game Status & Controls</h2>
            <p>Current game status: <strong data-testid="game-status">{view.status}</strong></p>
            <div className="row-actions">
              {view.status === 'RUNNING' && (
                <button
                  type="button"
                  className="secondary"
                  disabled={view.disabled || view.turnStatus === 'ANIMATING'}
                  onClick={view.pauseGame}
                >
              Pause Race
                </button>
              )}
              {view.status === 'PAUSED' && (
                <button
                  type="button"
                  disabled={view.disabled}
                  onClick={view.resumeGame}
                >
              Resume Race
                </button>
              )}
              {['RUNNING', 'PAUSED'].includes(view.status) && !showFinishConfirm && (
                <button
                  type="button"
                  className="danger"
                  disabled={view.disabled}
                  onClick={() => setShowFinishConfirm(true)}
                >
              Finish Game
                </button>
              )}
            </div>

            {showFinishConfirm && (
              <div className="finish-confirm-dialog" role="dialog" aria-labelledby="finish-dialog-title">
                <h3 id="finish-dialog-title">Confirm Game Finish</h3>
                <p>
              Are you sure you want to finish this race?
              Once finished, status becomes <strong>FINISHED</strong> and cannot be reopened or edited.
                </p>
                {view.turnStatus !== 'READY_FOR_ROLL' && (
                  <p role="alert" className="error-text">
                Warning: There is still an unfinished turn (status: {view.turnStatus}).
                Finish turn or input score first.
                  </p>
                )}
                <div className="row-actions">
                  <button
                    type="button"
                    disabled={!canFinish}
                    onClick={() => {
                      setShowFinishConfirm(false);
                      view.finishGame();
                    }}
                  >
                Yes, Finish Game Now
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setShowFinishConfirm(false)}
                  >
                Cancel
                  </button>
                </div>
              </div>
            )}

            {view.status === 'FINISHED' && view.finalResults?.winners && (
              <div className="final-winners-summary">
                <h3>Race Winners</h3>
                <ul>
                  {view.finalResults.winners.map((winner) => (
                    <li key={winner.teamId}>
                  🏆 <strong>{winner.name} ({winner.code})</strong> — Total Score: {winner.totalScore} pts
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {view.command.pending && <p role="status">Saving changes…</p>}
        {view.command.error && <p role="alert">{view.command.error.message}</p>}
        {view.command.uncertain && <button type="button" disabled={!view.online || view.command.pending}
          onClick={view.command.retry}>Retry same action</button>}
        <button type="button" className="secondary" disabled={!view.online || view.query.isFetching || view.command.pending}
          onClick={view.reload}>Reload status</button>
      </div>
      <aside className="control-sidebar" aria-label="Game standings">
        {view.query.isSuccess && (
          <LeaderboardPanel
            leaderboard={view.leaderboard}
            activeTeamId={view.currentTeam?.id}
          />
        )}
      </aside>
    </div>
  </AdminPage>;
}
