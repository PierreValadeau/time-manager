import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

// anomaly: forgotten clock-out, beyond the backend threshold and not corrected yet
export type SessionStatus = 'open' | 'closed' | 'anomaly';

// Session object of the API contract, section 6 (dates as ISO strings)
export type Session = {
  id: string;
  userId: string;
  clockIn: string;
  clockOut: string | null;
  // Only set on a closed session
  workedMinutes: number | null;
  status: SessionStatus;
};

export type Paginated<T> = {
  data: T[];
  meta: { page: number; limit: number; total: number };
};

// Every clock query of the signed-in user starts with this key, so one invalidation refreshes them all
export const MY_CLOCKS_KEY = ['clocks', 'me'] as const;
const CURRENT_KEY = [...MY_CLOCKS_KEY, 'current'] as const;

// Highest page size the API accepts: far more sessions than a single day holds
const DAY_SESSIONS_LIMIT = 100;

// Open or forgotten session of the signed-in user, null when off duty
export function useCurrentSession() {
  return useQuery({
    queryKey: CURRENT_KEY,
    queryFn: () => api.get<Session | null>('/users/me/clocks/current'),
  });
}

// Sessions started on the given local day (YYYY-MM-DD), oldest first
export function useDaySessions(day: string) {
  return useQuery({
    queryKey: [...MY_CLOCKS_KEY, 'day', day],
    queryFn: () =>
      api.get<Paginated<Session>>(`/users/me/clocks?from=${day}&to=${day}&limit=${DAY_SESSIONS_LIMIT}`),
    // The API lists the most recent first
    select: (page) => page.data.toReversed(),
  });
}

// POST /clocks toggles: clock-in without an open session, clock-out otherwise.
// Refreshes the state even on failure: a 409 means another request changed it
export function useToggleClock() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<Session>('/clocks'),
    onSettled: () => queryClient.invalidateQueries({ queryKey: MY_CLOCKS_KEY }),
  });
}
