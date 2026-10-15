import { rm } from 'node:fs/promises';
import { REPORT_DIR } from './a11y-report.ts';

// Runs once before the audit: removes the reports of the previous run,
// so a page taken out of PAGES does not stay in the local summary
export default async function globalSetup() {
  await rm(REPORT_DIR, { recursive: true, force: true });
}
