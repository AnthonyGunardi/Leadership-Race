/** Exposes scoring configuration for one challenge at a time while preserving all other board fields. */
export function AdminPointSettings({ setup, controls }) {
  return <section id="admin-points" aria-labelledby="simple-points-title" className="simple-section">
    <details open={setup.editable} onInvalidCapture={(event) => { event.currentTarget.open = true; }}>
      <summary><h2 id="simple-points-title">Challenge point settings</h2></summary>
      <label htmlFor="simple-challenge-cell">Challenge cell</label>
      <select id="simple-challenge-cell" value={controls.selectedCell}
        onChange={(event) => controls.setSelectedCell(event.target.value)}>
        {controls.challengeCells.map((cell) => <option key={cell.number} value={cell.number}>
          {cell.number}. {cell.title}
        </option>)}
      </select>
      {controls.cell ? <fieldset disabled={setup.disabled || controls.blocked} className="simple-point-fields">
        <legend className="visually-hidden">Points for cell {controls.cell.number}</legend>
        <label>Success Points
          <input type="number" required min="0" max="2147483647" step="1" value={controls.cell.successPoints}
            onChange={(event) => setup.updateCell(controls.cellIndex, 'successPoints',
              event.target.value === '' ? '' : Number(event.target.value))} />
        </label>
        <label>Fail Points<input type="number" value="0" readOnly /></label>
        <label>Default method
          <select value={controls.cell.defaultScoringMethod}
            onChange={(event) => setup.updateCell(controls.cellIndex, 'defaultScoringMethod', event.target.value)}>
            <option value="BUTTON">Success / Fail button</option>
            <option value="MANUAL">Manual points input</option>
          </select>
        </label>
      </fieldset> : <p>No challenge cells on the board yet.</p>}
      <p className="form-hint">Success points vary per cell. Fail gives 0 points.
      Manual input of 0–200 points is always available during scoring.</p>
    </details>
  </section>;
}
