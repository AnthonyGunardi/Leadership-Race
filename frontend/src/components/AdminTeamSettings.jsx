/** Team identity/order edits remain a local draft until the existing atomic setup command is saved. */
export function AdminTeamSettings({ setup, busy }) {
  return <section id="admin-teams" aria-labelledby="simple-teams-title" className="simple-section">
    <details open={setup.editable} onInvalidCapture={(event) => { event.currentTarget.open = true; }}>
      <summary><h2 id="simple-teams-title">Teams</h2><span>{setup.teams.length} teams</span></summary>
      <p className="form-hint">2–15 teams. Order below determines turn order.</p>
      <fieldset disabled={setup.disabled || busy}>
        <legend className="visually-hidden">Team settings</legend>
        <ol className="simple-team-editors">
          {setup.teams.map((team, index) => <li key={team.id ?? `new-${index}`}>
            <span className="simple-team-code">T{team.sortOrder}</span>
            <label>Team name T{team.sortOrder}
              <input required maxLength={100} value={team.name}
                onChange={(event) => setup.updateTeam(index, 'name', event.target.value)} />
            </label>
            <label>Color T{team.sortOrder}
              <input type="color" value={team.color}
                onChange={(event) => setup.updateTeam(index, 'color', event.target.value)} />
            </label>
            <div className="simple-team-actions">
              <button type="button" className="secondary" aria-label={`Move T${team.sortOrder} up`}
                disabled={index === 0} onClick={() => setup.moveTeam(index, -1)}>Up</button>
              <button type="button" className="secondary" aria-label={`Move T${team.sortOrder} down`}
                disabled={index === setup.teams.length - 1} onClick={() => setup.moveTeam(index, 1)}>Down</button>
              <button type="button" className="secondary" aria-label={`Remove T${team.sortOrder}`}
                disabled={setup.teams.length <= 2} onClick={() => setup.removeTeam(index)}>Remove</button>
            </div>
          </li>)}
        </ol>
        <button type="button" className="secondary" disabled={setup.teams.length >= 15}
          onClick={setup.addTeam}>Add team</button>
      </fieldset>
      {!setup.editable && <p className="form-hint">Teams and points are locked during game. Reset to configure them again.</p>}
    </details>
  </section>;
}
