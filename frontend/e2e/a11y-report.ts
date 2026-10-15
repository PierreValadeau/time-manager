import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const REPORT_DIR = 'a11y-report';

export type Violation = {
  id: string;
  impact: string | null;
  help: string;
  helpUrl: string;
  targets: string[];
};

// `incomplete` = checks axe could not decide (e.g. text on a gradient): reported, not blocking
export type PageReport = {
  page: string;
  path: string;
  project: string;
  violations: Violation[];
  incomplete: Violation[];
};

// Hidden marker so the CI updates its own PR comment instead of adding a new one each push
export const COMMENT_MARKER = '<!-- a11y-report -->';

// auditFailed: the Playwright step failed. With no violation in the reports, a page crashed
// before being analyzed (no JSON written for it): the summary must not show a green result
export function toMarkdown(reports: PageReport[], auditFailed = false): string {
  const lines = [COMMENT_MARKER, '## Accessibility audit (axe, WCAG 2.2 AA)', ''];

  if (reports.length === 0) {
    lines.push('❌ No result: the audit did not run (see the job logs).');
    return lines.join('\n');
  }

  const total = reports.reduce((sum, { violations }) => sum + violations.length, 0);
  if (total > 0) {
    lines.push(`❌ ${total} violation(s) found.`, '');
  } else if (auditFailed) {
    lines.push('❌ The audit failed before checking every page (see the job logs).', '');
  } else {
    lines.push('✅ No violation found.', '');
  }

  lines.push('| Page | Viewport | Violations | To check manually |', '| --- | --- | --- | --- |');
  for (const { page, path, project, violations, incomplete } of reports) {
    const status = violations.length === 0 ? '✅ 0' : `❌ ${violations.length}`;
    lines.push(`| ${page} (\`${path}\`) | ${project} | ${status} | ${incomplete.length} |`);
  }

  for (const { page, project, violations } of reports.filter(({ violations }) => violations.length > 0)) {
    lines.push('', `### ${page} · ${project}`, '', ...listRules(violations));
  }

  const toCheck = reports.filter(({ incomplete }) => incomplete.length > 0);
  if (toCheck.length > 0) {
    lines.push('', '<details><summary>Checks axe could not decide (not blocking)</summary>');
    for (const { page, project, incomplete } of toCheck) {
      lines.push('', `**${page} · ${project}**`, '', ...listRules(incomplete));
    }
    lines.push('', '</details>');
  }

  return lines.join('\n');
}

function listRules(rules: Violation[]): string[] {
  return rules.flatMap(({ id, impact, help, helpUrl, targets }) => [
    `- **[${id}](${helpUrl})** (${impact ?? 'unknown'}): ${help}`,
    ...targets.map((target) => `  - \`${target}\``),
  ]);
}

export async function readReports(dir = REPORT_DIR): Promise<PageReport[]> {
  const files = (await readdir(dir).catch(() => [])).filter((file) => file.endsWith('.json')).sort();
  return Promise.all(files.map(async (file) => JSON.parse(await readFile(`${dir}/${file}`, 'utf8')) as PageReport));
}

// `node e2e/a11y-report.ts` writes the Markdown summary the CI posts on the PR.
// The CI passes the outcome of the audit step in AUDIT_OUTCOME (success, failure...)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // The folder is missing when the audit crashed before any page: still write the summary
  await mkdir(REPORT_DIR, { recursive: true });
  const auditFailed = process.env.AUDIT_OUTCOME === 'failure';
  await writeFile(`${REPORT_DIR}/summary.md`, toMarkdown(await readReports(), auditFailed));
}
