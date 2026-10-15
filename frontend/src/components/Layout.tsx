import { useState } from 'react';
import { NavLink, Outlet } from 'react-router';
import { ClockIcon, SignOutIcon } from '@phosphor-icons/react';
import { ROLE_LABELS, useAuth, useCurrentUser, type User } from '../auth/auth-context';
import { APP_NAME, usePageTitle } from '../lib/page-title';
import { navItemsFor } from '../lib/navigation';
import { Button } from './ui';
import './Layout.css';

const todayLabel = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const initials = ({ firstName, lastName }: User) => `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();

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

// Signs out once: a second click while the request runs is ignored
function useLogout() {
  const { logout } = useAuth();
  const [pending, setPending] = useState(false);

  const handleLogout = async () => {
    setPending(true);
    try {
      await logout();
    } finally {
      setPending(false);
    }
  };

  return { pending, handleLogout };
}

// Layout commun à toutes les pages : navigation, en-tête de page, contenu de la route courante
function Layout() {
  const title = usePageTitle();
  const user = useCurrentUser();
  const { pending, handleLogout } = useLogout();
  const navItems = navItemsFor(user.role);
  const fullName = `${user.firstName} ${user.lastName}`;

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Aller au contenu
      </a>

      <aside className="sidebar">
        <Brand />
        <nav aria-label="Navigation principale" className="sidebar-nav">
          {navItems.map(({ to, label, icon: ItemIcon }) => (
            <NavLink key={to} to={to} end className="sidebar-link">
              <ItemIcon size={18} aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-user">
          <span className="avatar" aria-hidden="true">
            {initials(user)}
          </span>
          <div className="sidebar-user-text">
            <span className="sidebar-user-name">{fullName}</span>
            <span className="sidebar-user-role">{ROLE_LABELS[user.role]}</span>
          </div>
          <Button variant="icon" aria-label="Se déconnecter" loading={pending} onClick={handleLogout}>
            <SignOutIcon size={18} aria-hidden="true" />
          </Button>
        </div>
      </aside>

      <div className="app-content">
        <main id="main" tabIndex={-1}>
          <header className="page-header">
            <div className="page-heading">
              <span className="page-date">{todayLabel.format(new Date())}</span>
              <h1>{title}</h1>
            </div>
            {/* The sidebar is hidden on mobile: sign-out moves to the page header */}
            <Button
              variant="icon"
              className="header-logout"
              aria-label="Se déconnecter"
              loading={pending}
              onClick={handleLogout}
            >
              <SignOutIcon size={20} aria-hidden="true" />
            </Button>
          </header>
          <Outlet />
        </main>

        <nav aria-label="Navigation principale" className="tabbar">
          {navItems.map(({ to, short, icon: ItemIcon }) => (
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
