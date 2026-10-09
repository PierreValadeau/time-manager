import { createBrowserRouter } from 'react-router';
import Layout, { type RouteHandle } from './components/Layout';
import HomePage from './pages/HomePage';
import NotFoundPage from './pages/NotFoundPage';

export const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { index: true, element: <HomePage />, handle: { title: 'Accueil' } satisfies RouteHandle },
      { path: '*', element: <NotFoundPage />, handle: { title: 'Page introuvable' } satisfies RouteHandle },
    ],
  },
]);
