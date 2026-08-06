/**
 * Shrink-only axe baseline helpers for the PR CI gate.
 *
 * The baseline maps "scheme/state" → { ruleId: nodeCount }. A run fails when a
 * rule appears that is not in the baseline, or when a rule's node count grows.
 * Counts may decrease freely; that is how fix PRs retire violations.
 *
 * axe cannot detect live-region over-announcement (finding A1). A green compare
 * is a floor, not WCAG conformance.
 */

import fs from 'node:fs';

/** Flatten an audit report into { "light/empty-state": { rule: count }, ... }. */
export function fingerprint(report) {
  const out = {};
  for (const [key, value] of Object.entries(report)) {
    if (!value || typeof value !== 'object') continue;

    for (const s of value.scans || []) {
      out[`${key}/${s.label}`] = countsFromViolations(s.violations);
    }
    if (value.axe) {
      out[`${key}/${value.axe.label}`] = countsFromViolations(value.axe.violations);
    }
    if (value.axeOpen) {
      out[`${key}/${value.axeOpen.label}`] = countsFromViolations(value.axeOpen.violations);
    }
  }
  return sortNested(out);
}

function countsFromViolations(violations = []) {
  const counts = {};
  for (const v of violations) {
    counts[v.id] = v.total ?? v.nodes?.length ?? 0;
  }
  return counts;
}

function sortNested(obj) {
  const out = {};
  for (const key of Object.keys(obj).sort()) {
    const inner = obj[key];
    out[key] = Object.fromEntries(Object.entries(inner).sort(([a], [b]) => a.localeCompare(b)));
  }
  return out;
}

export function readBaseline(path) {
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

export function writeBaseline(path, scans) {
  const doc = {
    $comment:
      'Shrink-only axe baseline for PR CI. Node counts may decrease; increases or new rules fail the build. axe cannot detect live-region over-announcement (A1) — a green gate is not conformance.',
    generated: new Date().toISOString().slice(0, 10),
    scans,
  };
  fs.writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);
}

/**
 * Compare an actual fingerprint against a checked-in baseline.
 * @returns {{ ok: boolean, regressions: string[], improvements: string[], missingScans: string[] }}
 */
export function compare(actual, baselineScans) {
  const regressions = [];
  const improvements = [];
  const missingScans = [];

  for (const scanKey of Object.keys(baselineScans).sort()) {
    if (!(scanKey in actual)) {
      missingScans.push(scanKey);
      continue;
    }
    const expected = baselineScans[scanKey];
    const got = actual[scanKey];

    for (const rule of new Set([...Object.keys(expected), ...Object.keys(got)])) {
      const before = expected[rule] ?? 0;
      const after = got[rule] ?? 0;
      if (after > before) {
        regressions.push(`${scanKey}: ${rule} ${before} → ${after}`);
      } else if (after < before) {
        improvements.push(`${scanKey}: ${rule} ${before} → ${after}`);
      }
    }
  }

  // A scan key that exists only in the actual run is fine (coverage grew), but
  // any violations there are by definition new and must fail.
  for (const scanKey of Object.keys(actual).sort()) {
    if (scanKey in baselineScans) continue;
    for (const [rule, count] of Object.entries(actual[scanKey])) {
      if (count > 0) regressions.push(`${scanKey}: ${rule} (new scan) 0 → ${count}`);
    }
  }

  return {
    ok: regressions.length === 0 && missingScans.length === 0,
    regressions,
    improvements,
    missingScans,
  };
}
