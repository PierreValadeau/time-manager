import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type { Result } from 'axe-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { REPORT_DIR, type PageReport, type Violation } from './a11y-report.ts';
import type { Role, User } from '../src/auth/auth-context.ts';

// Who is signed in when the page is audited: 'anonymous' for the public pages
type Session = Role | 'anonymous';

// Main pages of the app: add each new page here, with the session it needs
const PAGES: { name: string; path: string; session: Session }[] = [
  { name: 'Connexion', path: '/connexion', session: 'anonymous' },
  { name: 'Accueil', path: '/', session: 'employee' },
  { name: 'Page introuvable', path: '/page-inexistante', session: 'employee' },
];

// WCAG 2.2 level AA, the target chosen by the team
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

function toViolation({ id, impact, help, helpUrl, nodes }: Result): Violation {
  return {
    id,
    impact: impact ?? null,
    help,
    helpUrl,
    targets: nodes.map(node => node.target.join(' ')),
  };
}

const UNAUTHORIZED = { status: 401, json: { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } } };

function fakeUser(role: Role): User {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    firstName: 'Camille',
    lastName: 'Martin',
    email: 'camille.martin@example.com',
    role,
  };
}

// No backend in CI: each endpoint the pages call gets a realistic answer.
// Routes registered last are matched first, so the catch-all comes before the specific ones
async function mockApi(page: Page, session: Session) {
  await page.route('**/api/v1/**', route =>
    route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'Not mocked in e2e/a11y.spec.ts' } } }),
  );
  await page.route('**/api/v1/health', route => route.fulfill({ json: { status: 'ok' } }));
  // A visitor gets 401 on both: the app then shows the login page
  await page.route('**/api/v1/auth/refresh', route => route.fulfill(UNAUTHORIZED));
  await page.route('**/api/v1/auth/me', route =>
    route.fulfill(session === 'anonymous' ? UNAUTHORIZED : { json: fakeUser(session) }),
  );
}

for (const { name, path, session } of PAGES) {
  test(`${name} (${path}) has no WCAG AA violation`, async ({ page }, testInfo) => {
    await mockApi(page, session);
    await page.goto(path);
    // A guard redirect would audit another page than the one listed
    await expect(page).toHaveURL(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    const { violations, incomplete } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();

    // One file per page and viewport, merged into the PR summary by a11y-report.ts
    const report: PageReport = {
      page: name,
      path,
      project: testInfo.project.name,
      violations: violations.map(toViolation),
      incomplete: incomplete.map(toViolation),
    };
    await mkdir(REPORT_DIR, { recursive: true });
    const slug = `${testInfo.project.name}-${path.replace(/\W+/g, '-')}`;
    await writeFile(`${REPORT_DIR}/${slug}.json`, JSON.stringify(report, null, 2));

    expect(report.violations.map(({ id, targets }) => `${id}: ${targets.join(', ')}`)).toEqual([]);
  });
}
