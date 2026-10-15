import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Result } from 'axe-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { REPORT_DIR, type PageReport, type Violation } from './a11y-report.ts';

// Main pages of the app: add each new page here
const PAGES = [
  { name: 'Accueil', path: '/' },
  { name: 'Page introuvable', path: '/page-inexistante' },
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

test.beforeEach(async ({ page }) => {
  // No backend in CI: answer the API so each page renders a stable state
  await page.route('**/api/**', route => route.fulfill({ json: { status: 'ok' } }));
});

for (const { name, path } of PAGES) {
  test(`${name} (${path}) has no WCAG AA violation`, async ({ page }, testInfo) => {
    await page.goto(path);
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
