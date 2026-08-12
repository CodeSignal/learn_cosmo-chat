/**
 * @vitest-environment node
 *
 * A9 — interactive targets must be ≥24×24 CSS pixels (WCAG 2.5.8).
 * jsdom does not layout app.css, so these guards assert the hit-area
 * declarations that produce measured ≥24×24 in the browser.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const css = readFileSync(path.join(ROOT, 'public/app.css'), 'utf8');

/** Body of the first top-level rule for `selector { ... }`. */
function ruleBody(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`${escaped} \\{([\\s\\S]*?)\\n\\}`));
  return match?.[1] ?? '';
}

/** Parse a CSS length in px from a declaration value, or null. */
function pxValue(body, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Require a declaration boundary so `width` does not match inside `min-width`
  // (same for `height` / `min-height`).
  const match = body.match(
    new RegExp(`(?:^|[;\\n])\\s*${escaped}\\s*:\\s*([^;]+);`),
  );
  if (!match) return null;
  const px = String(match[1])
    .replace(/!important/i, '')
    .trim()
    .match(/^(\d+(?:\.\d+)?)px$/);
  return px ? Number(px[1]) : null;
}

function assertMinTarget(body, label) {
  expect(body.length, `${label} rule missing`).toBeGreaterThan(0);

  const minW = pxValue(body, 'min-width');
  const minH = pxValue(body, 'min-height');
  const w = pxValue(body, 'width');
  const h = pxValue(body, 'height');

  const effectiveW = Math.max(minW ?? 0, w ?? 0);
  const effectiveH = Math.max(minH ?? 0, h ?? 0);

  expect(effectiveW, `${label} width`).toBeGreaterThanOrEqual(24);
  expect(effectiveH, `${label} height`).toBeGreaterThanOrEqual(24);
}

describe('interactive target size (A9)', () => {
  it('gives composer attach buttons a ≥24×24 hit area', () => {
    assertMinTarget(ruleBody(css, '.composer__icon-btn'), '.composer__icon-btn');
  });

  it('gives Send/Stop a ≥24×24 hit area', () => {
    assertMinTarget(ruleBody(css, '.composer__send-btn'), '.composer__send-btn');
  });

  it('gives delete conversation a ≥24×24 hit area', () => {
    assertMinTarget(ruleBody(css, '.session-item__delete'), '.session-item__delete');
  });

  it('keeps composer toolbar glyphs at 18px (hit area grows around the icon)', () => {
    const body = ruleBody(css, '.composer__toolbar-svg');
    expect(body).toMatch(/height\s*:\s*18px\s*;/);
  });
});
