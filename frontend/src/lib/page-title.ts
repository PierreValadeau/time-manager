import { useEffect } from 'react';
import { useMatches } from 'react-router';

export const APP_NAME = 'Trinity Time';

// Page title, declared by each route in `handle`
export type RouteHandle = { title?: string };

// Title of the current route, mirrored in the tab: it is what screen readers announce (WCAG 2.4.2)
export function usePageTitle(): string {
  const matches = useMatches();
  const handle = matches.at(-1)?.handle as RouteHandle | undefined;
  const title = handle?.title ?? APP_NAME;

  useEffect(() => {
    document.title = title === APP_NAME ? APP_NAME : `${title} · ${APP_NAME}`;
  }, [title]);

  return title;
}
