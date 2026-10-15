import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { ME_QUERY_KEY } from '../auth/auth-context';
import { ApiError } from './api';

const MAX_RETRIES = 2;

// Only a failed refresh ends the session: a 401 replayed after a successful refresh is a business error
// (e.g. wrong current password on PUT /auth/password) and must not sign the user out
function endSessionOnUnauthorized(error: Error) {
  if (error instanceof ApiError && error.sessionExpired) {
    queryClient.setQueryData(ME_QUERY_KEY, null);
  }
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: endSessionOnUnauthorized }),
  mutationCache: new MutationCache({ onError: endSessionOnUnauthorized }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Rejouer une erreur client (400, 401, 403, 404…) donnerait le même résultat
      retry: (failureCount, error) =>
        !(error instanceof ApiError && error.status < 500) && failureCount < MAX_RETRIES,
    },
  },
});
