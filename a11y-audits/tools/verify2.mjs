import { chromium } from 'playwright';

const BASE = process.env.A11Y_BASE_URL ?? 'http://localhost:3100';

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

// Make sure we have at least 2 sessions
const count = await page.locator('.session-item').count();
console.log('session items:', count);

const calls = [];
page.on('request', (r) => {
  if (r.url().includes('/api/session')) calls.push(`${r.method()} ${r.url().replace(BASE, '')}`);
});

// Focus the delete button of the second session, press Enter.
await page.evaluate(() => {
  const items = document.querySelectorAll('.session-item');
  const target = items[1] || items[0];
  target.querySelector('.session-item__delete').focus();
});
console.log('focused:', await page.evaluate(() => document.activeElement?.className));
await page.keyboard.press('Enter');
await page.waitForTimeout(1200);
console.log('network after Enter on Delete:', JSON.stringify(calls));
console.log('  -> DELETE fired:', calls.some((c) => c.startsWith('DELETE')));
console.log('  -> session switch (GET /api/session?id=) also fired:', calls.some((c) => c.includes('GET /api/session?id=')));

// Space key on a session item: does the page scroll / is default prevented?
calls.length = 0;
const spaceTest = await page.evaluate(() => {
  const item = document.querySelector('.session-item');
  item.focus();
  let defaultPrevented = null;
  item.addEventListener('keydown', (e) => { setTimeout(() => {}, 0); defaultPrevented = e.defaultPrevented; }, { once: false });
  const ev = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
  item.dispatchEvent(ev);
  return { defaultPrevented: ev.defaultPrevented };
});
console.log('Space on session item, defaultPrevented:', JSON.stringify(spaceTest), '(false => page scrolls)');

// aria-current on the active session?
console.log('active session aria-current:', await page.evaluate(() =>
  document.querySelector('.session-item--active')?.getAttribute('aria-current')));

await browser.close();
