import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compare, fingerprint } from './baseline.mjs';

describe('fingerprint', () => {
  it('flattens scheme/state rule counts', () => {
    const fp = fingerprint({
      light: {
        scans: [
          {
            label: 'empty-state',
            violations: [
              { id: 'color-contrast', total: 3 },
              { id: 'region', total: 1 },
            ],
          },
        ],
      },
    });
    assert.deepEqual(fp, {
      'light/empty-state': { 'color-contrast': 3, region: 1 },
    });
  });
});

describe('compare', () => {
  const baseline = {
    'light/empty-state': { 'color-contrast': 3, region: 1 },
  };

  it('passes when counts match', () => {
    const result = compare(baseline, baseline);
    assert.equal(result.ok, true);
    assert.deepEqual(result.regressions, []);
  });

  it('passes when counts shrink', () => {
    const actual = { 'light/empty-state': { 'color-contrast': 2 } };
    const result = compare(actual, baseline);
    assert.equal(result.ok, true);
    assert.deepEqual(result.improvements, [
      'light/empty-state: color-contrast 3 → 2',
      'light/empty-state: region 1 → 0',
    ]);
  });

  it('fails when a count grows or a new rule appears', () => {
    const actual = {
      'light/empty-state': { 'color-contrast': 4, 'nested-interactive': 1, region: 1 },
    };
    const result = compare(actual, baseline);
    assert.equal(result.ok, false);
    assert.deepEqual(result.regressions, [
      'light/empty-state: color-contrast 3 → 4',
      'light/empty-state: nested-interactive 0 → 1',
    ]);
  });

  it('fails when a baseline scan is missing from the run', () => {
    const result = compare({}, baseline);
    assert.equal(result.ok, false);
    assert.deepEqual(result.missingScans, ['light/empty-state']);
  });
});
