// npm audit with an allowlist: npm cannot ignore one advisory, so this script does it.
// Same idea as .trivyignore.yaml: every exception has a reason and an expiry date.
// Run from backend/ or frontend/: node ../.github/scripts/npm-audit.mjs
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Severities that fail the build, as npm audit --audit-level=high did
const BLOCKING_SEVERITIES = ['high', 'critical'];

// report: output of npm audit --json; allowlist: [{ id, statement, expires }]; today: 'YYYY-MM-DD'
export function findBlockingAdvisories(report, allowlist, today) {
  // Each advisory is an object in the `via` of the vulnerable package; strings only point
  // to another package. The Map keeps an advisory once, even if several packages list it.
  const advisories = new Map();
  for (const pkg of Object.values(report.vulnerabilities ?? {})) {
    for (const via of pkg.via) {
      if (typeof via !== 'object') continue;
      const id = via.url.split('/').pop();
      advisories.set(id, { id, name: via.name, severity: via.severity, title: via.title });
    }
  }

  const blocking = [];
  const ignored = [];
  const expired = [];
  for (const advisory of advisories.values()) {
    if (!BLOCKING_SEVERITIES.includes(advisory.severity)) continue;

    const entry = allowlist.find(exception => exception.id === advisory.id);
    if (!entry) {
      blocking.push(advisory);
    } else if (today <= entry.expires) {
      // YYYY-MM-DD strings sort in date order; the expiry day itself is still covered
      ignored.push(advisory);
    } else {
      blocking.push(advisory);
      expired.push(advisory.id);
    }
  }

  // An exception that matches nothing can be removed (the package was fixed or dropped)
  const unused = allowlist.filter(exception => !advisories.has(exception.id)).map(exception => exception.id);

  return { blocking, ignored, expired, unused };
}

// Only when run with node, not when the test file imports this module
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  // npm audit exits with 1 as soon as it finds an advisory: the decision is made below, not by its status
  const result = spawnSync('npm', ['audit', '--json'], { encoding: 'utf8' });
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    report = undefined;
  }
  // On a network error npm still prints JSON, with { message, error } and no vulnerabilities:
  // anything but a real report fails, never "no advisory found"
  if (!report?.auditReportVersion || typeof report.vulnerabilities !== 'object') {
    console.error('npm audit did not return a report');
    console.error(report?.message || result.stderr || result.error?.message);
    process.exit(1);
  }

  const allowlist = JSON.parse(readFileSync(new URL('../npm-audit-allowlist.json', import.meta.url), 'utf8'));
  const today = new Date().toISOString().slice(0, 10);
  const { blocking, ignored, expired, unused } = findBlockingAdvisories(report, allowlist, today);

  for (const advisory of ignored) {
    const { statement, expires } = allowlist.find(exception => exception.id === advisory.id);
    console.log(`Ignored ${advisory.id} (${advisory.severity}, ${advisory.name}) until ${expires}: ${statement}`);
  }
  for (const id of expired) {
    console.warn(`Expired exception ${id}: renew it with a reason, or fix the dependency`);
  }
  for (const id of unused) {
    console.warn(`Unused exception ${id}: no advisory matches it anymore, remove it from npm-audit-allowlist.json`);
  }
  for (const advisory of blocking) {
    console.error(`${advisory.severity.toUpperCase()} ${advisory.id} in ${advisory.name}: ${advisory.title}`);
  }

  console.log(blocking.length > 0 ? `${blocking.length} blocking advisory(ies)` : 'No blocking advisory');
  process.exitCode = blocking.length > 0 ? 1 : 0;
}
