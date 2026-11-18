// Run with: node --test .github/scripts/*.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findBlockingAdvisories } from './npm-audit.mjs';

const TODAY = '2026-11-18';

// An advisory as npm audit --json puts it in the `via` of the vulnerable package
const advisory = (id, severity, name = 'pkg') => ({
  source: 1,
  name,
  dependency: name,
  title: `${name} is vulnerable`,
  url: `https://github.com/advisories/${id}`,
  severity,
  range: '<=1.0.0',
});

// A report with one entry per package: { name: [via, ...] }
const report = packages => ({
  auditReportVersion: 2,
  vulnerabilities: Object.fromEntries(
    Object.entries(packages).map(([name, via]) => [name, { name, severity: 'high', via }]),
  ),
});

const exception = (id, expires = '2026-12-31') => ({ id, statement: 'reason', expires });

const ids = advisories => advisories.map(({ id }) => id);

describe('findBlockingAdvisories', () => {
  it('returns nothing for a clean report', () => {
    assert.deepEqual(findBlockingAdvisories(report({}), [], TODAY), {
      blocking: [],
      ignored: [],
      expired: [],
      unused: [],
    });
  });

  it('blocks a high advisory that is not in the allowlist', () => {
    const { blocking } = findBlockingAdvisories(report({ pkg: [advisory('GHSA-high', 'high')] }), [], TODAY);
    assert.deepEqual(blocking, [{ id: 'GHSA-high', name: 'pkg', severity: 'high', title: 'pkg is vulnerable' }]);
  });

  it('blocks a critical advisory that is not in the allowlist', () => {
    const { blocking } = findBlockingAdvisories(report({ pkg: [advisory('GHSA-crit', 'critical')] }), [], TODAY);
    assert.deepEqual(ids(blocking), ['GHSA-crit']);
  });

  it('lets moderate and low advisories through without listing them', () => {
    const result = findBlockingAdvisories(
      report({ a: [advisory('GHSA-mod', 'moderate', 'a')], b: [advisory('GHSA-low', 'low', 'b')] }),
      [],
      TODAY,
    );
    assert.deepEqual(result, { blocking: [], ignored: [], expired: [], unused: [] });
  });

  it('ignores an allowlisted advisory before its expiry date', () => {
    const result = findBlockingAdvisories(report({ pkg: [advisory('GHSA-ok', 'high')] }), [exception('GHSA-ok')], TODAY);
    assert.deepEqual(ids(result.ignored), ['GHSA-ok']);
    assert.deepEqual(result.blocking, []);
  });

  it('still ignores it on the expiry day itself', () => {
    const { blocking, ignored } = findBlockingAdvisories(
      report({ pkg: [advisory('GHSA-ok', 'high')] }),
      [exception('GHSA-ok', TODAY)],
      TODAY,
    );
    assert.deepEqual(ids(ignored), ['GHSA-ok']);
    assert.deepEqual(blocking, []);
  });

  it('blocks it again the day after the expiry date, and reports the exception as expired', () => {
    const result = findBlockingAdvisories(
      report({ pkg: [advisory('GHSA-old', 'high')] }),
      [exception('GHSA-old', '2026-11-17')],
      TODAY,
    );
    assert.deepEqual(ids(result.blocking), ['GHSA-old']);
    assert.deepEqual(result.expired, ['GHSA-old']);
    assert.deepEqual(result.ignored, []);
  });

  it('reports an exception that matches no advisory as unused, without blocking', () => {
    const result = findBlockingAdvisories(report({}), [exception('GHSA-gone')], TODAY);
    assert.deepEqual(result.unused, ['GHSA-gone']);
    assert.deepEqual(result.blocking, []);
  });

  it('does not count the packages that only depend on the vulnerable one', () => {
    // As npm reports picomatch: vite and vitest only name the package they go through
    const { blocking } = findBlockingAdvisories(
      report({
        picomatch: [advisory('GHSA-pico', 'high', 'picomatch')],
        vite: ['picomatch', 'tinyglobby'],
        vitest: ['vite'],
      }),
      [],
      TODAY,
    );
    assert.deepEqual(ids(blocking), ['GHSA-pico']);
  });

  it('keeps an advisory once when several packages list it', () => {
    const shared = advisory('GHSA-twice', 'high');
    const { blocking } = findBlockingAdvisories(report({ a: [shared], b: [shared] }), [], TODAY);
    assert.deepEqual(ids(blocking), ['GHSA-twice']);
  });

  it('only blocks the unknown advisory when an allowlisted one is reported too', () => {
    const result = findBlockingAdvisories(
      report({ a: [advisory('GHSA-ok', 'high', 'a')], b: [advisory('GHSA-new', 'critical', 'b')] }),
      [exception('GHSA-ok')],
      TODAY,
    );
    assert.deepEqual(ids(result.blocking), ['GHSA-new']);
    assert.deepEqual(ids(result.ignored), ['GHSA-ok']);
  });

  it('accepts a report without a vulnerabilities key', () => {
    assert.deepEqual(findBlockingAdvisories({}, [exception('GHSA-ok')], TODAY), {
      blocking: [],
      ignored: [],
      expired: [],
      unused: ['GHSA-ok'],
    });
  });
});
