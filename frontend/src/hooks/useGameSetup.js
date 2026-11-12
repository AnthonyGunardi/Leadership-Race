import { useState, useCallback } from 'react';
import { useGameCommand, useGameConnectivity } from './useGames.js';
import { describeBoardSource } from '../services/configuration.js';

const colors = [
  '#b90500', '#1254a3', '#14723a', '#7347a8', '#a35b00',
  '#008078', '#a02f67', '#41506c', '#686000', '#71380e',
  '#e11d48', '#0284c7', '#16a34a', '#d97706', '#475569'
];

/** Draft changes stay local until one versioned setup transaction commits them all. */
export function useGameSetup({ session, snapshot, install, reload, currentStatus }) {
  const initial = snapshot.data;
  const [name, setName] = useState(initial.game.name);
  const initialTeams = initial.teams.length
    ? initial.teams.map(({ id, name, color, sortOrder }) => ({
      id, name, color, sortOrder
    })) : [{ name: '', color: colors[0], sortOrder: 1 }, { name: '', color: colors[1], sortOrder: 2 }];
  const [teams, setTeams] = useState(initialTeams);
  const [cells, setCells] = useState(initial.boardCells);
  const online = useGameConnectivity();
  const onSaved = useCallback((result) => { install(result); }, [install]);
  const command = useGameCommand(session, onSaved);
  const editable = ['DRAFT', 'READY'].includes(currentStatus ?? initial.game.status);
  const disabled = !editable || !online || command.pending || command.uncertain;
  const canSave = !disabled && command.error?.code !== 'STALE_STATE';
  const dirty = name !== initial.game.name || JSON.stringify(teams) !== JSON.stringify(initialTeams)
    || JSON.stringify(cells) !== JSON.stringify(initial.boardCells);
  const lifecycleDisabled = disabled || dirty || command.error?.code === 'STALE_STATE';
  const currentTeam = initial.teams.find((team) => team.id === initial.game.currentTeamId);

  /** Server template replacement discards local edits only after an explicit operator decision. */
  function applyTemplate() {
    if (disabled) return;
    const warning = dirty ? ' Unsaved editor changes will be discarded.' : '';
    if (!window.confirm(`Replace all saved cells with unreconciled PRD template?${warning}`)) return;
    command.execute({ path: `/${initial.game.id}/board-template`, method: 'POST', body: {
      templateId: 'prd-appendix-a-v1', expectedStateVersion: snapshot.meta.stateVersion
    } });
  }
  /** Preflight only examines the saved configuration, never an unsaved browser draft. */
  function preflight() {
    if (lifecycleDisabled) return;
    command.execute({ path: `/${initial.game.id}/validate`, method: 'POST', body: {
      expectedStateVersion: snapshot.meta.stateVersion
    } });
  }
  /** Start has a visible confirmation and still relies on server-side revalidation under the game lock. */
  function start() {
    if (lifecycleDisabled || initial.game.status !== 'READY') return;
    if (!window.confirm('Start game now? Team and cell configuration will be locked.')) return;
    command.execute({ path: `/${initial.game.id}/start`, method: 'POST', body: {
      expectedStateVersion: snapshot.meta.stateVersion
    } });
  }

  /** Reordering updates the explicit persisted order and therefore the displayed Tn codes. */
  function moveTeam(index, delta) {
    setTeams((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((team, order) => ({ ...team, sortOrder: order + 1 }));
    });
  }
  /** This UI keeps engine/scoring fields coherent when an operator changes a cell category. */
  function updateCell(index, field, value) {
    setCells((current) => current.map((cell, at) => {
      if (index !== at) return cell;
      if (field !== 'category') return { ...cell, [field]: value };
      const penalty = value === 'INDISIPLINER';
      return { ...cell, category: value, successPoints: penalty ? 0 : cell.successPoints,
        penaltySteps: penalty ? Math.max(1, cell.penaltySteps) : 0, allowManualPoints: !penalty,
        defaultScoringMethod: penalty ? 'BUTTON' : cell.defaultScoringMethod,
        pointsPerUnit: penalty ? null : cell.pointsPerUnit };
    }));
  }
  /** Uses the first unused number; incomplete boards remain DRAFT until preflight. */
  function addCell() {
    setCells((current) => {
      const used = new Set(current.map((cell) => cell.number));
      const number = Array.from({ length: 50 }, (_, index) => index + 1).find((number) => !used.has(number));
      if (!number) return current;
      return [...current, { number, category: 'ACTION', title: '', instruction: null, backupText: null,
        durationText: null, successPoints: 0, allowManualPoints: true, defaultScoringMethod: 'BUTTON',
        pointsPerUnit: null, penaltySteps: 0 }].sort((a, b) => a.number - b.number);
    });
  }
  /** Stale state requires explicit reload; unknown outcomes can only retry the frozen command. */
  function save(event) {
    event.preventDefault();
    if (!canSave) return;
    command.execute({ path: `/${initial.game.id}/setup`, method: 'PUT', body: {
      name: name.trim(), expectedStateVersion: snapshot.meta.stateVersion, teams, boardCells: cells
    } });
  }
  /** Reload is explicit because it discards local edits, and never follows a 409 automatically. */
  function reloadSetup() {
    if (window.confirm('Reload setup from server? Unsaved changes will be replaced.')) reload();
  }
  return {
    name, setName, teams, cells, command, disabled, canSave, editable, online, save, reloadSetup,
    dirty, lifecycleDisabled, applyTemplate, preflight, start,
    sourceNotice: describeBoardSource(initial.game.boardSource),
    currentTeam,
    status: initial.game.status, version: snapshot.meta.stateVersion, addCell, updateCell, moveTeam,
    updateTeam: (index, field, value) => setTeams((current) => current.map((team, at) => (
      at === index ? { ...team, [field]: value } : team
    ))),
    addTeam: () => setTeams((current) => current.length < 15 ? [...current, {
      name: '', color: colors[current.length], sortOrder: current.length + 1
    }] : current),
    removeTeam: (index) => setTeams((current) => current.length > 2
      ? current.filter((_team, at) => at !== index).map((team, at) => ({ ...team, sortOrder: at + 1 })) : current),
    removeCell: (index) => setCells((current) => current.filter((_cell, at) => at !== index))
  };
}
