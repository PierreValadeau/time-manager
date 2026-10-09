// Client API unique : toutes les requêtes vers le backend passent par ici
// La session vit dans des cookies httpOnly, jamais dans un header Authorization

const API_BASE = '/api/v1';

// Ces routes ne déclenchent pas de renouvellement : un 401 y est une réponse normale
const NO_REFRESH_PATHS = ['/auth/login', '/auth/refresh'];

export type ApiErrorDetail = { field: string; issue: string };

// Même forme que le { error: { code, message, details } } renvoyé par le backend
export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: ApiErrorDetail[];

  constructor(status: number, code: string, message: string, details?: ApiErrorDetail[]) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type RequestOptions = Omit<RequestInit, 'body'> & { body?: unknown };

async function toApiError(res: Response): Promise<ApiError> {
  const payload = await res.json().catch(() => null);
  const error = payload?.error;
  if (error && typeof error.code === 'string' && typeof error.message === 'string') {
    return new ApiError(res.status, error.code, error.message, error.details);
  }
  // Réponse hors format (proxy, backend arrêté…)
  return new ApiError(res.status, 'INTERNAL_ERROR', 'Erreur inattendue du serveur');
}

function send(path: string, { body, headers, ...init }: RequestOptions): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

// Un seul refresh en vol : les 401 simultanés attendent tous le même
let refreshing: Promise<boolean> | null = null;

function refreshSession(): Promise<boolean> {
  refreshing ??= send('/auth/refresh', { method: 'POST' })
    .then((res) => res.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let res = await send(path, options);

  // Access token expiré : on renouvelle la session puis on rejoue la requête une seule fois
  if (res.status === 401 && !NO_REFRESH_PATHS.includes(path) && (await refreshSession())) {
    res = await send(path, options);
  }

  if (!res.ok) {
    throw await toApiError(res);
  }
  // 204 ou 200 sans corps : rien à décoder
  const text = await res.text();
  if (!text) {
    return undefined as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(res.status, 'INTERNAL_ERROR', 'Réponse invalide du serveur');
  }
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => apiFetch<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiFetch<T>(path, { ...options, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiFetch<T>(path, { ...options, method: 'PUT', body }),
  delete: <T>(path: string, options?: RequestOptions) => apiFetch<T>(path, { ...options, method: 'DELETE' }),
};
