import { HouseIcon, type Icon } from '@phosphor-icons/react';
import type { Role } from '../auth/auth-context';

export type NavItem = {
  to: string;
  label: string;
  // Shorter label for the mobile tab bar
  short: string;
  icon: Icon;
  // Roles that see the entry; everyone when omitted
  roles?: readonly Role[];
};

// Navigation entries: sidebar on desktop, tab bar on mobile
export const NAV_ITEMS: NavItem[] = [{ to: '/', label: 'Accueil', short: 'Accueil', icon: HouseIcon }];

// Hides the entries the role cannot open (the routes are guarded by <RequireRole> anyway)
export function navItemsFor(role: Role, items: readonly NavItem[] = NAV_ITEMS): NavItem[] {
  return items.filter((item) => !item.roles || item.roles.includes(role));
}
