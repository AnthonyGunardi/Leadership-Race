import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AdminSessionPage } from '../pages/AdminSessionPage.jsx';

const session = { user: { id: 'admin', email: 'admin@example.test' }, accessToken: 'memory',
  logout: vi.fn(), refresh: vi.fn() };
let client;
let snapshot;
let failure;
let requests;

beforeEach(() => {
  onlineManager.setOnline(true);
  failure = null;
  requests = [];
  snapshot = { success: true, data: {
    game: { id: 'race', name: 'Balapan', status: 'DRAFT', currentTeamId: null, turnNumber: 0 },
    teams: [{ id: 'red', name: 'Merah', color: '#aa0000', sortOrder: 1, code: 'T1', position: 0, totalScore: 0 },
      { id: 'blue', name: 'Biru', color: '#0000aa', sortOrder: 2, code: 'T2', position: 0, totalScore: 0 }],
    boardCells: [{ id: 'cell-1', number: 1, title: 'Challenge pertama', category: 'ACTION', successPoints: 10,
      defaultScoringMethod: 'BUTTON', allowManualPoints: true, penaltySteps: 0, instruction: 'Offline' },
    { id: 'cell-2', number: 2, title: 'Challenge kedua', category: 'REWARD', successPoints: 20,
      defaultScoringMethod: 'MANUAL', allowManualPoints: true, penaltySteps: 0 }],
    controller: { version: 0 }, turnStatus: 'READY_FOR_ROLL', turn: null, pendingResult: null
  }, meta: { stateVersion: 1, eventSequence: 1, serverTime: new Date().toISOString() } };
  vi.stubGlobal('confirm', vi.fn(() => true));
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    const body = options.body && JSON.parse(options.body);
    const request = { url, ...options, body };
    requests.push(request);
    if (url.includes('/archives')) return { ok: true, status: 200,
      json: async () => ({ success: true, data: { games: [] }, meta: { total: 0 } }) };
    if (body?.expectedStateVersion !== undefined && body.expectedStateVersion !== snapshot.meta.stateVersion) {
      return { ok: false, status: 409, json: async () => ({ success: false,
        error: { code: 'STALE_STATE', message: 'Game telah berubah. Muat ulang.' } }) };
    }
    if (failure?.url === url && options.method !== 'GET') {
      const problem = failure;
      failure = null;
      if (problem.network) throw new TypeError('Connection lost');
      return { ok: false, status: 409, json: async () => ({ success: false,
        error: { code: 'STALE_STATE', message: 'Game telah berubah. Muat ulang.' } }) };
    }
    let data;
    if (options.method === 'PUT') {
      snapshot.data.teams = body.teams.map((team) => ({ ...team, code: `T${team.sortOrder}`, position: 0, totalScore: 0 }));
      snapshot.data.boardCells = body.boardCells;
    }
    if (url.endsWith('/validate')) snapshot.data.game.status = 'READY';
    if (url.endsWith('/start')) {
      snapshot.data.game.status = 'RUNNING';
      snapshot.data.game.currentTeamId = 'red';
    }
    if (url.endsWith('/controller/acquire') || url.endsWith('/controller/take-over')) {
      snapshot.data.controller = { holderUserId: 'admin', version: 1,
        expiresAt: new Date(Date.now() + 30000).toISOString() };
      data = { controller: snapshot.data.controller, controllerLeaseToken: 'lease-in-memory' };
    }
    if (url.endsWith('/turns/roll')) snapshot.data.turnStatus = 'ANIMATING';
    if (url.includes('/turns/') && url.endsWith('/void')) {
      snapshot.data.lastTurn = { ...snapshot.data.lastTurn, status: 'VOIDED', voidReason: body.reason };
      snapshot.data.turnStatus = 'READY_FOR_ROLL';
      snapshot.data.turn = null;
    }
    if (url.endsWith('/pause')) {
      snapshot.data.game.status = 'PAUSED';
    }
    if (url.endsWith('/resume')) {
      snapshot.data.game.status = 'RUNNING';
    }
    if (url.endsWith('/finish')) {
      snapshot.data.game.status = 'FINISHED';
      snapshot.data.finalResults = {
        winners: [{ teamId: 'red', name: 'Merah', code: 'T1', totalScore: 50 }]
      };
    }
    if (url.endsWith('/result')) {
      snapshot.data.teams[0].totalScore += body.scoringMethod === 'MANUAL' ? body.points : body.outcome === 'SUCCESS' ? 10 : 0;
      snapshot.data.pendingResult = null;
      snapshot.data.turn = null;
      snapshot.data.turnStatus = 'READY_FOR_ROLL';
    }
    if (url.endsWith('/reset')) {
      snapshot.data.game = { ...snapshot.data.game, id: 'next-race', status: 'DRAFT' };
      snapshot.data.teams = snapshot.data.teams.map((team) => ({ ...team, position: 0, totalScore: 0 }));
    }
    if (options.method !== 'GET') snapshot.meta.stateVersion += 1;
    const result = globalThis.structuredClone(data ? { ...snapshot, data } : snapshot);
    return { ok: true, status: 200, json: async () => result };
  }));
});

afterEach(() => { client?.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** Exercises the same authenticated transport and persisted snapshots used by the complete admin page. */
function mount() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/admin/games']}>
    <AdminSessionPage session={session} />
  </MemoryRouter></QueryClientProvider>);
}

it('keeps four admin tasks together and saves team edits and points for only the selected cell', async () => {
  mount();
  expect(await screen.findByRole('heading', { name: 'Teams', exact: true })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Pawn positions', exact: true })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Challenge point settings', exact: true })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Reset game', exact: true })).toBeInTheDocument();
  expect(screen.queryByText('Game archive')).not.toBeInTheDocument();
  expect(screen.queryByText('Active Controller')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Team name T1'), { target: { value: 'Ferrari' } });
  expect(screen.getByRole('button', { name: 'Start game' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Challenge cell'), { target: { value: '2' } });
  fireEvent.change(screen.getByLabelText('Success Points'), { target: { value: '35' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save teams and points' }));
  expect(await screen.findByText('Teams and points saved.')).toBeInTheDocument();
  const saved = requests.find((request) => request.method === 'PUT');
  expect(saved.body.teams[0].name).toBe('Ferrari');
  expect(saved.body.boardCells.map((cell) => cell.successPoints)).toEqual([10, 35]);
  expect(saved.body.boardCells[0].instruction).toBe('Offline');
  expect(saved.headers.Authorization).toBe('Bearer memory');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Start game' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Start game' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Dice 1' })).toBeEnabled());
});

it('starts with server preflight, acquires control automatically and submits physical dice exactly once', async () => {
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Start game' }));
  const dice = await screen.findByRole('button', { name: 'Dice 3' });
  await waitFor(() => expect(dice).toBeEnabled());
  const paths = requests.filter((request) => request.method === 'POST').map((request) => request.url);
  expect(paths).toEqual(['/api/v1/games/race/validate', '/api/v1/games/race/start',
    '/api/v1/games/race/controller/acquire']);
  fireEvent.click(dice);
  fireEvent.click(dice);
  await waitFor(() => expect(requests.filter((request) => request.url.endsWith('/turns/roll'))).toHaveLength(1));
  expect(requests.find((request) => request.url.endsWith('/turns/roll')).body).toMatchObject({
    diceValue: 3, expectedTurnNumber: 1, controllerLeaseToken: 'lease-in-memory'
  });
  expect(await screen.findByText('Token is moving. Please wait until finished.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reset game', exact: true })).toBeDisabled();
});

it('retries an uncertain preflight using its original key before continuing start', async () => {
  failure = { url: '/api/v1/games/race/validate', network: true };
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Start game' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Retry same action' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Dice 1' })).toBeEnabled());
  const validations = requests.filter((request) => request.url.endsWith('/validate'));
  expect(validations).toHaveLength(2);
  expect(validations[0].headers['Idempotency-Key']).toBe(validations[1].headers['Idempotency-Key']);
  expect(requests.filter((request) => request.url.endsWith('/start'))).toHaveLength(1);
});

it('preserves a draft on conflicts and requires confirmation before resetting the current game', async () => {
  failure = { url: '/api/v1/games/race/setup' };
  mount();
  fireEvent.change(await screen.findByLabelText('Team name T1'), { target: { value: 'Ferrari' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save teams and points' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Game telah berubah.');
  expect(screen.getByLabelText('Team name T1')).toHaveValue('Ferrari');
  window.confirm.mockReturnValueOnce(false).mockReturnValueOnce(true);
  const reset = screen.getByRole('button', { name: 'Reset game', exact: true });
  fireEvent.click(reset);
  expect(requests.filter((request) => request.url.endsWith('/reset'))).toHaveLength(0);
  fireEvent.click(reset);
  await waitFor(() => expect(requests.filter((request) => request.url.endsWith('/reset'))).toHaveLength(1));
  expect(requests.find((request) => request.url.endsWith('/reset')).body).toMatchObject({ confirmed: true });
  await waitFor(() => expect(screen.getByLabelText('Team name T1')).toHaveValue('Merah'));
});

it.each(['SUCCESS', 'FAIL', 'MANUAL'])('records one %s result on the same admin page', async (method) => {
  snapshot.data.game.status = 'RUNNING';
  snapshot.data.game.currentTeamId = 'red';
  snapshot.data.turnStatus = 'AWAITING_RESULT';
  snapshot.data.turn = { id: 'turn', teamId: 'red' };
  snapshot.data.pendingResult = { turnId: 'turn', cellNumber: 1, category: 'ACTION', title: 'Challenge pertama',
    successPoints: 10, defaultMethod: 'BUTTON', allowedMethods: ['BUTTON', 'MANUAL'] };
  mount();
  await screen.findByRole('button', { name: 'Success 10 points' });
  if (method === 'MANUAL') {
    fireEvent.click(screen.getByRole('tab', { name: 'Manual Points Input' }));
    fireEvent.change(screen.getByLabelText(/Total Manual Points/), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Manual Points' }));
  } else fireEvent.click(screen.getByRole('button', { name: method === 'SUCCESS' ? 'Success 10 points' : 'Fail 0 points' }));
  await waitFor(() => expect(requests.filter((request) => request.url.endsWith('/result'))).toHaveLength(1));
  expect(requests.find((request) => request.url.endsWith('/result')).body).toMatchObject(method === 'MANUAL'
    ? { scoringMethod: 'MANUAL', points: 25 } : { scoringMethod: 'BUTTON', outcome: method });
});

it('requires confirmation to take control from another browser and disables mutations while offline', async () => {
  snapshot.data.game.status = 'RUNNING';
  snapshot.data.game.currentTeamId = 'red';
  snapshot.data.controller = { holderUserId: 'other-admin', version: 1,
    expiresAt: new Date(Date.now() + 30000).toISOString() };
  mount();
  const takeover = await screen.findByRole('button', { name: 'Use control here' });
  expect(screen.getByRole('button', { name: 'Dice 1' })).toBeDisabled();
  expect(requests.filter((request) => request.url.endsWith('/controller/acquire'))).toHaveLength(0);
  window.confirm.mockReturnValueOnce(false).mockReturnValueOnce(true);
  fireEvent.click(takeover);
  expect(requests.filter((request) => request.url.endsWith('/controller/take-over'))).toHaveLength(0);
  fireEvent.click(takeover);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Dice 1' })).toBeEnabled());
  vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
  await act(async () => { window.dispatchEvent(new window.Event('offline')); });
  expect(screen.getByRole('button', { name: 'Dice 1' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Reset game', exact: true })).toBeDisabled();
  expect(screen.getByText(/Connection lost/)).toBeInTheDocument();
});

it('does not loop on a rejected automatic acquisition and supports explicit recovery', async () => {
  snapshot.data.game.status = 'RUNNING';
  snapshot.data.game.currentTeamId = 'red';
  failure = { url: '/api/v1/games/race/controller/acquire' };
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('Game telah berubah.');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Enable dice input' })).toBeEnabled());
  expect(requests.filter((request) => request.url.endsWith('/controller/acquire'))).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Enable dice input' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Dice 1' })).toBeEnabled());
});

it.each(['Team name T1', 'Success Points'])('reveals the collapsed settings group for invalid %s', async (label) => {
  mount();
  const input = await screen.findByLabelText(label);
  fireEvent.change(input, { target: { value: '' } });
  const group = input.closest('details');
  fireEvent.click(group.querySelector('summary'));
  expect(group).not.toHaveAttribute('open');
  fireEvent.invalid(input);
  expect(group).toHaveAttribute('open');
});

it('cancels last roll with reason and restores turn readiness (Void G18)', async () => {
  snapshot.data.game.status = 'RUNNING';
  snapshot.data.game.currentTeamId = 'red';
  snapshot.data.turnStatus = 'AWAITING_RESULT';
  snapshot.data.lastTurn = {
    id: 'turn-99',
    turnNumber: 1,
    teamId: 'red',
    fromPosition: 0,
    toPosition: 3,
    diceValue: 3,
    awardedPoints: 10,
    status: 'AWAITING_RESULT'
  };
  mount();

  const voidBtn = await screen.findByTestId('void-roll-btn');
  expect(voidBtn).toBeEnabled();
  fireEvent.click(voidBtn);

  expect(screen.getByRole('dialog', { name: /Confirm Void Last Roll/ })).toBeInTheDocument();
  const confirmBtn = screen.getByTestId('confirm-void-btn');
  expect(confirmBtn).toBeDisabled();

  const reasonInput = screen.getByTestId('void-reason-input');
  fireEvent.change(reasonInput, { target: { value: 'Salah catat dadu' } });
  expect(confirmBtn).toBeEnabled();

  fireEvent.click(confirmBtn);

  await waitFor(() => expect(requests.filter((r) => r.url.endsWith('/void'))).toHaveLength(1));
  const voidReq = requests.find((r) => r.url.endsWith('/void'));
  expect(voidReq.url).toContain('/turns/turn-99/void');
  expect(voidReq.body).toMatchObject({
    reason: 'Salah catat dadu',
    confirmed: true
  });
  expect(await screen.findByTestId('void-status-banner')).toHaveTextContent(/Roll #1 voided/);
});

it('pauses and resumes game from single admin page', async () => {
  snapshot.data.game.status = 'RUNNING';
  snapshot.data.game.currentTeamId = 'red';
  snapshot.data.controller = {
    holderUserId: 'admin',
    version: 1,
    expiresAt: new Date(Date.now() + 30000).toISOString()
  };
  mount();

  const pauseBtn = await screen.findByTestId('pause-game-btn');
  fireEvent.click(pauseBtn);

  await waitFor(() => expect(requests.filter((r) => r.url.endsWith('/pause'))).toHaveLength(1));
  expect(await screen.findByRole('status', { name: '' })).toHaveTextContent(/Game is paused/);

  const resumeBtn = screen.getByTestId('resume-game-btn');
  fireEvent.click(resumeBtn);

  await waitFor(() => expect(requests.filter((r) => r.url.endsWith('/resume'))).toHaveLength(1));
});

it('finishes game manually with confirmation and displays winners', async () => {
  snapshot.data.game.status = 'RUNNING';
  snapshot.data.game.currentTeamId = 'red';
  mount();

  const finishBtn = await screen.findByTestId('finish-game-btn');
  fireEvent.click(finishBtn);

  expect(screen.getByRole('dialog', { name: /Confirm Finish Game/ })).toBeInTheDocument();
  const confirmFinishBtn = screen.getByTestId('confirm-finish-btn');
  fireEvent.click(confirmFinishBtn);

  await waitFor(() => expect(requests.filter((r) => r.url.endsWith('/finish'))).toHaveLength(1));
  expect(requests.find((r) => r.url.endsWith('/finish')).body).toMatchObject({ confirmed: true });
  expect(await screen.findByText(/Game finished \(FINISHED\)/)).toBeInTheDocument();
  expect(screen.getByText(/Merah \(T1\)/)).toBeInTheDocument();
});

it('allows adding up to 15 teams with valid colors and disables Add team button at 15', async () => {
  mount();
  const addTeamBtn = await screen.findByRole('button', { name: 'Add team' });
  expect(screen.getByText('2–15 teams. Order below determines turn order.')).toBeInTheDocument();
  for (let i = 3; i <= 15; i++) {
    expect(addTeamBtn).toBeEnabled();
    fireEvent.click(addTeamBtn);
    expect(screen.getByLabelText(`Team name T${i}`)).toBeInTheDocument();
  }
  expect(addTeamBtn).toBeDisabled();
  expect(screen.getByText('15 teams')).toBeInTheDocument();
});
