import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api, apiFetch, ApiError } from '../../../src/lib/api';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const apiError = (status: number, code: string, message: string, details?: unknown) =>
  json(status, { error: { code, message, details } });

const unauthorized = () => apiError(401, 'UNAUTHORIZED', 'Session expirée');

let fetchMock: ReturnType<typeof vi.fn>;

// Chemins appelés, sans le préfixe /api/v1
const calledPaths = () => fetchMock.mock.calls.map(([url]) => String(url).replace('/api/v1', ''));

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiFetch: requests', () => {
  it('prefixes the path, sends cookies and asks for JSON', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { status: 'ok' }));

    await api.get('/health');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/health');
    expect(init).toMatchObject({ method: 'GET', credentials: 'include', headers: { Accept: 'application/json' } });
    expect(init.headers).not.toHaveProperty('Content-Type');
    expect(init.headers).not.toHaveProperty('Authorization');
    expect(init.body).toBeUndefined();
  });

  it('serializes the body as JSON with its Content-Type', async () => {
    fetchMock.mockResolvedValueOnce(json(201, { id: '1' }));

    await api.post('/teams', { name: 'Finance' });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.body).toBe('{"name":"Finance"}');
  });

  it('lets the caller add headers', async () => {
    fetchMock.mockResolvedValueOnce(json(200, {}));

    await api.get('/health', { headers: { 'X-Request-Id': 'abc' } });

    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ Accept: 'application/json', 'X-Request-Id': 'abc' });
  });
});

describe('apiFetch: responses', () => {
  it('returns the decoded JSON body', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { status: 'ok' }));

    await expect(api.get('/health')).resolves.toEqual({ status: 'ok' });
  });

  it('returns undefined on 204', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(api.delete('/teams/1')).resolves.toBeUndefined();
  });

  it('returns undefined on a 200 with an empty body', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 200 }));

    await expect(api.put('/me', {})).resolves.toBeUndefined();
  });

  it('throws an ApiError, not a SyntaxError, on a 200 that is not JSON', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>proxy</html>', { status: 200 }));

    await expect(api.get('/health')).rejects.toMatchObject({ name: 'ApiError', status: 200, code: 'INTERNAL_ERROR' });
  });
});

describe('apiFetch: errors', () => {
  it('maps the backend error format to an ApiError', async () => {
    const details = [{ field: 'email', issue: 'Email invalide' }];
    fetchMock.mockResolvedValueOnce(apiError(400, 'VALIDATION_ERROR', 'Requête invalide', details));

    const error = await api.post('/users', {}).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', message: 'Requête invalide', details });
  });

  it('falls back to INTERNAL_ERROR when the error body is not in the backend format', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Bad Gateway', { status: 502 }));

    await expect(api.get('/health')).rejects.toMatchObject({ status: 502, code: 'INTERNAL_ERROR' });
  });

  it('lets a network failure through', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(api.get('/health')).rejects.toThrow(TypeError);
  });
});

describe('apiFetch: session refresh on 401', () => {
  it('refreshes the session then replays the request once', async () => {
    fetchMock
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(json(200, { id: 'me' }));

    await expect(api.get('/users/me')).resolves.toEqual({ id: 'me' });
    expect(calledPaths()).toEqual(['/users/me', '/auth/refresh', '/users/me']);
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'POST', credentials: 'include' });
  });

  it('replays the request with the same method and body', async () => {
    fetchMock
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(json(201, {}));

    await api.post('/clocks', { action: 'in' });

    const replay = fetchMock.mock.calls[2][1];
    expect(replay.method).toBe('POST');
    expect(replay.body).toBe('{"action":"in"}');
  });

  it('throws the original 401 when the refresh is refused', async () => {
    fetchMock.mockResolvedValueOnce(unauthorized()).mockResolvedValueOnce(unauthorized());

    await expect(api.get('/users/me')).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
    expect(calledPaths()).toEqual(['/users/me', '/auth/refresh']);
  });

  it('throws the original 401 when the refresh fails on the network', async () => {
    fetchMock.mockResolvedValueOnce(unauthorized()).mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(api.get('/users/me')).rejects.toMatchObject({ status: 401 });
  });

  it('does not refresh twice when the replayed request is still 401', async () => {
    fetchMock
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(unauthorized());

    await expect(api.get('/users/me')).rejects.toMatchObject({ status: 401 });
    expect(calledPaths()).toEqual(['/users/me', '/auth/refresh', '/users/me']);
  });

  it.each(['/auth/login', '/auth/refresh'])('never refreshes on a 401 from %s', async (path) => {
    fetchMock.mockResolvedValueOnce(apiError(401, 'INVALID_CREDENTIALS', 'Email ou mot de passe incorrect'));

    await expect(apiFetch(path, { method: 'POST' })).rejects.toMatchObject({ status: 401 });
    expect(calledPaths()).toEqual([path]);
  });

  it('does not refresh on a 403', async () => {
    fetchMock.mockResolvedValueOnce(apiError(403, 'FORBIDDEN', 'Accès refusé'));

    await expect(api.get('/teams')).rejects.toMatchObject({ status: 403 });
    expect(calledPaths()).toEqual(['/teams']);
  });

  it('shares a single refresh between concurrent 401s', async () => {
    let endRefresh!: (res: Response) => void;
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/auth/refresh')) {
        return new Promise<Response>((resolve) => {
          endRefresh = resolve;
        });
      }
      // Premier passage 401, rejeu 200
      const seen = calledPaths().filter((p) => `/api/v1${p}` === url).length;
      return Promise.resolve(seen === 1 ? unauthorized() : json(200, { url }));
    });

    const requests = Promise.all([api.get('/users/me'), api.get('/teams')]);
    await vi.waitFor(() => expect(endRefresh).toBeDefined());
    endRefresh(new Response(null, { status: 204 }));

    await expect(requests).resolves.toEqual([{ url: '/api/v1/users/me' }, { url: '/api/v1/teams' }]);
    expect(calledPaths().filter((p) => p === '/auth/refresh')).toHaveLength(1);
  });

  it('starts a new refresh once the previous one has finished', async () => {
    fetchMock
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(json(200, {}))
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(json(200, {}));

    await api.get('/users/me');
    await api.get('/users/me');

    expect(calledPaths().filter((p) => p === '/auth/refresh')).toHaveLength(2);
  });
});
