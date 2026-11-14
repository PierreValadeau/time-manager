import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import AuthProvider from '../../../src/auth/AuthProvider';
import { RequireAuth } from '../../../src/auth/guards';
import type { Role, User } from '../../../src/auth/auth-context';
import { ToastProvider } from '../../../src/components/ui';
import type { Session } from '../../../src/lib/clocks';
import { queryClient } from '../../../src/lib/queryClient';
import HomePage from '../../../src/pages/HomePage';
import { expectNoA11yViolations } from '../components/ui/axe';

const user = (role: Role): User => ({ id: 'u1', firstName: 'Léa', lastName: 'Martin', email: 'lea@trinity.market', role });

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const apiError = (status: number, code: string) => json(status, { error: { code, message: code } });

// Today at the given local time, as the API sends it
const at = (hours: number, minutes: number) => {
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date.toISOString();
};

const session = (overrides: Partial<Session>): Session => ({
  id: 's1',
  userId: 'u1',
  clockIn: at(8, 47),
  clockOut: null,
  workedMinutes: null,
  status: 'open',
  ...overrides,
});

let role: Role;
let current: Session | null;
let today: Session[];
let toggleResponse: () => Response | Promise<Response>;
let fetchMock: ReturnType<typeof vi.fn>;

const calls = (method: string, path: string) =>
  fetchMock.mock.calls.filter(([url, init]) => (init?.method ?? 'GET') === method && String(url).includes(path));

beforeEach(() => {
  role = 'employee';
  current = null;
  today = [];
  toggleResponse = () => apiError(500, 'INTERNAL_ERROR');
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/auth/me')) return json(200, user(role));
    if (url.endsWith('/users/me/clocks/current')) return json(200, current);
    if (url.includes('/users/me/clocks?')) return json(200, { data: [...today].reverse(), meta: { page: 1, limit: 100, total: today.length } });
    if (url.endsWith('/clocks') && init?.method === 'POST') return toggleResponse();
    return apiError(404, 'NOT_FOUND');
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  queryClient.clear();
  vi.unstubAllGlobals();
});

function renderHome() {
  const router = createMemoryRouter([{ element: <RequireAuth />, children: [{ index: true, element: <HomePage /> }] }]);
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

const clockButton = (name: string | RegExp) => screen.findByRole('button', { name });
const history = () => screen.getByRole('region', { name: 'Pointages du jour' });

describe('HomePage: clock state', () => {
  it('offers to clock in when nobody has clocked yet', async () => {
    renderHome();

    expect(await clockButton('Pointer mon arrivée')).toBeInTheDocument();
    expect(screen.getByText('Pas encore pointé')).toBeInTheDocument();
    expect(await within(history()).findByText('Aucun pointage aujourd’hui.')).toBeInTheDocument();
    await expectNoA11yViolations(document.body);
  });

  it('shows the running session and offers to clock out', async () => {
    current = session({});
    today = [current];
    renderHome();

    expect(await clockButton('Pointer mon départ')).toBeInTheDocument();
    expect(screen.getByText('En poste depuis 08:47')).toBeInTheDocument();
    const events = await within(history()).findAllByRole('listitem');
    expect(events.map((event) => event.textContent)).toEqual(['Arrivée08:47', 'DépartEn cours']);
  });

  it('lists the closed sessions of the day and the last clock-out', async () => {
    today = [
      session({ id: 's1', clockIn: at(8, 47), clockOut: at(12, 31), workedMinutes: 224, status: 'closed' }),
      session({ id: 's2', clockIn: at(13, 30), clockOut: at(17, 0), workedMinutes: 210, status: 'closed' }),
    ];
    renderHome();

    expect(await screen.findByText('Hors poste · dernier départ 17:00')).toBeInTheDocument();
    expect(screen.getByText(/7h14 travaillées aujourd’hui/)).toBeInTheDocument();
    const events = within(history()).getAllByRole('listitem');
    expect(events.map((event) => event.textContent)).toEqual(['Arrivée08:47', 'Départ12:31', 'Arrivée13:30', 'Départ17:00']);
  });

  it('offers to clock in after a forgotten clock-out and explains it', async () => {
    current = session({ clockIn: '2026-10-23T07:00:00.000Z', status: 'anomaly' });
    renderHome();

    expect(await clockButton('Pointer mon arrivée')).toBeInTheDocument();
    expect(screen.getByText(/Votre départ du 23 octobre n’a pas été pointé/)).toBeInTheDocument();
  });

  it('does not offer to clock to the admin', async () => {
    role = 'admin';
    renderHome();

    expect(await screen.findByText('Le pointage est réservé aux employés et aux managers.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(calls('GET', '/clocks')).toHaveLength(0);
  });

  it('lets the user retry when the state cannot be loaded', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith('/auth/me') ? json(200, user('employee')) : apiError(403, 'FORBIDDEN'),
    );
    renderHome();

    expect(await screen.findByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Impossible de récupérer votre pointage');
  });
});

describe('HomePage: clocking', () => {
  it('clocks in, announces the server time and switches to clock-out', async () => {
    const created = session({ clockIn: at(9, 2) });
    toggleResponse = () => {
      current = created;
      today = [created];
      return json(201, created);
    };
    renderHome();

    await userEvent.click(await clockButton('Pointer mon arrivée'));

    expect(await screen.findByText('Arrivée enregistrée à 09:02')).toBeInTheDocument();
    expect(await clockButton('Pointer mon départ')).toBeInTheDocument();
    expect(calls('POST', '/clocks')).toHaveLength(1);
  });

  it('clocks out and announces it', async () => {
    current = session({});
    today = [current];
    const closed = session({ clockOut: at(17, 30), workedMinutes: 523, status: 'closed' });
    toggleResponse = () => {
      current = null;
      today = [closed];
      return json(200, closed);
    };
    renderHome();

    await userEvent.click(await clockButton('Pointer mon départ'));

    expect(await screen.findByText('Départ enregistré à 17:30')).toBeInTheDocument();
    expect(await clockButton('Pointer mon arrivée')).toBeInTheDocument();
  });

  it('sends a single request when the button is clicked twice', async () => {
    let resolveToggle!: (response: Response) => void;
    toggleResponse = () => new Promise((resolve) => (resolveToggle = resolve));
    renderHome();

    const button = await clockButton('Pointer mon arrivée');
    await userEvent.dblClick(button);
    expect(button).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(button);

    expect(calls('POST', '/clocks')).toHaveLength(1);
    resolveToggle(json(201, session({ clockIn: at(9, 2) })));
    expect(await screen.findByText('Arrivée enregistrée à 09:02')).toBeInTheDocument();
  });

  it('reloads the state and explains a 409', async () => {
    toggleResponse = () => {
      // A concurrent request clocked in first
      current = session({});
      today = [current];
      return apiError(409, 'CONFLICT');
    };
    renderHome();
    await clockButton('Pointer mon arrivée');
    const currentCalls = calls('GET', '/clocks/current').length;

    await userEvent.click(screen.getByRole('button', { name: 'Pointer mon arrivée' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Un autre pointage était en cours'));
    expect(await clockButton('Pointer mon départ')).toBeInTheDocument();
    expect(calls('GET', '/clocks/current').length).toBeGreaterThan(currentCalls);
  });

  it('explains any other failure and clears it on the next success', async () => {
    renderHome();

    await userEvent.click(await clockButton('Pointer mon arrivée'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Pointage impossible pour le moment'));

    toggleResponse = () => json(201, session({ clockIn: at(9, 2) }));
    await userEvent.click(screen.getByRole('button', { name: 'Pointer mon arrivée' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeEmptyDOMElement());
  });
});
