/**
 * @vitest-environment node
 *
 * A6 — dark mode must not suppress the composer focus treatment.
 * jsdom does not load app.css, so this guards the tokens that caused the
 * failure (ring display none + focus bg identical to resting bg).
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const css = readFileSync(path.join(ROOT, 'public/app.css'), 'utf8');

function darkRootBlock(source) {
  const match = source.match(
    /@media \(prefers-color-scheme: dark\) \{\s*:root \{([\s\S]*?)\n  \}\n\}/,
  );
  return match?.[1] ?? '';
}

describe('composer focus indicator (A6)', () => {
  it('keeps the chatbox focus ring enabled in dark mode', () => {
    const dark = darkRootBlock(css);
    expect(dark.length).toBeGreaterThan(0);
    // Hiding the ring was half of the dark-mode failure.
    expect(dark).not.toMatch(/--chatbox-ring-display\s*:\s*none/);
    // Light :root still opts the ring in; dark must inherit or keep it on.
    expect(css).toMatch(/--chatbox-ring-display\s*:\s*block/);
  });

  it('does not force dark focus background equal to the resting chatbox bg', () => {
    const dark = darkRootBlock(css);
    expect(dark).toMatch(/--chatbox-bg\s*:/);
    // The A6 bug set both to Neutral-1250. Focus bg should come from :root
    // (Backgrounds-Main-Top) instead of mirroring --chatbox-bg here.
    expect(dark).not.toMatch(/--chatbox-focus-bg\s*:/);
  });
});
