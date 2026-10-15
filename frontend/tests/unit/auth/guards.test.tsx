import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider, useLocation, type RouteObject } from 'react-router';
import AuthProvider from '../../../src/auth/AuthProvider';
import { LOGIN_PATH, RequireAuth, RequireRole, type LoginLocationState } from '../../../src/auth/guards';
import { MANAGER_ROLES, ME_QUERY_KEY, useAuth, type User } from '../../../src/auth/auth-context';
import Layout from '../../../src/components/Layout';
import { api } from '../../../src/lib/api';
import { queryClient } from '../../../src/lib/queryClient';
import { expectNoA11yViolations } from '../components/ui/axe';

const employee: User = { id: 'u1', firstName: 'Léa', lastName: 'Martin', email: 'lea@trinity.market', role: 'employee' };
const manager: User = { ...employee, id: 'u2', firstName: 'Karim', lastName: 'Benali', role: 'manager' };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const unauthorized = () => json(401, { error: { code: 'UNAUTHENTICATED', message: 'Session expirée' } });

let fetchMock: ReturnType<typeof vi.fn>;
const calledPaths = () => fetchMock.mock.calls.map(([url]) => String(url).replace('/api/v1', ''));

// Answers each path with its handler; unknown paths fail the test loudly
function mockBackend(routes: Record<string, () => Response>) {
  fetchMock.mockImplementation(async (url: string) => {
    const path = url.replace('/api/v1', '');
    const handler = routes[path];
    if (!handler) {
      throw new Error(`Unexpected request: ${path}`);
    }
    return handler();
  });
}

function LoginProbe() {
  const location = useLocation();
  const { login } = useAuth();
  return (
    <>
      <p>Login page</p>
      <p>from: {(location.state as LoginLocationState | null)?.from}</p>
      <button type="button" onClick={() => void login({ email: employee.email, password: 'secret' })}>
        Sign in
      </button>
    </>
  );
}

function ProtectedData() {
  const { isError } = useQuery({ queryKey: ['clocks'], queryFn: () => api.get('/clocks/current') });
  return <p>{isError ? 'failed' : 'loading data'}</p>;
}

const routes: RouteObject[] = [
  { path: LOGIN_PATH, element: <LoginProbe /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <Layout />,
        children: [
          { index: true, element: <p>Home page</p> },
          { path: 'pointage', element: <ProtectedData /> },
          {
            element: <RequireRole roles={MANAGER_ROLES} />,
            children: [{ path: 'utilisateurs', element: <p>Users page</p> }],
          },
        ],
      },
    ],
  },
];

function renderApp(initialPath = '/') {
  const router = createMemoryRouter(routes, { initialEntries: [initialPath] });
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return router;
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  queryClient.clear();
  vi.unstubAllGlobals();
});

describe('RequireAuth', () => {
  it('redirects a visitor to the login page and remembers the requested page', async () => {
    mockBackend({ '/auth/me': unauthorized, '/auth/refresh': unauthorized });

    const router = renderApp('/utilisateurs?page=2');

    expect(await screen.findByText('Login page')).toBeInTheDocument();
    expect(screen.getByText('from: /utilisateurs?page=2')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(LOGIN_PATH);
  });

  it('shows a loading status while the session is checked', () => {
    fetchMock.mockReturnValue(new Promise(() => {}));

    renderApp();

    expect(screen.getByRole('status')).toHaveTextContent('Chargement de votre session');
  });

  it('restores the session from the cookies after a page reload', async () => {
    mockBackend({ '/auth/me': () => json(200, employee) });

    renderApp();

    expect(await screen.findByText('Home page')).toBeInTheDocument();
    expect(screen.getByText('Léa Martin')).toBeInTheDocument();
    expect(screen.getByText('Employé')).toBeInTheDocument();
    // Sidebar and tab bar share a label but CSS shows only one, which jsdom cannot apply: audit them apart
    await expectNoA11yViolations(document.querySelector('.sidebar')!);
    await expectNoA11yViolations(screen.getByRole('main'));
  });

  it('renews an expired access token before restoring the session', async () => {
    let refreshed = false;
    mockBackend({
      '/auth/me': () => (refreshed ? json(200, employee) : unauthorized()),
      '/auth/refresh': () => {
        refreshed = true;
        return new Response(null, { status: 204 });
      },
    });

    renderApp();

    expect(await screen.findByText('Home page')).toBeInTheDocument();
    expect(calledPaths()).toEqual(['/auth/me', '/auth/refresh', '/auth/me']);
  });

  it('offers a retry when the server cannot be reached', async () => {
    queryClient.setQueryDefaults(ME_QUERY_KEY, { retry: false });
    let up = false;
    mockBackend({ '/auth/me': () => (up ? json(200, employee) : json(503, {})) });

    renderApp();

    expect(await screen.findByRole('alert')).toHaveTextContent('Impossible de joindre le serveur');
    up = true;
    await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByText('Home page')).toBeInTheDocument();
  });

  it('sends the user to login when the session ends while browsing', async () => {
    mockBackend({
      '/auth/me': () => json(200, employee),
      '/clocks/current': unauthorized,
      '/auth/refresh': unauthorized,
    });

    renderApp('/pointage');

    expect(await screen.findByText('Login page')).toBeInTheDocument();
  });
});

describe('RequireRole', () => {
  it('keeps an employee out of the manager pages', async () => {
    mockBackend({ '/auth/me': () => json(200, employee) });

    renderApp('/utilisateurs');

    expect(await screen.findByText('Vous n’avez pas accès à cette page.')).toBeInTheDocument();
    expect(screen.queryByText('Users page')).not.toBeInTheDocument();
  });

  it.each([manager, { ...manager, role: 'admin' as const }])('lets a $role open the manager pages', async (user) => {
    mockBackend({ '/auth/me': () => json(200, user) });

    renderApp('/utilisateurs');

    expect(await screen.findByText('Users page')).toBeInTheDocument();
  });
});

describe('login and logout', () => {
  it('signs in and stores the returned user', async () => {
    mockBackend({
      '/auth/me': unauthorized,
      '/auth/refresh': unauthorized,
      '/auth/login': () => json(200, employee),
    });
    const router = renderApp();
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));

    await router.navigate('/');

    expect(await screen.findByText('Home page')).toBeInTheDocument();
    expect(fetchMock.mock.calls.find(([url]) => String(url).endsWith('/auth/login'))?.[1].body).toBe(
      JSON.stringify({ email: employee.email, password: 'secret' }),
    );
  });

  it('signs out, forgets the cached data and goes back to login', async () => {
    mockBackend({ '/auth/me': () => json(200, employee), '/auth/logout': () => new Response(null, { status: 204 }) });
    renderApp();
    await screen.findByText('Home page');
    queryClient.setQueryData(['clocks'], { id: 'c1' });

    await userEvent.click(screen.getAllByRole('button', { name: 'Se déconnecter' })[0]);

    expect(await screen.findByText('Login page')).toBeInTheDocument();
    expect(calledPaths()).toContain('/auth/logout');
    expect(queryClient.getQueryData(['clocks'])).toBeUndefined();
  });

  it('signs out locally even when the logout request fails', async () => {
    mockBackend({ '/auth/me': () => json(200, employee), '/auth/logout': () => json(500, {}) });
    renderApp();
    await screen.findByText('Home page');

    await userEvent.click(screen.getAllByRole('button', { name: 'Se déconnecter' })[0]);

    expect(await screen.findByText('Login page')).toBeInTheDocument();
  });
});
