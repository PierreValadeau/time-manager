import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider, type InitialEntry } from 'react-router';
import AuthProvider from '../../../src/auth/AuthProvider';
import { LOGIN_PATH } from '../../../src/auth/guards';
import type { User } from '../../../src/auth/auth-context';
import { queryClient } from '../../../src/lib/queryClient';
import LoginPage, { FORGOT_PASSWORD_PATH, MICROSOFT_LOGIN_URL } from '../../../src/pages/LoginPage';
import { expectNoA11yViolations } from '../components/ui/axe';

const employee: User = { id: 'u1', firstName: 'Léa', lastName: 'Martin', email: 'lea@trinity.market', role: 'employee' };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const apiError = (status: number, code: string) => json(status, { error: { code, message: code } });

let fetchMock: ReturnType<typeof vi.fn>;
let loginResponse: () => Response | Promise<Response>;

const loginCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/auth/login'));

beforeEach(() => {
  loginResponse = () => json(200, employee);
  fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith('/auth/login')) return loginResponse();
    // No session yet
    return apiError(401, 'UNAUTHENTICATED');
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  queryClient.clear();
  vi.unstubAllGlobals();
});

function renderLogin(entry: InitialEntry = LOGIN_PATH) {
  const router = createMemoryRouter(
    [
      { path: LOGIN_PATH, element: <LoginPage />, handle: { title: 'Connexion' } },
      { path: '/', element: <p>Dashboard</p> },
      { path: '/pointage', element: <p>Clock page</p> },
    ],
    { initialEntries: [entry] },
  );
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return router;
}

const emailInput = () => screen.getByLabelText(/Email professionnel/);
const passwordInput = () => screen.getByLabelText(/Mot de passe/);
const submit = () => userEvent.click(screen.getByRole('button', { name: 'Se connecter' }));

async function fillAndSubmit(email: string, password: string) {
  await userEvent.type(emailInput(), email);
  await userEvent.type(passwordInput(), password);
  await submit();
}

describe('LoginPage: content', () => {
  it('shows the form, the Microsoft sign-in and the forgotten password link', async () => {
    renderLogin();

    expect(await screen.findByRole('heading', { level: 1, name: 'Connexion' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Se connecter avec Microsoft' })).toHaveAttribute('href', MICROSOFT_LOGIN_URL);
    expect(screen.getByRole('link', { name: 'Mot de passe oublié ?' })).toHaveAttribute('href', FORGOT_PASSWORD_PATH);
    expect(emailInput()).toHaveAttribute('autocomplete', 'username');
    expect(passwordInput()).toHaveAttribute('autocomplete', 'current-password');
    await expectNoA11yViolations(document.body);
  });

  it('sends an already signed-in user to the dashboard', async () => {
    fetchMock.mockImplementation(async () => json(200, employee));

    const router = renderLogin();

    expect(await screen.findByText('Dashboard')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });
});

describe('LoginPage: validation', () => {
  it('flags both empty fields and focuses the email', async () => {
    renderLogin();
    await screen.findByRole('heading', { name: 'Connexion' });

    await submit();

    expect(emailInput()).toHaveAccessibleDescription('Saisissez votre email.');
    expect(passwordInput()).toHaveAccessibleDescription('Saisissez votre mot de passe.');
    expect(emailInput()).toHaveFocus();
    expect(loginCalls()).toHaveLength(0);
  });

  it('rejects a malformed email', async () => {
    renderLogin();
    await screen.findByRole('heading', { name: 'Connexion' });

    await fillAndSubmit('lea.trinity.market', 'secret');

    expect(emailInput()).toHaveAttribute('aria-invalid', 'true');
    expect(emailInput()).toHaveAccessibleDescription(/Saisissez un email valide/);
    expect(loginCalls()).toHaveLength(0);
  });
});

describe('LoginPage: submission', () => {
  it('signs in with the trimmed email and goes to the dashboard', async () => {
    const router = renderLogin();
    await screen.findByRole('heading', { name: 'Connexion' });

    await fillAndSubmit('  lea@trinity.market ', 'secret');

    expect(await screen.findByText('Dashboard')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
    expect(loginCalls()[0][1].body).toBe(JSON.stringify({ email: 'lea@trinity.market', password: 'secret' }));
  });

  it('goes back to the page requested before the redirect', async () => {
    renderLogin({ pathname: LOGIN_PATH, state: { from: '/pointage' } });
    await screen.findByRole('heading', { name: 'Connexion' });

    await fillAndSubmit('lea@trinity.market', 'secret');

    expect(await screen.findByText('Clock page')).toBeInTheDocument();
  });

  it('sends a single request when the button is clicked twice', async () => {
    let resolveLogin!: (response: Response) => void;
    loginResponse = () => new Promise((resolve) => (resolveLogin = resolve));
    renderLogin();
    await screen.findByRole('heading', { name: 'Connexion' });

    await fillAndSubmit('lea@trinity.market', 'secret');
    expect(screen.getByRole('button', { name: 'Se connecter' })).toHaveAttribute('aria-busy', 'true');
    await submit();

    expect(loginCalls()).toHaveLength(1);
    resolveLogin(json(200, employee));
    expect(await screen.findByText('Dashboard')).toBeInTheDocument();
  });

  it.each([
    [401, 'UNAUTHENTICATED', 'Email ou mot de passe incorrect.'],
    [429, 'TOO_MANY_REQUESTS', 'Trop de tentatives de connexion. Réessayez dans quelques minutes.'],
    [500, 'INTERNAL_ERROR', 'Connexion impossible pour le moment. Réessayez dans quelques instants.'],
  ])('explains a %i and lets the user try again', async (status, code, message) => {
    loginResponse = () => apiError(status, code);
    renderLogin();
    await screen.findByRole('heading', { name: 'Connexion' });

    await fillAndSubmit('lea@trinity.market', 'wrong');

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(passwordInput()).toHaveValue('');
    expect(passwordInput()).toHaveFocus();
    expect(emailInput()).toHaveValue('lea@trinity.market');
  });

  it('explains a network failure', async () => {
    loginResponse = () => Promise.reject(new TypeError('Failed to fetch'));
    renderLogin();
    await screen.findByRole('heading', { name: 'Connexion' });

    await fillAndSubmit('lea@trinity.market', 'secret');

    expect(await screen.findByRole('alert')).toHaveTextContent('Connexion impossible pour le moment');
  });
});
