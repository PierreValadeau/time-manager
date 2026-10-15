import { createBrowserRouter } from 'react-router';
import Layout from './components/Layout';
import { LOGIN_PATH, RequireAuth } from './auth/guards';
import type { RouteHandle } from './lib/page-title';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import NotFoundPage from './pages/NotFoundPage';

// Manager pages go under <RequireRole roles={MANAGER_ROLES} />, inside the layout
export const router = createBrowserRouter([
  { path: LOGIN_PATH, element: <LoginPage />, handle: { title: 'Connexion' } satisfies RouteHandle },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <Layout />,
        children: [
          { index: true, element: <HomePage />, handle: { title: 'Accueil' } satisfies RouteHandle },
          { path: '*', element: <NotFoundPage />, handle: { title: 'Page introuvable' } satisfies RouteHandle },
        ],
      },
    ],
  },
]);
