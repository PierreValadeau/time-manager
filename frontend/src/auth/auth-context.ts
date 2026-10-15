import { createContext, useContext } from 'react';

export type Role = 'employee' | 'manager' | 'admin';

// Profile returned by POST /auth/login and GET /auth/me
export type User = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: Role;
};

export type Credentials = { email: string; password: string };

// Roles allowed on the manager pages (users, teams, reports)
export const MANAGER_ROLES: readonly Role[] = ['manager', 'admin'];

export const ROLE_LABELS: Record<Role, string> = {
  employee: 'Employé',
  manager: 'Manager',
  admin: 'Administrateur',
};

// Cache key of the signed-in user: null means nobody is signed in
export const ME_QUERY_KEY = ['auth', 'me'] as const;

export type AuthState =
  | { status: 'loading'; user: null }
  // The session could not be checked: 'network' when no response came back, 'server' for an error response
  | { status: 'error'; user: null; reason: 'network' | 'server' }
  | { status: 'anonymous'; user: null }
  | { status: 'authenticated'; user: User };

export type AuthContextValue = AuthState & {
  login: (credentials: Credentials) => Promise<User>;
  logout: () => Promise<void>;
  retry: () => void;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const auth = useContext(AuthContext);
  if (!auth) {
    throw new Error('useAuth must be used within an <AuthProvider>');
  }
  return auth;
}

// Signed-in user, for components rendered under <RequireAuth>
export function useCurrentUser(): User {
  const { user } = useAuth();
  if (!user) {
    throw new Error('useCurrentUser must be used under <RequireAuth>');
  }
  return user;
}

export function hasRole(user: User, roles: readonly Role[]): boolean {
  return roles.includes(user.role);
}
