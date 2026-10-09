import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';

const MAX_RETRIES = 2;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Rejouer une erreur client (400, 401, 403, 404…) donnerait le même résultat
      retry: (failureCount, error) =>
        !(error instanceof ApiError && error.status < 500) && failureCount < MAX_RETRIES,
    },
  },
});
