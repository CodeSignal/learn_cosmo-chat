import { chromium } from 'playwright';

const BASE = process.env.A11Y_BASE_URL ?? 'http://localhost:3100';
const OUT = '/tmp/a11y-audit/out';

function srgb(c) { const v = c / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
function lum([r, g, b]) { return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b); }
function ratio(a, b) { const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x); return ((l1 + 0.05) / (l2 + 0.05)).toFixed(2); }
const rgb = (s) => String(s).match(/\d+/g).slice(0, 3).map(Number);

for (const scheme of ['light', 'dark']) {
  const browser = await chromium.launch({ channel: 'chrome' });
  const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: 1200, height: 820 } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  console.log(`\n===== ${scheme} =====`);

  // Composer focus indicator
  const composer = await page.evaluate(() => {
    const box = document.querySelector('.chatbox');
    const ta = document.querySelector('#promptInput');
    const ring = document.querySelector('.cosmo-ai-ring');
    const glow = document.querySelector('.cosmo-ai-glow');
    const snap = () => ({
      boxBg: getComputedStyle(box).backgroundColor,
      ringDisplay: getComputedStyle(ring).display,
      ringOpacity: getComputedStyle(ring).opacity,
      glowDisplay: getComputedStyle(glow).display,
      taOutline: getComputedStyle(ta).outlineStyle + ' ' + getComputedStyle(ta).outlineWidth,
      taShadow: getComputedStyle(ta).boxShadow,
      taBorder: getComputedStyle(ta).borderColor,
    });
    const before = snap();
    ta.focus();
    return { before, after: snap() };
  });
  await page.waitForTimeout(400);
  console.log(' composer unfocused:', JSON.stringify(composer.before));
  console.log(' composer focused  :', JSON.stringify(composer.after));
  const same = composer.before.boxBg === composer.after.boxBg;
  console.log(` -> background changes on focus: ${!same}; ring rendered: ${composer.after.ringDisplay !== 'none'}`);
  await page.screenshot({ path: `${OUT}/${scheme}-focus-composer.png`, clip: { x: 240, y: 600, width: 800, height: 200 } });

  // Focus ring contrast for the app's standard indicator
  const ringInfo = await page.evaluate(() => {
    const btn = document.querySelector('#newChatBtn');
    btn.focus();
    const cs = getComputedStyle(btn);
    let bgEl = btn, bg = 'rgba(0, 0, 0, 0)';
    while (bgEl) { const c = getComputedStyle(bgEl).backgroundColor; if (!/, 0\)$/.test(c)) { bg = c; break; } bgEl = bgEl.parentElement; }
    return { outlineColor: cs.outlineColor, outlineWidth: cs.outlineWidth, adjacentBg: bg };
  });
  console.log(` focus ring ${ringInfo.outlineColor} on ${ringInfo.adjacentBg} = ${ratio(rgb(ringInfo.outlineColor), rgb(ringInfo.adjacentBg))}:1 (needs 3:1 per 1.4.11 / 2.4.11)`);

  // Target sizes (WCAG 2.2 2.5.8 -> 24x24 minimum)
  const targets = await page.evaluate(() => {
    const sel = ['#uploadImageBtn', '#uploadFileBtn', '#sendBtn', '.session-item__delete', '.button-icon', '.sidebar-resizer'];
    const out = [];
    for (const s of sel) {
      const el = document.querySelector(s);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      out.push({ sel: s, w: Math.round(r.width), h: Math.round(r.height) });
    }
    return out;
  });
  console.log(' target sizes:', targets.map((t) => `${t.sel}=${t.w}x${t.h}${Math.min(t.w, t.h) < 24 ? ' <-- under 24' : ''}`).join(', '));

  // Live-region / re-render behaviour: does the whole log get replaced?
  const rerender = await page.evaluate(() => {
    const log = document.querySelector('#chatHistory');
    return {
      role: log.getAttribute('role'),
      ariaLive: log.getAttribute('aria-live'),
      ariaAtomic: log.getAttribute('aria-atomic'),
      ariaRelevant: log.getAttribute('aria-relevant'),
      ariaBusy: log.getAttribute('aria-busy'),
      tag: log.tagName,
    };
  });
  console.log(' chat log region:', JSON.stringify(rerender));

  // Does the prompt textarea get disabled mid-stream (focus loss)?
  await page.fill('#promptInput', 'Say hello in one short sentence.');
  await page.click('#sendBtn');
  await page.waitForTimeout(1500);
  const midStream = await page.evaluate(() => ({
    textareaDisabled: document.querySelector('#promptInput')?.disabled,
    activeElement: document.activeElement?.tagName + '.' + (typeof document.activeElement?.className === 'string' ? document.activeElement.className.slice(0, 30) : ''),
    isBody: document.activeElement === document.body,
    sendBtnLabel: document.querySelector('#sendBtn')?.getAttribute('aria-label'),
  }));
  console.log(' mid-stream:', JSON.stringify(midStream));

  // Thoughts <details> state survival across re-render
  await page.waitForFunction(() => !document.querySelector('.message--ai--streaming'), null, { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(600);

  // Focus survival: focus a copy button then trigger a re-render via a new render pass
  const focusSurvival = await page.evaluate(async () => {
    const btn = document.querySelector('.message__hover-btn');
    if (!btn) return 'no hover button';
    btn.focus();
    const before = document.activeElement?.getAttribute('aria-label');
    // Force the same re-render path the streaming loop uses
    const log = document.querySelector('#chatHistory .messages');
    log.innerHTML = log.innerHTML; // equivalent to renderMessages() wiping and rebuilding
    await new Promise((r) => setTimeout(r, 50));
    return `before=${before}; after=${document.activeElement?.tagName}; lostToBody=${document.activeElement === document.body}`;
  });
  console.log(' focus survival across re-render:', focusSurvival);

  await page.screenshot({ path: `${OUT}/${scheme}-final.png`, fullPage: false });
  await browser.close();
}
