import { useState } from 'react';
import { useParams } from 'react-router';
import { AdminPage } from '../components/AdminPage.jsx';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { gameRequest, downloadGameCsv } from '../services/games.js';
import './gameSetup.css';

/**
 * GameHistoryPage displays turn history, score ledger entries, and audit logs with score correction tools.
 *
 * Requirements:
 * - Read-only view of past turns, score ledger deltas, and audit actions with filtering by team and category.
 * - Authoritative score correction form with reason, delta points, team selection, and confirmation.
 * - Client enforces non-negative score preview before submitting mutation with Idempotency-Key
 *   and expectedStateVersion.
 *
 * @param {object} props Component properties.
 * @param {object} props.session Admin session.
 * @returns {import('react').ReactElement}
 */
export function GameHistoryPage({ session }) {
  const { id } = useParams();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState('all');
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [showCorrectionForm, setShowCorrectionForm] = useState(false);

  // Correction form state
  const [correctionTeamId, setCorrectionTeamId] = useState('');
  const [deltaPoints, setDeltaPoints] = useState('');
  const [reason, setReason] = useState('');
  const [compensatesEntryId, setCompensatesEntryId] = useState('');
  const [referencedTurnId, setReferencedTurnId] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [correctionError, setCorrectionError] = useState(null);
  const [correctionSuccess, setCorrectionSuccess] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(null);

  const handleExportCsv = async () => {
    try {
      setExporting(true);
      setExportError(null);
      await downloadGameCsv({
        accessToken: session.accessToken,
        gameId: id,
        scope: activeTab === 'all' ? 'all' : (activeTab === 'turns' ? 'turns' : 'ledger'),
        teamId: selectedTeamId || undefined
      });
    } catch (err) {
      setExportError(err.message || 'Failed to download CSV.');
    } finally {
      setExporting(false);
    }
  };

  const queryKey = ['gameHistory', id, activeTab, selectedTeamId];
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const params = new globalThis.URLSearchParams();
      if (activeTab !== 'all') params.set('type', activeTab);
      if (selectedTeamId) params.set('teamId', selectedTeamId);
      const queryString = params.toString() ? `?${params.toString()}` : '';

      const response = await gameRequest({
        accessToken: session.accessToken,
        path: `/${id}/history${queryString}`,
        signal
      });
      return response.data;
    },
    refetchInterval: 10000
  });

  const mutation = useMutation({
    mutationFn: async (payload) => {
      const key = globalThis.crypto.randomUUID();
      const response = await gameRequest({
        accessToken: session.accessToken,
        path: `/${id}/corrections`,
        method: 'POST',
        key,
        body: payload
      });
      return response;
    },
    onSuccess: (data) => {
      setCorrectionSuccess(
        `Correction successfully applied! New team score: ${data?.data?.newTotalScore ?? '—'} pts.`
      );
      setCorrectionError(null);
      setDeltaPoints('');
      setReason('');
      setCompensatesEntryId('');
      setReferencedTurnId('');
      setConfirmed(false);
      setShowCorrectionForm(false);
      queryClient.invalidateQueries({ queryKey: ['gameHistory', id] });
      queryClient.invalidateQueries({ queryKey: ['scoreboard', id] });
    },
    onError: (err) => {
      setCorrectionError(err.message || 'Failed to apply score correction.');
      setCorrectionSuccess(null);
    }
  });

  const data = query.data;
  const game = data?.game;
  const teams = data?.teams ?? [];
  const turns = data?.turns ?? [];
  const scoreLedger = data?.scoreLedger ?? [];
  const auditLogs = data?.auditLogs ?? [];

  const targetTeam = teams.find((t) => t.id === correctionTeamId);
  const parsedDelta = Number.parseInt(deltaPoints, 10);
  const isValidDelta = !Number.isNaN(parsedDelta) && parsedDelta !== 0;
  const currentScore = targetTeam ? targetTeam.totalScore : 0;
  const projectedScore = isValidDelta ? currentScore + parsedDelta : currentScore;
  const isBelowZero = projectedScore < 0;

  const canSubmitCorrection =
    Boolean(correctionTeamId) &&
    isValidDelta &&
    !isBelowZero &&
    reason.trim().length >= 3 &&
    confirmed &&
    !mutation.isPending;

  const handleCorrectionSubmit = (e) => {
    e.preventDefault();
    if (!canSubmitCorrection) return;

    setCorrectionError(null);
    setCorrectionSuccess(null);

    mutation.mutate({
      teamId: correctionTeamId,
      deltaPoints: parsedDelta,
      reason: reason.trim(),
      confirmed: true,
      expectedStateVersion: game?.stateVersion ?? 0,
      ...(compensatesEntryId ? { compensatesEntryId } : {}),
      ...(referencedTurnId ? { turnId: referencedTurnId } : {})
    });
  };

  return (
    <AdminPage title="Game History & Audit" gameId={id} session={session} className="history-page"
      subtitle="Track turns, score adjustments, and audit trail." status={game?.status}>

      {query.isPending && <p role="status">Loading game history…</p>}
      {query.isError && <p role="alert" className="error-text">{query.error.message}</p>}
      {game?.isArchived && <p role="status">Game archive · read-only. Scores and history for this session are preserved.</p>}

      {query.isSuccess && (
        <>
          <section className="launch-controls history-header-section">
            <h2>{game?.name}</h2>
            <p>
              Status: <strong data-testid="game-status">{game?.status}</strong> | Round:{' '}
              <strong>{game?.turnNumber ?? 0}</strong> | State Version:{' '}
              <strong>{game?.stateVersion ?? 0}</strong>
            </p>

            <div className="teams-score-summary">
              <h3>Current Points Standings</h3>
              <div className="team-score-chips">
                {teams.map((t) => (
                  <span
                    key={t.id}
                    className="team-score-chip"
                    style={{ borderLeftColor: t.color }}
                  >
                    <strong>{t.code}</strong> {t.name}: <em>{t.totalScore} pts</em> (Position: {t.position})
                  </span>
                ))}
              </div>
            </div>

            <div className="row-actions" style={{ marginTop: '1rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              {!game?.isArchived && ['RUNNING', 'PAUSED'].includes(game?.status) && !showCorrectionForm && (
                <button
                  type="button"
                  data-testid="toggle-correction-form-btn"
                  onClick={() => {
                    setShowCorrectionForm(true);
                    setCorrectionError(null);
                    setCorrectionSuccess(null);
                  }}
                >
                  + Create Score Correction
                </button>
              )}
              <button
                type="button"
                className="secondary"
                data-testid="export-csv-btn"
                disabled={exporting}
                onClick={handleExportCsv}
              >
                {exporting ? 'Downloading CSV…' : '📥 Export CSV'}
              </button>
            </div>
          </section>

          {exportError && (
            <p role="alert" className="error-text" data-testid="export-error-alert">
              {exportError}
            </p>
          )}

          {correctionSuccess && (
            <div className="status-banner success-banner" role="status" data-testid="correction-success-banner">
              <p>{correctionSuccess}</p>
            </div>
          )}

          {showCorrectionForm && (
            <section
              className="scoring-form-card correction-form-card"
              aria-labelledby="correction-heading"
              data-testid="correction-form-section"
            >
              <h3 id="correction-heading">Score Correction Form</h3>
              <p className="scoring-guidance">
                Score correction creates a new compensation entry in the score ledger and is fully audited.
                Team total score cannot be negative.
              </p>

              {correctionError && (
                <p role="alert" className="error-text" data-testid="correction-error-alert">
                  {correctionError}
                </p>
              )}

              <form onSubmit={handleCorrectionSubmit}>
                <label htmlFor="correction-team-select">
                  Select Team to Correct:
                  <select
                    id="correction-team-select"
                    data-testid="correction-team-select"
                    value={correctionTeamId}
                    onChange={(e) => {
                      setCorrectionTeamId(e.target.value);
                      setCompensatesEntryId('');
                      setReferencedTurnId('');
                    }}
                    required
                  >
                    <option value="">-- Select Team --</option>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.code} — {t.name} (Current score: {t.totalScore} pts)
                      </option>
                    ))}
                  </select>
                </label>

                <label htmlFor="correction-delta-input">
                  Point Delta (Use negative number for deduction, e.g. -10 or 15):
                  <input
                    id="correction-delta-input"
                    data-testid="correction-delta-input"
                    type="number"
                    step="1"
                    min="-1000"
                    max="1000"
                    value={deltaPoints}
                    onChange={(e) => setDeltaPoints(e.target.value)}
                    placeholder="Example: -5 or 10"
                    required
                  />
                </label>

                {Boolean(targetTeam) && isValidDelta && (
                  <div
                    className={`score-preview-box ${isBelowZero ? 'preview-error' : 'preview-valid'}`}
                    role="status"
                    data-testid="score-preview"
                  >
                    <p>
                      Team Score {targetTeam.name}: <strong>{currentScore}</strong> {' → '}{' '}
                      <strong>{projectedScore} pts</strong> ({parsedDelta > 0 ? `+${parsedDelta}` : parsedDelta})
                    </p>
                    {isBelowZero && (
                      <p className="error-text">
                        Warning: Total team score cannot be negative!
                      </p>
                    )}
                  </div>
                )}

                <label htmlFor="correction-reason-input">
                  Correction Reason (Required, min. 3 chars):
                  <textarea
                    id="correction-reason-input"
                    data-testid="correction-reason-input"
                    rows="2"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Example: Correcting points calculation for cell 26 due to manual input error"
                    required
                  />
                </label>

                {Boolean(correctionTeamId) && (
                  <div className="optional-references">
                    <label htmlFor="correction-turn-select">
                      Turn Reference (Optional, e.g. turn resulting in 0 points):
                      <select
                        id="correction-turn-select"
                        value={referencedTurnId}
                        onChange={(e) => setReferencedTurnId(e.target.value)}
                      >
                        <option value="">-- No Specific Turn Reference --</option>
                        {turns
                          .filter((t) => t.teamId === correctionTeamId)
                          .map((t) => (
                            <option key={t.id} value={t.id}>
                              Roll #{t.turnNumber} (Dice: {t.diceValue}, Position: {t.fromPosition}→{t.finalPosition}, Result: {t.challengeResult ? `${t.challengeResult.awardedPoints} pts` : '0 pts'})
                            </option>
                          ))}
                      </select>
                    </label>

                    <label htmlFor="correction-ledger-select">
                      Compensate Previous Score Ledger Entry (Optional):
                      <select
                        id="correction-ledger-select"
                        value={compensatesEntryId}
                        onChange={(e) => setCompensatesEntryId(e.target.value)}
                      >
                        <option value="">-- No Specific Row Compensation --</option>
                        {scoreLedger
                          .filter((l) => l.teamId === correctionTeamId)
                          .map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.source} ({l.deltaPoints > 0 ? `+${l.deltaPoints}` : l.deltaPoints} pts) - {l.reason || 'No reason specified'}
                            </option>
                          ))}
                      </select>
                    </label>
                  </div>
                )}

                <div className="confirm-checkbox-container" style={{ marginBlock: '1rem' }}>
                  <label htmlFor="correction-confirm-checkbox" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <input
                      id="correction-confirm-checkbox"
                      data-testid="correction-confirm-checkbox"
                      type="checkbox"
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                      required
                    />
                    I confirm that this score correction is valid and audited.
                  </label>
                </div>

                <div className="row-actions">
                  <button
                    type="submit"
                    data-testid="submit-correction-btn"
                    disabled={!canSubmitCorrection}
                  >
                    {mutation.isPending ? 'Applying Correction…' : 'Apply Score Correction'}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setShowCorrectionForm(false)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </section>
          )}

          {/* Filters & Tabs */}
          <section className="history-filter-section" aria-label="History Filter">
            <div className="filter-row">
              <div className="filter-group">
                <label htmlFor="team-filter">Filter Team:</label>
                <select
                  id="team-filter"
                  data-testid="history-team-filter"
                  value={selectedTeamId}
                  onChange={(e) => setSelectedTeamId(e.target.value)}
                >
                  <option value="">All Teams</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.code} — {t.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="tab-buttons" role="tablist" aria-label="History Categories">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'all'}
                  className={activeTab === 'all' ? 'active-tab' : 'secondary'}
                  onClick={() => setActiveTab('all')}
                >
                  All
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'turns'}
                  className={activeTab === 'turns' ? 'active-tab' : 'secondary'}
                  onClick={() => setActiveTab('turns')}
                >
                  Turns ({turns.length})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'ledger'}
                  className={activeTab === 'ledger' ? 'active-tab' : 'secondary'}
                  onClick={() => setActiveTab('ledger')}
                >
                  Score Ledger ({scoreLedger.length})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'audit'}
                  className={activeTab === 'audit' ? 'active-tab' : 'secondary'}
                  onClick={() => setActiveTab('audit')}
                >
                  Audit Trail ({auditLogs.length})
                </button>
              </div>
            </div>
          </section>

          {/* Turns Table */}
          {['all', 'turns'].includes(activeTab) && (
            <section className="history-table-section" aria-labelledby="turns-heading">
              <h3 id="turns-heading">Turn History</h3>
              {turns.length === 0 ? (
                <p>No turn history yet.</p>
              ) : (
                <div className="table-responsive">
                  <table className="history-table" data-testid="turns-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Team</th>
                        <th>Dice</th>
                        <th>Path</th>
                        <th>Score Result</th>
                        <th>Status</th>
                        <th>Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {turns.map((t) => (
                        <tr key={t.id} className={t.status === 'VOIDED' ? 'row-voided' : ''}>
                          <td><strong>#{t.turnNumber}</strong></td>
                          <td>
                            <span className="team-badge" style={{ borderColor: t.teamColor }}>
                              {t.teamCode} {t.teamName}
                            </span>
                          </td>
                          <td>{t.diceValue ?? '—'}</td>
                          <td>{t.fromPosition} → {t.finalPosition} (Cell {t.landingCell})</td>
                          <td>
                            {t.challengeResult ? (
                              <span>
                                <strong>+{t.challengeResult.awardedPoints}</strong> ({t.challengeResult.scoringMethod}
                                {t.challengeResult.outcome ? ` - ${t.challengeResult.outcome}` : ''})
                              </span>
                            ) : (
                              '0 pts'
                            )}
                          </td>
                          <td>
                            <span className={`status-pill pill-${t.status.toLowerCase()}`}>
                              {t.status}
                            </span>
                            {t.voidReason && <small className="void-reason-note"> ({t.voidReason})</small>}
                          </td>
                          <td>
                            <small>{t.createdAt ? new Date(t.createdAt).toLocaleTimeString() : '—'}</small>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {/* Score Ledger Table */}
          {['all', 'ledger'].includes(activeTab) && (
            <section className="history-table-section" aria-labelledby="ledger-heading">
              <h3 id="ledger-heading">Score Ledger</h3>
              {scoreLedger.length === 0 ? (
                <p>No score entries yet.</p>
              ) : (
                <div className="table-responsive">
                  <table className="history-table" data-testid="ledger-table">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Team</th>
                        <th>Points</th>
                        <th>Source</th>
                        <th>Reason / Notes</th>
                        <th>Actor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scoreLedger.map((l) => (
                        <tr key={l.id} className={l.source === 'CORRECTION' ? 'row-correction' : ''}>
                          <td>
                            <small>{l.createdAt ? new Date(l.createdAt).toLocaleTimeString() : '—'}</small>
                          </td>
                          <td>
                            <span className="team-badge">
                              {l.teamCode} {l.teamName}
                            </span>
                          </td>
                          <td>
                            <strong className={l.deltaPoints > 0 ? 'points-positive' : 'points-negative'}>
                              {l.deltaPoints > 0 ? `+${l.deltaPoints}` : l.deltaPoints}
                            </strong>
                          </td>
                          <td>
                            <span className={`source-pill pill-${l.source.toLowerCase()}`}>
                              {l.source}
                            </span>
                          </td>
                          <td>
                            {l.reason || '—'}
                            {l.compensatesEntryId && <small> (Entry compensation)</small>}
                          </td>
                          <td>
                            <small>{l.actorEmail || l.actorUserId || '—'}</small>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {/* Audit Logs Table */}
          {['all', 'audit'].includes(activeTab) && (
            <section className="history-table-section" aria-labelledby="audit-heading">
              <h3 id="audit-heading">Audit Trail</h3>
              {auditLogs.length === 0 ? (
                <p>No audit records yet.</p>
              ) : (
                <div className="table-responsive">
                  <table className="history-table" data-testid="audit-table">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Action</th>
                        <th>Actor</th>
                        <th>Change Summary</th>
                        <th>Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditLogs.map((a) => (
                        <tr key={a.id}>
                          <td>
                            <small>{a.occurredAt ? new Date(a.occurredAt).toLocaleTimeString() : '—'}</small>
                          </td>
                          <td>
                            <strong>{a.action}</strong>
                          </td>
                          <td>
                            <small>{a.actorEmail || a.actorUserId || a.actorType}</small>
                          </td>
                          <td>
                            <details className="audit-details">
                              <summary>View changes</summary>
                              <div className="audit-change-summary">
                                {a.before && <><strong>Before</strong>
                                  <pre>{JSON.stringify(a.before, null, 2)}</pre></>}
                                {a.after && <><strong>After</strong>
                                  <pre>{JSON.stringify(a.after, null, 2)}</pre></>}
                                {!a.before && !a.after && <p>No change details.</p>}
                              </div>
                            </details>
                          </td>
                          <td>{a.reason || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </AdminPage>
  );
}
