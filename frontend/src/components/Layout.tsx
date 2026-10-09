import { useEffect } from 'react';
import { NavLink, Outlet, useMatches } from 'react-router';
import { ClockIcon, HouseIcon, type Icon } from '@phosphor-icons/react';
import './Layout.css';

// Titre affiché en tête de page, déclaré par chaque route dans `handle`
export type RouteHandle = { title?: string };

type NavItem = { to: string; label: string; short: string; icon: Icon };

// Entrées de navigation : sidebar sur desktop, barre d'onglets sur mobile
const NAV_ITEMS: NavItem[] = [{ to: '/', label: 'Accueil', short: 'Accueil', icon: HouseIcon }];

const todayLabel = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const APP_NAME = 'Trinity Time';

// Titre de la route courante, repris dans l'onglet : c'est lui que le lecteur d'écran annonce (WCAG 2.4.2)
function usePageTitle(): string {
  const matches = useMatches();
  const handle = matches.at(-1)?.handle as RouteHandle | undefined;
  const title = handle?.title ?? APP_NAME;

  useEffect(() => {
    document.title = title === APP_NAME ? APP_NAME : `${title} · ${APP_NAME}`;
  }, [title]);

  return title;
}

function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark" aria-hidden="true">
        <ClockIcon size={16} />
      </span>
      <span className="brand-name">{APP_NAME}</span>
    </div>
  );
}

// Layout commun à toutes les pages : navigation, en-tête de page, contenu de la route courante
function Layout() {
  const title = usePageTitle();

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Aller au contenu
      </a>

      <aside className="sidebar">
        <Brand />
        <nav aria-label="Navigation principale" className="sidebar-nav">
          {NAV_ITEMS.map(({ to, label, icon: ItemIcon }) => (
            <NavLink key={to} to={to} end className="sidebar-link">
              <ItemIcon size={18} aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="app-content">
        <main id="main" tabIndex={-1}>
          <header className="page-header">
            <span className="page-date">{todayLabel.format(new Date())}</span>
            <h1>{title}</h1>
          </header>
          <Outlet />
        </main>

        <nav aria-label="Navigation principale" className="tabbar">
          {NAV_ITEMS.map(({ to, short, icon: ItemIcon }) => (
            <NavLink key={to} to={to} end className="tabbar-link">
              <ItemIcon size={22} aria-hidden="true" />
              {short}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}

export default Layout;
