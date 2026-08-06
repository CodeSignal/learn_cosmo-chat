import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compare, fingerprint, readBaseline, writeBaseline } from './baseline.mjs';

const BASE = process.env.A11Y_BASE_URL ?? 'http://localhost:3100';
const OUT = process.env.A11Y_OUT ?? 'a11y-out';
fs.mkdirSync(OUT, { recursive: true });

// CI mode skips the live-agent send flow (no Octavus in Actions) and stubs the
// API so the app boots without credentials. It still covers empty + settings +
// settings-with-dropdown in both color schemes — the states that carry today's
// known axe baseline.
const CI = process.env.A11Y_CI === '1';
const BASELINE_PATH = process.env.A11Y_BASELINE;
const UPDATE_BASELINE = process.env.A11Y_UPDATE_BASELINE === '1';
const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_BASELINE = path.join(TOOLS_DIR, 'baseline.json');

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

function srgb(c) {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
function lum([r, g, b]) {
  return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
}
function ratio(a, b) {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
function parse(str) {
  const m = String(str).match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
  return { rgb: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 };
}

async function tabWalk(page) {
  return page.evaluate(() => {
    const seen = [];
    const describe = (el) => {
      if (!el) return null;
      const cs = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        cls: (el.className && typeof el.className === 'string' ? el.className : '').slice(0, 80),
        role: el.getAttribute('role'),
        name: el.getAttribute('aria-label') || (el.textContent || '').trim().slice(0, 40),
        outlineWidth: cs.outlineWidth,
        outlineStyle: cs.outlineStyle,
        outlineColor: cs.outlineColor,
        boxShadow: cs.boxShadow === 'none' ? null : cs.boxShadow.slice(0, 90),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      };
    };
    return { describe: describe(document.activeElement) };
  });
}

async function walkTabOrder(page, steps = 22) {
  const stops = [];
  await page.evaluate(() => document.body.focus());
  for (let i = 0; i < steps; i++) {
    await page.keyboard.press('Tab');
    const { describe } = await tabWalk(page);
    if (!describe) break;
    stops.push(describe);
    if (describe.tag === 'body') break;
  }
  return stops;
}

// Sample real foreground/background pairs from the live DOM.
async function contrastSample(page) {
  // Opacity is read from computed style, so a fade-in caught mid-flight reports
  // a transient value and invents contrast failures. Let finite animations
  // finish first; the looping ones (thinking pulse, cursor) never would.
  await page.evaluate(async () => {
    const finite = document.getAnimations().filter((a) => {
      const timing = a.effect?.getComputedTiming?.();
      return timing && timing.iterations !== Infinity;
    });
    await Promise.race([
      Promise.all(finite.map((a) => a.finished.catch(() => {}))),
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);
  });

  return page.evaluate(() => {
    function toRgb(s) {
      const m = String(s).match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
      return { rgb: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 };
    }
    // Opacity multiplies down the tree, and text is composited over its
    // backdrop before contrast applies. Ignoring it under-reports faded text —
    // .composer__hint sits at opacity 0.8 and reads 3.05:1 raw but 2.44:1 as
    // rendered.
    function chainOpacity(el) {
      let out = 1;
      let node = el;
      while (node && node !== document.documentElement) {
        const v = parseFloat(getComputedStyle(node).opacity);
        if (Number.isFinite(v)) out *= v;
        node = node.parentElement;
      }
      return out;
    }
    function effectiveBg(el) {
      let node = el;
      while (node && node !== document.documentElement) {
        const c = toRgb(getComputedStyle(node).backgroundColor);
        if (c && c.a > 0.95) return c.rgb;
        node = node.parentElement;
      }
      const c = toRgb(getComputedStyle(document.body).backgroundColor);
      return c ? c.rgb : [255, 255, 255];
    }
    // 1.4.3 exempts text that is part of an inactive component. Disabled rows
    // are faded to 0.4, so measuring them reports failures that are not real.
    function isInactive(el) {
      return !!el.closest('[disabled], [aria-disabled="true"], .settings-row--disabled');
    }
    const out = [];
    const sel = [
      '.sidebar__title', '.sidebar__nav-label', '.sidebar__history-heading',
      '.sidebar__model-static', '.session-item__title', '.empty-state__heading',
      '.composer__hint', '.composer__textarea', '.message__bubble', '.message__body',
      '.message__thoughts-summary', '.message__ai-status', '.code-block__lang',
      '.message__stopped', '.settings-row__label', '.settings-row__desc',
      '.settings-row__value', '.modal-title', '.dropdown-toggle-label',
      '.tag', '.button-secondary', '.button-primary', '.composer__thumb-file-ext',
    ];
    for (const s of sel) {
      for (const el of document.querySelectorAll(s)) {
        const cs = getComputedStyle(el);
        if (!el.getBoundingClientRect().width) continue;
        if (isInactive(el)) continue;
        const fg = toRgb(cs.color);
        if (!fg) continue;
        out.push({
          sel: s,
          color: cs.color,
          opacity: chainOpacity(el),
          bg: `rgb(${effectiveBg(el).join(', ')})`,
          fontSize: cs.fontSize,
          fontWeight: cs.fontWeight,
          text: (el.textContent || '').trim().slice(0, 30),
        });
        break;
      }
    }
    // Placeholder colour needs its own pass.
    const ta = document.querySelector('.composer__textarea');
    if (ta) {
      out.push({
        sel: '.composer__textarea::placeholder',
        color: getComputedStyle(ta, '::placeholder').color,
        opacity: chainOpacity(ta),
        bg: `rgb(${effectiveBg(ta).join(', ')})`,
        fontSize: getComputedStyle(ta, '::placeholder').fontSize,
        fontWeight: getComputedStyle(ta, '::placeholder').fontWeight,
        text: ta.placeholder,
      });
    }
    return out;
  });
}

async function scan(page, label) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return {
    label,
    violations: results.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      tags: v.tags.filter((t) => t.startsWith('wcag') || t === 'best-practice'),
      nodes: v.nodes.slice(0, 4).map((n) => ({
        target: n.target.join(' '),
        summary: (n.failureSummary || '').replace(/\s+/g, ' ').slice(0, 240),
      })),
      total: v.nodes.length,
    })),
    incomplete: results.incomplete.map((v) => ({ id: v.id, help: v.help, count: v.nodes.length })),
  };
}

async function maybeScreenshot(page, name) {
  if (CI) return;
  await page.screenshot({ path: `${OUT}/${name}`, fullPage: name.includes('empty') ? false : undefined });
}

/**
 * Stub the JSON API so the app boots without Octavus. Used only in CI mode —
 * the full local audit still talks to a real server/agent.
 */
async function installCiApiStub(page) {
  const config = {
    temperature: 0.7,
    allowCustomInstructions: true,
    customInstructions: '',
    hideSettings: false,
    hideHistory: false,
    hideFileUpload: false,
    hidePromptControls: false,
    hideModelSettings: false,
    model: 'anthropic/claude-sonnet-4-6',
    allowedModels: ['anthropic/claude-sonnet-4-6'],
    thinking: 'medium',
    showReasoning: true,
  };
  const models = ['anthropic/claude-sonnet-4-6'];
  const capabilities = {
    'anthropic/claude-sonnet-4-6': { supportsThinking: true },
  };
  // Two rows so nested-interactive matches the shape the audit recorded
  // (active session + another history item), not a single-item sidebar.
  const sessions = [
    {
      session_id: 'session-1',
      title: 'New conversation',
      created_at: '2026-08-05T00:00:00.000Z',
      updated_at: '2026-08-05T12:00:00.000Z',
    },
    {
      session_id: 'session-0',
      title: 'Earlier chat',
      created_at: '2026-08-04T00:00:00.000Z',
      updated_at: '2026-08-04T00:00:00.000Z',
    },
  ];

  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const pathname = url.pathname;
    const method = req.method();
    const json = (data, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(data),
      });

    if (pathname === '/api/session' && method === 'GET') {
      return json({ sessionId: 'session-1', messages: [] });
    }
    if (pathname === '/api/sessions' && method === 'GET') {
      return json({ sessions });
    }
    if (pathname === '/api/sessions' && method === 'POST') {
      return json({ sessionId: 'session-2', messages: [] });
    }
    if (pathname === '/api/config' && method === 'GET') {
      return json(config);
    }
    if (pathname === '/api/models' && method === 'GET') {
      return json({ models, capabilities });
    }
    if (pathname === '/api/session/save' && method === 'POST') {
      return json({ ok: true });
    }
    if (pathname === '/api/config/custom-instructions' && method === 'POST') {
      return json({ ok: true });
    }
    return json({ ok: true });
  });
}

// Defaults to system Chrome because Playwright's bundled Chromium was missing
// on the audit machine. In CI, run `playwright install chromium` and set
// A11Y_BROWSER_CHANNEL=bundled.
const CHANNEL = process.env.A11Y_BROWSER_CHANNEL ?? 'chrome';
const LAUNCH = CHANNEL === 'bundled' ? {} : { channel: CHANNEL };

async function run(scheme) {
  const browser = await chromium.launch(LAUNCH);
  const ctx = await browser.newContext({
    colorScheme: scheme,
    viewport: { width: 1440, height: 900 },
  });
  const page = await ctx.newPage();
  const report = { scheme, scans: [], tabOrder: null, contrast: [], notes: [] };

  if (CI) {
    await installCiApiStub(page);
    report.notes.push('CI mode: API stubbed; streaming/with-messages states skipped (no live agent)');
  }

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  if (CI) {
    // Fail fast if the stub/boot path broke — an axe scan of the boot-error
    // screen would silently drift away from the real baseline.
    const visible = await page.locator('.chat-app').evaluate((el) => getComputedStyle(el).visibility);
    if (visible === 'hidden') {
      const bootText = await page.locator('#bootError').textContent().catch(() => '');
      throw new Error(`App did not boot in CI mode (chat-app still hidden). bootError: ${bootText}`);
    }
  }

  const boot = await page.locator('#bootError').isVisible().catch(() => false);
  report.notes.push(`bootError visible: ${boot}`);

  // 1. Empty state
  report.scans.push(await scan(page, 'empty-state'));
  await maybeScreenshot(page, `${scheme}-01-empty.png`);
  if (!CI) {
    report.tabOrder = await walkTabOrder(page);
    report.contrast.push({ state: 'empty', pairs: await contrastSample(page) });
  }

  // 2. Send a prompt to get real message content rendered (full audit only)
  if (!CI) {
    try {
      await page.fill('#promptInput', 'In two short sentences, what is a prompt? Then show a tiny python code block.');
      await page.click('#sendBtn');
      await page.waitForTimeout(1200);
      report.scans.push(await scan(page, 'streaming'));
      await maybeScreenshot(page, `${scheme}-02-streaming.png`);

      // aria-live sanity: how much text sits inside the live region while streaming
      report.notes.push(
        'live region text length while streaming: ' +
        (await page.evaluate(() => (document.querySelector('#chatHistory')?.textContent || '').length)),
      );

      await page.waitForFunction(
        () => !document.querySelector('.message--ai--streaming'),
        null,
        { timeout: 60000 },
      ).catch(() => report.notes.push('stream did not finish within 60s'));
      await page.waitForTimeout(800);
      report.scans.push(await scan(page, 'with-messages'));
      await maybeScreenshot(page, `${scheme}-03-messages.png`);
      report.contrast.push({ state: 'messages', pairs: await contrastSample(page) });

      // focus-destruction test: focus a copy button, force a re-render, see where focus lands
      const focusTest = await page.evaluate(() => {
        const btn = document.querySelector('.message__hover-btn, .code-block__copy');
        if (!btn) return 'no action button found';
        btn.focus();
        const before = document.activeElement?.className;
        document.querySelector('#chatHistory .messages')?.dispatchEvent(new Event('x'));
        return `focused: ${before}`;
      });
      report.notes.push(`hover-action focus test: ${focusTest}`);
    } catch (e) {
      report.notes.push(`send flow failed: ${e.message.slice(0, 160)}`);
    }
  }

  // 3. Settings modal
  try {
    await page.evaluate(() => document.querySelector('#settingsBtn')?.click());
    await page.waitForTimeout(700);
    const modalOpen = await page.locator('.modal-overlay.open').count();
    report.notes.push(`settings modal open: ${modalOpen > 0}`);
    if (modalOpen) {
      report.scans.push(await scan(page, 'settings-modal'));
      await maybeScreenshot(page, `${scheme}-04-settings.png`);
      if (!CI) {
        report.contrast.push({ state: 'settings', pairs: await contrastSample(page) });

        // Does Tab escape the dialog?
        const trap = await page.evaluate(async () => {
          const dialog = document.querySelector('.modal-overlay.open');
          const inside = [];
          for (let i = 0; i < 14; i++) {
            const el = document.activeElement;
            inside.push({
              in: dialog.contains(el),
              tag: el?.tagName.toLowerCase(),
              cls: (typeof el?.className === 'string' ? el.className : '').slice(0, 50),
            });
            // synthetic Tab is unreliable in evaluate; rely on playwright below
            break;
          }
          return inside;
        });
        const trapWalk = [];
        for (let i = 0; i < 14; i++) {
          await page.keyboard.press('Tab');
          trapWalk.push(await page.evaluate(() => {
            const d = document.querySelector('.modal-overlay.open');
            const el = document.activeElement;
            return {
              insideDialog: d ? d.contains(el) : null,
              tag: el?.tagName.toLowerCase(),
              id: el?.id || null,
              cls: (typeof el?.className === 'string' ? el.className : '').slice(0, 45),
            };
          }));
        }
        report.notes.push(`modal initial focus: ${JSON.stringify(trap)}`);
        report.modalTabWalk = trapWalk;

        // duplicate id check
        report.notes.push(await page.evaluate(() => {
          const ids = [...document.querySelectorAll('[id]')].map((e) => e.id);
          const dupes = ids.filter((v, i) => ids.indexOf(v) !== i);
          return `duplicate ids: ${JSON.stringify([...new Set(dupes)])}`;
        }));
      }

      // open the Thinking dropdown, check portal + aria
      await page.evaluate(() => document.querySelector('#thinkingDropdownEl .dropdown-toggle')?.click());
      await page.waitForTimeout(400);
      report.notes.push(await page.evaluate(() => {
        const menu = document.querySelector('.dropdown-menu--portaled');
        const dialog = document.querySelector('.modal-overlay.open');
        const active = document.activeElement;
        return `thinking menu portaled: ${!!menu}; menu inside dialog: ${menu && dialog ? dialog.contains(menu) : 'n/a'}; focus after open: ${active?.tagName}.${typeof active?.className === 'string' ? active.className.slice(0, 30) : ''}; options with aria-selected: ${document.querySelectorAll('.dropdown-menu-item[aria-selected]').length}/${document.querySelectorAll('.dropdown-menu-item').length}`;
      }));
      report.scans.push(await scan(page, 'settings-modal-dropdown-open'));
      await maybeScreenshot(page, `${scheme}-05-dropdown.png`);
    }
  } catch (e) {
    report.notes.push(`settings flow failed: ${e.message.slice(0, 160)}`);
  }

  // 4. Reflow at 320px (full audit only)
  if (!CI) {
    try {
      await page.setViewportSize({ width: 320, height: 720 });
      await page.waitForTimeout(500);
      const overflow = await page.evaluate(() => ({
        docScrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
      }));
      report.notes.push(`320px reflow: ${JSON.stringify(overflow)}`);
      await maybeScreenshot(page, `${scheme}-06-320px.png`);
    } catch (e) {
      report.notes.push(`reflow failed: ${e.message.slice(0, 120)}`);
    }
  }

  await browser.close();
  return report;
}

// Isolated design-system dropdown page (the app only exposes one model, so the
// model dropdown never renders in-app). Skipped in CI — the test page's landmark
// noise would dominate the baseline without guarding the app.
async function runDsDropdown(scheme) {
  const browser = await chromium.launch(LAUNCH);
  const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  const out = { scheme, notes: [] };
  try {
    await page.goto(`${BASE}/design-system/components/dropdown/test.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    out.axe = await scan(page, 'ds-dropdown-test');
    await page.evaluate(() => document.querySelector('.dropdown-toggle')?.click());
    await page.waitForTimeout(400);
    out.notes.push(await page.evaluate(() => {
      const t = document.querySelector('.dropdown-toggle');
      const menu = document.querySelector('.dropdown-container.open .dropdown-menu');
      return JSON.stringify({
        toggleRole: t?.getAttribute('role'),
        ariaHaspopup: t?.getAttribute('aria-haspopup'),
        ariaExpanded: t?.getAttribute('aria-expanded'),
        ariaControls: t?.getAttribute('aria-controls'),
        menuRole: menu?.getAttribute('role'),
        optionParentRole: menu?.querySelector('.dropdown-menu-item')?.parentElement?.getAttribute('role'),
        optionTag: menu?.querySelector('.dropdown-menu-item')?.tagName,
        ariaSelectedCount: menu?.querySelectorAll('[aria-selected]').length,
        optionCount: menu?.querySelectorAll('[role=option]').length,
        focusAfterOpen: document.activeElement?.tagName + '.' + (typeof document.activeElement?.className === 'string' ? document.activeElement.className : ''),
      });
    }));
    // ArrowDown from the toggle — does it move into the list?
    await page.evaluate(() => document.querySelector('.dropdown-toggle')?.focus());
    await page.keyboard.press('ArrowDown');
    out.notes.push('after ArrowDown on toggle, focus = ' + await page.evaluate(() => document.activeElement?.className || document.activeElement?.tagName));
    // Select an item by keyboard and see where focus lands
    await page.evaluate(() => document.querySelector('.dropdown-menu-item')?.focus());
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    out.notes.push('after Enter on option, focus = ' + await page.evaluate(() => {
      const el = document.activeElement;
      return (el?.tagName || '') + '.' + (typeof el?.className === 'string' ? el.className : '') + ' | isBody=' + (el === document.body);
    }));
    out.axeOpen = await scan(page, 'ds-dropdown-open');
    await maybeScreenshot(page, `${scheme}-07-ds-dropdown.png`);
  } catch (e) {
    out.notes.push(`ds dropdown failed: ${e.message.slice(0, 160)}`);
  }
  await browser.close();
  return out;
}

const all = {};
for (const scheme of ['light', 'dark']) {
  all[scheme] = await run(scheme);
  if (!CI) {
    all[`${scheme}-ds-dropdown`] = await runDsDropdown(scheme);
  }
}

// Post-process contrast
for (const key of Object.keys(all)) {
  const r = all[key];
  if (!r.contrast) continue;
  for (const group of r.contrast) {
    for (const p of group.pairs) {
      const fg = parse(p.color);
      const bg = parse(p.bg);
      if (!fg || !bg) continue;
      const size = parseFloat(p.fontSize);
      const bold = Number(p.fontWeight) >= 700;
      const large = size >= 24 || (size >= 18.66 && bold);
      // Composite the text over its backdrop first: contrast applies to what is
      // actually painted, not to the declared colour.
      const alpha = fg.a * (typeof p.opacity === 'number' ? p.opacity : 1);
      const painted = fg.rgb.map((c, i) => c * alpha + bg.rgb[i] * (1 - alpha));
      p.effectiveColor = `rgb(${painted.map((c) => Math.round(c)).join(', ')})`;
      p.ratio = Number(ratio(painted, bg.rgb).toFixed(2));
      p.required = large ? 3 : 4.5;
      p.pass = p.ratio >= p.required;
    }
  }
}

fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(all, null, 2));
console.log('WROTE', `${OUT}/report.json`);
for (const [k, v] of Object.entries(all)) {
  console.log(`\n===== ${k} =====`);
  (v.notes || []).forEach((n) => console.log('  note:', n));
  for (const s of v.scans || []) {
    console.log(`  [${s.label}] violations: ${s.violations.length}`);
    for (const vi of s.violations) console.log(`    - ${vi.impact}/${vi.id} (${vi.total}) ${vi.help}`);
  }
  if (v.axe) {
    console.log(`  [ds closed] ${v.axe.violations.map((x) => x.impact + '/' + x.id).join(', ')}`);
  }
  if (v.axeOpen) {
    console.log(`  [ds open] ${v.axeOpen.violations.map((x) => x.impact + '/' + x.id).join(', ')}`);
  }
  for (const g of v.contrast || []) {
    const fails = g.pairs.filter((p) => p.pass === false);
    if (fails.length) {
      console.log(`  contrast fails (${g.state}):`);
      fails.forEach((f) => console.log(`    ${f.sel}: ${f.ratio}:1 (need ${f.required}) ${f.color} on ${f.bg} @${f.fontSize}`));
    }
  }
}

// ── Baseline gate ─────────────────────────────────────────────
const actual = fingerprint(all);
const baselineFile = BASELINE_PATH || (CI || UPDATE_BASELINE ? DEFAULT_BASELINE : null);

if (UPDATE_BASELINE) {
  writeBaseline(baselineFile, actual);
  console.log(`\nUpdated shrink-only baseline at ${baselineFile}`);
  console.log(JSON.stringify(actual, null, 2));
} else if (baselineFile) {
  if (!fs.existsSync(baselineFile)) {
    console.error(`\nBaseline file not found: ${baselineFile}`);
    console.error('Capture one with A11Y_UPDATE_BASELINE=1');
    process.exit(1);
  }
  const baseline = readBaseline(baselineFile);
  const result = compare(actual, baseline.scans || baseline);
  if (result.improvements.length) {
    console.log('\nBaseline improvements (update baseline.json in this PR):');
    result.improvements.forEach((line) => console.log(`  ✓ ${line}`));
  }
  if (result.missingScans.length) {
    console.error('\nMissing scans vs baseline (audit did not cover expected states):');
    result.missingScans.forEach((line) => console.error(`  ✗ ${line}`));
  }
  if (result.regressions.length) {
    console.error('\nAxe baseline regressions:');
    result.regressions.forEach((line) => console.error(`  ✗ ${line}`));
  }
  if (!result.ok) {
    console.error('\nAccessibility CI gate failed. The baseline is shrink-only.');
    console.error('Note: axe cannot detect live-region over-announcement (A1).');
    process.exit(1);
  }
  if (result.improvements.length) {
    console.log('\nReminder: commit an updated baseline.json so the floor ratchets down.');
  }
  console.log('\nAxe baseline gate passed (shrink-only).');
  console.log('Note: axe cannot detect live-region over-announcement (A1) — a green gate is not conformance.');
}

