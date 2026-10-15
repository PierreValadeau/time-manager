import { useCallback, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import {
  AuthContext,
  ME_QUERY_KEY,
  type AuthContextValue,
  type AuthState,
  type Credentials,
  type User,
} from './auth-context';

// The session lives in httpOnly cookies: asking the backend is the only way to know who is signed in
async function fetchMe(): Promise<User | null> {
  try {
    return await api.get<User>('/auth/me');
  } catch (error) {
    // 401 after a failed refresh: no session, which is a normal answer here
    if (error instanceof ApiError && error.status === 401) {
      return null;
    }
    throw error;
  }
}

function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { data, status, refetch } = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: fetchMe,
    // Fetched once per page load; an expired session is caught by the global 401 handler
    staleTime: Infinity,
  });

  const login = useCallback(
    async (credentials: Credentials) => {
      const user = await api.post<User>('/auth/login', credentials);
      queryClient.setQueryData(ME_QUERY_KEY, user);
      return user;
    },
    [queryClient],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // The local session is dropped anyway: the user asked to leave
    }
    queryClient.setQueryData(ME_QUERY_KEY, null);
    // Nothing of the previous user may stay in the cache for the next one
    queryClient.removeQueries({ predicate: ({ queryKey }) => queryKey[0] !== ME_QUERY_KEY[0] });
  }, [queryClient]);

  const retry = useCallback(() => void refetch(), [refetch]);

  const value = useMemo<AuthContextValue>(() => {
    let state: AuthState;
    if (data) {
      state = { status: 'authenticated', user: data };
    } else if (data === null) {
      state = { status: 'anonymous', user: null };
    } else {
      state = { status: status === 'error' ? 'error' : 'loading', user: null };
    }
    return { ...state, login, logout, retry };
  }, [data, status, login, logout, retry]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export default AuthProvider;
