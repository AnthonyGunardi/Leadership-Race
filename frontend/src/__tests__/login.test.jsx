import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App.jsx';
import { resetAdminSessionStore, useAdminSession, useAdminSessionStore } from '../hooks/useAdminSession.js';

const identity = {
  user: { id: 'admin-ui', email: 'admin@example.test', role: 'SUPER_ADMIN' },
  accessToken: 'test-memory-token',
  accessExpiresAt: new Date(Date.now() + 900000).toISOString()
};
const response = (data, status = 200) => ({
  ok: status === 200, status, json: async () => ({ success: status === 200, data })
});

describe('Login and protected admin routes (LR-026)', () => {
  beforeEach(() => {
    resetAdminSessionStore();
    vi.stubGlobal('BroadcastChannel', undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(null, 401)));
    window.history.replaceState({}, '', '/login');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('announces initialization and guards direct admin navigation without exposing protected content', async () => {
    let finish;
    fetch.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    window.history.replaceState({}, '', '/admin/games/event/control');
    render(<App />);
    expect(screen.getByRole('status')).toHaveTextContent('Checking session');
    expect(screen.queryByRole('button', { name: 'Log out' })).not.toBeInTheDocument();
    await act(async () => { finish(response(null, 401)); });
    expect(await screen.findByRole('heading', { name: 'Super Admin Login' })).toBeVisible();
    expect(window.location.pathname).toBe('/login');
  });

  it('uses required email/password validation before making a login request', async () => {
    render(<App />);
    const submit = await screen.findByRole('button', { name: 'Log in' });
    await userEvent.click(submit);
    expect(screen.getByLabelText('Email')).toBeInvalid();
    expect(screen.getByLabelText('Password')).toBeInvalid();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Email')).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password');
  });

  it('submits by keyboard, prevents duplicate submission, redirects, refreshes and logs out', async () => {
    render(<App />);
    await screen.findByRole('button', { name: 'Log in' });
    await userEvent.type(screen.getByLabelText('Email'), identity.user.email);
    await userEvent.type(screen.getByLabelText('Password'), 'UI-only-test-password');
    let finish;
    fetch.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Logging in…' })).toBeDisabled();
    expect(screen.getByLabelText('Email')).toBeDisabled();
    await act(async () => { finish(response(identity)); });
    expect(await screen.findByText(identity.user.email)).toBeVisible();
    expect(window.location.pathname).toBe('/admin/games');
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refresh session' })).not.toBeInTheDocument();
    const { result } = renderHook(() => useAdminSession({ autoInit: false }));
    fetch.mockResolvedValueOnce(response({ ...identity, accessToken: 'rotated-memory-token' }));
    await act(async () => { await result.current.refresh(); });
    await waitFor(() => expect(useAdminSessionStore.getState().accessToken).toBe('rotated-memory-token'));
    fetch.mockResolvedValueOnce(response({ loggedOut: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));
    expect(await screen.findByRole('heading', { name: 'Super Admin Login' })).toBeVisible();
    expect(useAdminSessionStore.getState().accessToken).toBeNull();
  });

  it('shows invalid credentials, clears the password and lets the user re-login', async () => {
    render(<App />);
    await screen.findByRole('button', { name: 'Log in' });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: identity.user.email } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    fetch.mockResolvedValueOnce(response(null, 401));
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveFocus();
    fetch.mockResolvedValueOnce(response(identity));
    await userEvent.type(screen.getByLabelText('Password'), 'UI-only-test-password');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByText(identity.user.email)).toBeVisible();
  });

  it('shows a disconnected state with manual recovery instead of retrying credentials', async () => {
    fetch.mockRejectedValueOnce(new TypeError('Offline'));
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to connect');
    expect(fetch).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: identity.user.email } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'UI-only-test-password' } });
    fetch.mockResolvedValueOnce(response(identity));
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByText(identity.user.email)).toBeVisible();
  });

  it('redirects an existing session from login and returns to login after refresh rejection', async () => {
    fetch.mockResolvedValueOnce(response(identity));
    render(<App />);
    expect(await screen.findByText(identity.user.email)).toBeVisible();
    const { result } = renderHook(() => useAdminSession({ autoInit: false }));
    fetch.mockResolvedValueOnce(response(null, 401));
    await act(async () => { await expect(result.current.refresh()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' }); });
    expect(await screen.findByRole('heading', { name: 'Super Admin Login' })).toBeVisible();
    expect(window.location.pathname).toBe('/login');
  });

  it('surfaces a non-authentication login error without fabricating game data', async () => {
    render(<App />);
    await screen.findByRole('button', { name: 'Log in' });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: identity.user.email } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'UI-only-test-password' } });
    fetch.mockResolvedValueOnce(response(null, 429));
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 429');
    expect(window.location.pathname).toBe('/login');
  });

  it('keeps authenticated unknown admin paths inside the protected 404 route', async () => {
    fetch.mockResolvedValueOnce(response(identity));
    window.history.replaceState({}, '', '/admin/unknown');
    render(<App />);
    expect(await screen.findByRole('heading', { name: /404/ })).toBeVisible();
    expect(window.location.pathname).toBe('/admin/unknown');
  });
});
