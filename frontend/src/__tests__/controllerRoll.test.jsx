import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { useControllerLease } from '../hooks/useControllerLease.js';
import { GameControlPage } from '../pages/GameControlPage.jsx';
import { gameRequest } from '../services/games.js';

vi.mock('../services/games.js', () => ({ gameRequest: vi.fn() }));
const session = { user: { id: 'admin-a' }, accessToken: 'test-admin-access' };
const leaseToken = 'c'.repeat(64);
let snapshot;
let client;

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  snapshot = {
    success: true,
    data: {
      game: { id: 'game-1', status: 'RUNNING', currentTeamId: 'team-1', turnNumber: 0 },
      teams: [
        { id: 'team-1', name: 'Ferrari', code: 'T1', position: 0, sortOrder: 0, totalScore: 0 },
        { id: 'team-2', name: 'Mercedes', code: 'T2', position: 0, sortOrder: 1, totalScore: 0 }
      ],
      turn: null,
      turnStatus: 'READY_FOR_ROLL',
      activeMovement: null,
      pendingResult: null,
      controller: {
        holderUserId: null,
        expiresAt: null,
        version: 0
      }
    },
    meta: { stateVersion: 10, serverTime: new Date().toISOString() }
  };
  gameRequest.mockImplementation(async () => snapshot);
});

afterEach(() => {
  client.clear();
  vi.restoreAllMocks();
});

function mountHook() {
  return renderHook(() => useControllerLease(session, 'game-1'), {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  });
}

it('enables roll when user owns lease and game is RUNNING with READY_FOR_ROLL', async () => {
  const { result } = mountHook();
  await waitFor(() => expect(result.current.disabled).toBe(false));

  // Simulate acquiring lease to set credentialVersion
  gameRequest.mockImplementation(async ({ method }) => {
    if (method === 'POST') {
      snapshot = {
        ...snapshot,
        data: {
          ...snapshot.data,
          controller: {
            holderUserId: session.user.id,
            expiresAt: new Date(Date.now() + 30000).toISOString(),
            version: 1
          }
        }
      };
      return {
        ...snapshot,
        data: {
          controller: snapshot.data.controller,
          controllerLeaseToken: leaseToken
        }
      };
    }
    return snapshot;
  });

  await act(async () => {
    result.current.acquire();
  });
  await waitFor(() => expect(result.current.ownsLease).toBe(true));
  expect(result.current.canRoll).toBe(true);
  expect(result.current.turnStatus).toBe('READY_FOR_ROLL');
  expect(result.current.currentTeam.name).toBe('Ferrari');

  // Trigger roll
  gameRequest.mockImplementation(async ({ path, method, body }) => {
    if (path.endsWith('/turns/roll') && method === 'POST') {
      expect(body.diceValue).toBe(3);
      expect(body.expectedTurnNumber).toBe(1);
      expect(body.expectedStateVersion).toBe(10);
      expect(body.controllerLeaseToken).toBe(leaseToken);
      snapshot = {
        ...snapshot,
        data: {
          ...snapshot.data,
          game: { ...snapshot.data.game, turnNumber: 1 },
          turnStatus: 'ANIMATING',
          turn: { id: 'turn-1', diceValue: 3 },
          activeMovement: {
            turnId: 'turn-1',
            teamId: 'team-1',
            from: 0,
            dicePath: [1, 2, 3],
            penaltyPath: [],
            fullPath: [1, 2, 3],
            landingCell: 3,
            finalPosition: 3,
            stepDurationMs: 450
          }
        },
        meta: { stateVersion: 11, serverTime: new Date().toISOString() }
      };
      return {
        success: true,
        data: snapshot.data.activeMovement,
        meta: snapshot.meta
      };
    }
    return snapshot;
  });

  await act(async () => {
    result.current.roll(3);
  });

  await waitFor(() => expect(result.current.turnStatus).toBe('ANIMATING'));
  expect(result.current.canRoll).toBe(false);
  expect(result.current.activeMovement.fullPath).toEqual([1, 2, 3]);
});

it('renders physical dice buttons on GameControlPage and triggers roll on click', async () => {
  const user = userEvent.setup();
  let postCalledWith = null;

  gameRequest.mockImplementation(async ({ path, method, body }) => {
    if (method === 'POST') {
      postCalledWith = { path, body };
      snapshot = {
        ...snapshot,
        data: {
          ...snapshot.data,
          controller: {
            holderUserId: session.user.id,
            expiresAt: new Date(Date.now() + 30000).toISOString(),
            version: 1
          }
        }
      };
      return {
        ...snapshot,
        data: {
          controller: snapshot.data.controller,
          controllerLeaseToken: leaseToken
        }
      };
    }
    return snapshot;
  });

  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/admin/games/game-1/control']}>
        <Routes>
          <Route path="/admin/games/:id/control" element={<GameControlPage session={session} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );

  await screen.findByRole('heading', { name: 'Active Controller' });
  const acquireButton = screen.getByRole('button', { name: 'Acquire controller' });

  await user.click(acquireButton);
  await waitFor(() => expect(screen.getByText(/Control is on this browser/)).toBeInTheDocument());

  // Check turn heading and team info
  expect(screen.getByRole('heading', { name: 'Turns & Physical Dice' })).toBeInTheDocument();
  expect(screen.getByText(/Ferrari/)).toBeInTheDocument();
  expect(screen.getByTestId('turn-status')).toHaveTextContent('READY_FOR_ROLL');

  // Verify all 6 physical dice buttons are present
  const diceButtons = [1, 2, 3, 4, 5, 6].map((num) => screen.getByRole('button', { name: `Dice ${num}` }));
  expect(diceButtons).toHaveLength(6);

  // Click dice 5
  await user.click(screen.getByRole('button', { name: 'Dice 5' }));
  expect(postCalledWith.path).toBe('/game-1/turns/roll');
  expect(postCalledWith.body.diceValue).toBe(5);
  expect(postCalledWith.body.controllerLeaseToken).toBe(leaseToken);
});

it('renders void button and executes void roll with reason on GameControlPage (G18)', async () => {
  const user = userEvent.setup();
  let voidCalledWith = null;

  snapshot = {
    ...snapshot,
    data: {
      ...snapshot.data,
      turnStatus: 'READY_FOR_ROLL',
      lastTurn: {
        id: 'turn-completed-1',
        turnNumber: 1,
        teamId: 'team-1',
        diceValue: 4,
        from: 0,
        landingCell: 4,
        finalPosition: 4,
        status: 'COMPLETED',
        awardedPoints: 10
      }
    }
  };

  gameRequest.mockImplementation(async ({ path, method, body }) => {
    if (path.endsWith('/void') && method === 'POST') {
      voidCalledWith = { path, body };
      snapshot = {
        ...snapshot,
        data: {
          ...snapshot.data,
          lastTurn: {
            ...snapshot.data.lastTurn,
            status: 'VOIDED',
            voidReason: body.reason
          }
        },
        meta: { stateVersion: 11, serverTime: new Date().toISOString() }
      };
      return {
        success: true,
        data: {
          voidedTurnId: 'turn-completed-1',
          teamId: 'team-1',
          restoredPosition: 0,
          compensatedPoints: 10,
          newTotalScore: 0
        },
        meta: snapshot.meta
      };
    }
    return snapshot;
  });

  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/admin/games/game-1/control']}>
        <Routes>
          <Route path="/admin/games/:id/control" element={<GameControlPage session={session} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );

  const voidBtn = await screen.findByRole('button', { name: 'Void Last Roll' });
  expect(voidBtn).toBeInTheDocument();

  // Click void button to open confirmation dialog
  await user.click(voidBtn);

  // Dialog should open
  const dialog = screen.getByRole('dialog', { name: 'Confirm Void Last Roll' });
  expect(dialog).toBeInTheDocument();
  expect(dialog).toHaveTextContent(/Ferrari \(T1\)/);
  expect(dialog).toHaveTextContent(/Dice Value:\s*4/);
  expect(dialog).toHaveTextContent(/10 pts/i);

  // Confirm button disabled when reason is empty
  const confirmBtn = screen.getByRole('button', { name: 'Confirm Void Roll' });
  expect(confirmBtn).toBeDisabled();

  // Type reason
  const reasonInput = screen.getByLabelText(/Void reason/i);
  await user.type(reasonInput, 'Salah input dadu fisik, harusnya 2');
  expect(confirmBtn).toBeEnabled();

  // Submit confirmation
  await user.click(confirmBtn);

  expect(voidCalledWith).not.toBeNull();
  expect(voidCalledWith.path).toBe('/game-1/turns/turn-completed-1/void');
  expect(voidCalledWith.body.reason).toBe('Salah input dadu fisik, harusnya 2');
  expect(voidCalledWith.body.confirmed).toBe(true);
  expect(voidCalledWith.body.expectedStateVersion).toBe(10);
});

it('renders void status banner when last turn is VOIDED (G18)', async () => {
  snapshot = {
    ...snapshot,
    data: {
      ...snapshot.data,
      turnStatus: 'READY_FOR_ROLL',
      lastTurn: {
        id: 'turn-voided-1',
        turnNumber: 1,
        teamId: 'team-1',
        diceValue: 4,
        from: 0,
        landingCell: 4,
        finalPosition: 4,
        status: 'VOIDED',
        voidReason: 'Dadu fisik ternyata miring'
      }
    }
  };

  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/admin/games/game-1/control']}>
        <Routes>
          <Route path="/admin/games/:id/control" element={<GameControlPage session={session} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );

  const banner = await screen.findByTestId('void-status-banner');
  expect(banner).toBeInTheDocument();
  expect(banner).toHaveTextContent(/Roll #1 voided \(VOIDED\)/);
  expect(banner).toHaveTextContent(/Dadu fisik ternyata miring/);
});
