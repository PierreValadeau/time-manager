import { describe, expect, it } from 'vitest';
import { HouseIcon, UsersIcon } from '@phosphor-icons/react';
import { MANAGER_ROLES } from '../../../src/auth/auth-context';
import { navItemsFor, type NavItem } from '../../../src/lib/navigation';

const items: NavItem[] = [
  { to: '/', label: 'Accueil', short: 'Accueil', icon: HouseIcon },
  { to: '/utilisateurs', label: 'Utilisateurs', short: 'Équipe', icon: UsersIcon, roles: MANAGER_ROLES },
];

const paths = (navItems: NavItem[]) => navItems.map(({ to }) => to);

describe('navItemsFor', () => {
  it('hides the manager entries from an employee', () => {
    expect(paths(navItemsFor('employee', items))).toEqual(['/']);
  });

  it.each(['manager', 'admin'] as const)('shows every entry to a %s', (role) => {
    expect(paths(navItemsFor(role, items))).toEqual(['/', '/utilisateurs']);
  });
});
