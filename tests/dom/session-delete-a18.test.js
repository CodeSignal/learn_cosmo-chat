/**
 * @vitest-environment node
 *
 * A18 — session delete must be tappable without hover (WCAG 2.1.1).
 * jsdom cannot emulate `(hover: none)`, so this guards the stylesheet rule.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const css = readFileSync(path.join(ROOT, 'public/app.css'), 'utf8');

describe('session delete visibility (A18)', () => {
  it('shows delete under (hover: none) so touch can activate it', () => {
    const match = css.match(/@media \(hover: none\) \{([\s\S]*?)\n\}/);
    expect(match, 'missing @media (hover: none) block').toBeTruthy();
    const body = match[1];
    expect(body).toMatch(/\.session-item__delete\s*\{/);
    expect(body).toMatch(/opacity\s*:\s*1\s*;/);
    expect(body).toMatch(/pointer-events\s*:\s*auto\s*;/);
  });
});
