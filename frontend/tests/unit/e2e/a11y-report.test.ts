import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { COMMENT_MARKER, readReports, toMarkdown, type PageReport } from '../../../e2e/a11y-report.ts';

const clean: PageReport = { page: 'Accueil', path: '/', project: 'desktop', violations: [], incomplete: [] };

const failing: PageReport = {
  page: 'Accueil',
  path: '/',
  project: 'mobile',
  violations: [
    {
      id: 'color-contrast',
      impact: 'serious',
      help: 'Elements must meet minimum color contrast ratio thresholds',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.13/color-contrast',
      targets: ['.tabbar-link', '.page-date'],
    },
  ],
  incomplete: [
    {
      id: 'color-contrast',
      impact: 'serious',
      help: 'Elements must meet minimum color contrast ratio thresholds',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.13/color-contrast',
      targets: ['.sidebar-link'],
    },
  ],
};

describe('toMarkdown', () => {
  it('starts with the marker used to find the PR comment again', () => {
    expect(toMarkdown([clean]).startsWith(COMMENT_MARKER)).toBe(true);
  });

  it('reports success when no page has a violation', () => {
    const markdown = toMarkdown([clean]);
    expect(markdown).toContain('✅ No violation found.');
    expect(markdown).toContain('| Accueil (`/`) | desktop | ✅ 0 | 0 |');
    expect(markdown).not.toContain('<details>');
  });

  it('counts violations and lists each rule with its elements', () => {
    const markdown = toMarkdown([clean, failing]);
    expect(markdown).toContain('❌ 1 violation(s) found.');
    expect(markdown).toContain('| Accueil (`/`) | mobile | ❌ 1 | 1 |');
    expect(markdown).toContain('### Accueil · mobile');
    expect(markdown).toContain('**[color-contrast](https://dequeuniversity.com/rules/axe/4.13/color-contrast)** (serious)');
    expect(markdown).toContain('  - `.tabbar-link`');
    expect(markdown).toContain('  - `.page-date`');
    expect(markdown).not.toContain('### Accueil · desktop');
  });

  it('lists the undecided checks in a collapsed, non-blocking section', () => {
    const markdown = toMarkdown([clean, failing]);
    const details = markdown.slice(markdown.indexOf('<details>'));
    expect(details).toContain('**Accueil · mobile**');
    expect(details).toContain('  - `.sidebar-link`');
    expect(details.trimEnd().endsWith('</details>')).toBe(true);
  });

  it('says the audit did not run when there is no result', () => {
    expect(toMarkdown([])).toContain('❌ No result: the audit did not run');
  });

  it('does not show a green result when the audit failed without any violation', () => {
    // A page crashed before axe ran: only the other pages wrote a report
    const markdown = toMarkdown([clean], true);
    expect(markdown).toContain('❌ The audit failed before checking every page');
    expect(markdown).not.toContain('✅ No violation found.');
  });

  it('keeps the violation count when the audit failed because of violations', () => {
    const markdown = toMarkdown([clean, failing], true);
    expect(markdown).toContain('❌ 1 violation(s) found.');
    expect(markdown).not.toContain('failed before checking every page');
  });
});

describe('readReports', () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('reads the JSON reports in name order and ignores other files', async () => {
    dir = await mkdtemp(join(tmpdir(), 'a11y-'));
    await writeFile(join(dir, 'mobile-.json'), JSON.stringify(failing));
    await writeFile(join(dir, 'desktop-.json'), JSON.stringify(clean));
    await writeFile(join(dir, 'summary.md'), '# old');

    expect(await readReports(dir)).toEqual([clean, failing]);
  });

  it('returns no report when the folder does not exist', async () => {
    expect(await readReports(join(tmpdir(), 'a11y-missing-folder'))).toEqual([]);
  });
});
