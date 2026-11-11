import { useState } from 'react';

const MAX_MANUAL_POINTS = 200;
const LARGE_POINTS_THRESHOLD = 50;

/**
 * Form for recording BUTTON and MANUAL challenge results during AWAITING_RESULT state.
 *
 * Requirements:
 * - Available to any authenticated Super Admin regardless of controller lease.
 * - Displays landing cell information: cell number, category, title, points, and optional instructions.
 * - Supports BUTTON (SUKSES / GAGAL) and MANUAL (point input 0-200) modes.
 * - Defaults to MANUAL for cell 26 (Origami) with unit guidance (1 unit = 5 poin)
 *   and non-blocking warning for non-multiples of 5.
 * - Gate D-03: Explicit confirmation on 0 points and large points (>50).
 * - All challenge activities take place offline; the form records authoritative points to server ledger.
 *
 * @param {object} props Component properties.
 * @param {object} props.pendingResult Pending result details from server snapshot.
 * @param {boolean} props.disabled Whether user interactions are disabled.
 * @param {boolean} props.submitting Whether mutation is in flight.
 * @param {(payload: object) => void} props.onSubmit Submission callback.
 * @param {() => void} [props.onReload] Callback to reload snapshot on conflicts.
 * @param {object} [props.error] Error object from command execution.
 * @returns {import('react').ReactElement|null}
 */
export function ChallengeScoringForm({
  pendingResult,
  disabled,
  submitting,
  onSubmit,
  onReload,
  error
}) {
  const [selectedMethod, setSelectedMethod] = useState(() => (
    pendingResult?.defaultMethod === 'MANUAL' ? 'MANUAL' : 'BUTTON'
  ));
  const [pointsInput, setPointsInput] = useState('');
  const [noteInput, setNoteInput] = useState('');
  const [prevTurnId, setPrevTurnId] = useState(pendingResult?.turnId);

  if (pendingResult && pendingResult.turnId !== prevTurnId) {
    setPrevTurnId(pendingResult.turnId);
    setSelectedMethod(pendingResult.defaultMethod === 'MANUAL' ? 'MANUAL' : 'BUTTON');
    setPointsInput('');
    setNoteInput('');
  }

  if (!pendingResult) return null;

  const {
    cellNumber,
    title,
    category,
    successPoints,
    instruction,
    durationText,
    pointsPerUnit
  } = pendingResult;

  const parsedPoints = pointsInput.trim() === '' ? NaN : Number(pointsInput);
  const isPointsInteger = Number.isInteger(parsedPoints);
  const isPointsInRange = isPointsInteger && parsedPoints >= 0 && parsedPoints <= MAX_MANUAL_POINTS;
  const isManualSubmitDisabled = disabled || submitting || !isPointsInRange;

  const isNotMultipleOfUnit = Boolean(
    pointsPerUnit && isPointsInRange && parsedPoints > 0 && parsedPoints % pointsPerUnit !== 0
  );

  function handleSuccess() {
    onSubmit({
      scoringMethod: 'BUTTON',
      outcome: 'SUCCESS',
      ...(noteInput.trim() ? { note: noteInput.trim() } : {})
    });
  }

  function handleFail() {
    onSubmit({
      scoringMethod: 'BUTTON',
      outcome: 'FAIL',
      ...(noteInput.trim() ? { note: noteInput.trim() } : {})
    });
  }

  function handleManualSubmit(e) {
    e?.preventDefault();
    if (isManualSubmitDisabled) return;

    if (parsedPoints === 0) {
      const ok = window.confirm('0 points will complete the turn without adding to team score. Continue?');
      if (!ok) return;
    } else if (parsedPoints > LARGE_POINTS_THRESHOLD) {
      const ok = window.confirm(
        `Entered points (${parsedPoints} points) is quite large (>${LARGE_POINTS_THRESHOLD}). `
        + 'Please confirm this value before saving.'
      );
      if (!ok) return;
    }

    onSubmit({
      scoringMethod: 'MANUAL',
      points: parsedPoints,
      ...(noteInput.trim() ? { note: noteInput.trim() } : {})
    });
  }

  return (
    <div className="scoring-form-card" data-testid="challenge-scoring-form">
      <h3>Activity / Challenge Result</h3>
      <div className="scoring-cell-info">
        <p>
          Cell <strong>{cellNumber}</strong>: <strong>{title}</strong>
          {' '}<span className={`cell-category-tag category-${category?.toLowerCase()}`}>({category})</span>
        </p>
        <p>Standard Points: <strong>+{successPoints} pts</strong> | Fail Points: <strong>0 pts</strong></p>
        {instruction && <p className="challenge-instruction"><em>Instruction:</em> {instruction}</p>}
        {durationText && <p className="challenge-duration"><em>Duration:</em> {durationText}</p>}
      </div>

      <div className="scoring-mode-selector" role="tablist" aria-label="Scoring Method">
        <button
          type="button"
          role="tab"
          aria-selected={selectedMethod === 'BUTTON'}
          className={`mode-tab ${selectedMethod === 'BUTTON' ? 'active' : ''}`}
          onClick={() => setSelectedMethod('BUTTON')}
          disabled={disabled || submitting}
        >
          Button (Success / Fail)
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={selectedMethod === 'MANUAL'}
          className={`mode-tab ${selectedMethod === 'MANUAL' ? 'active' : ''}`}
          onClick={() => setSelectedMethod('MANUAL')}
          disabled={disabled || submitting}
        >
          Manual Points Input
        </button>
      </div>

      {selectedMethod === 'BUTTON' ? (
        <div className="scoring-button-section">
          <p className="scoring-guidance">
            Select challenge outcome based on committee assessment.
          </p>

          <div className="scoring-buttons" role="group" aria-label="Points outcome input">
            <button
              type="button"
              className="button-success"
              disabled={disabled || submitting}
              onClick={handleSuccess}
              aria-label={`Success ${successPoints} points`}
            >
              SUCCESS (+{successPoints} pts)
            </button>
            <button
              type="button"
              className="secondary button-fail"
              disabled={disabled || submitting}
              onClick={handleFail}
              aria-label="Fail 0 points"
            >
              FAIL (0 pts)
            </button>
          </div>
        </div>
      ) : (
        <form className="scoring-manual-section" onSubmit={handleManualSubmit}>
          {pointsPerUnit && (
            <div className="origami-guidance" data-testid="unit-guidance">
              <p>
                <strong>Unit Guide:</strong> 1 unit = {pointsPerUnit} points (example: 4 origami = 20 points).
                {' '}Enter total accumulated points, not the unit count.
              </p>
            </div>
          )}

          <div className="form-group">
            <label htmlFor="manual-points-input">
              Total Manual Points (0–{MAX_MANUAL_POINTS}):
            </label>
            <input
              id="manual-points-input"
              data-testid="manual-points-input"
              type="number"
              min="0"
              max={MAX_MANUAL_POINTS}
              step="1"
              value={pointsInput}
              onChange={(e) => setPointsInput(e.target.value)}
              disabled={disabled || submitting}
              placeholder="Enter points value (e.g. 20)"
              required
            />
          </div>

          {isNotMultipleOfUnit && (
            <p className="scoring-warning" role="status" data-testid="origami-warning">
              {`Warning: Value is not a multiple of ${pointsPerUnit} (guide: 1 unit = ${pointsPerUnit} points). `}
              Still submittable.
            </p>
          )}

          <div className="scoring-buttons">
            <button
              type="submit"
              className="button-manual-submit"
              disabled={isManualSubmitDisabled}
              aria-label="Save Manual Points"
            >
              Save Manual Points
            </button>
          </div>
        </form>
      )}

      <div className="form-group note-group">
        <label htmlFor="scoring-note-input">Note (optional):</label>
        <input
          id="scoring-note-input"
          data-testid="scoring-note-input"
          type="text"
          maxLength={500}
          value={noteInput}
          onChange={(e) => setNoteInput(e.target.value)}
          disabled={disabled || submitting}
          placeholder="E.g. 4 origami completed x 5 points"
        />
      </div>

      {submitting && <p role="status">Saving points…</p>}
      {error && (
        <div role="alert" className="scoring-error">
          <p>{error.message}</p>
          {error.status === 409 && onReload && (
            <button type="button" className="secondary" onClick={onReload}>
              Reload game status
            </button>
          )}
        </div>
      )}
    </div>
  );
}
