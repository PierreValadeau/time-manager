import { Navigate, Outlet, useLocation } from 'react-router';
import { Alert, Button } from '../components/ui';
import { hasRole, useAuth, useCurrentUser, type Role } from './auth-context';
import './guards.css';

export const LOGIN_PATH = '/connexion';

// Where the login page sends the user back once signed in
export type LoginLocationState = { from?: string };

// Child routes are only rendered for a signed-in user; visitors go to the login page
export function RequireAuth() {
  const auth = useAuth();
  const location = useLocation();

  if (auth.status === 'loading') {
    return (
      <div className="auth-screen" role="status">
        Chargement de votre session…
      </div>
    );
  }

  if (auth.status === 'error') {
    return (
      <div className="auth-screen">
        <Alert tone="error">
          {auth.reason === 'network'
            ? 'Impossible de joindre le serveur. Vérifiez votre connexion puis réessayez.'
            : 'Le serveur n’a pas pu vérifier votre session. Réessayez dans quelques instants.'}
        </Alert>
        <Button variant="secondary" onClick={auth.retry}>
          Réessayer
        </Button>
      </div>
    );
  }

  if (auth.status === 'anonymous') {
    const from = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to={LOGIN_PATH} replace state={{ from } satisfies LoginLocationState} />;
  }

  return <Outlet />;
}

// Child routes are only rendered for the given roles; must sit under <RequireAuth>
export function RequireRole({ roles }: { roles: readonly Role[] }) {
  const user = useCurrentUser();

  if (!hasRole(user, roles)) {
    return (
      <section className="card">
        <p>Vous n’avez pas accès à cette page.</p>
      </section>
    );
  }

  return <Outlet />;
}
