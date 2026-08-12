/**
 * @vitest-environment jsdom
 *
 * Characterization tests for the message render path in public/app.js.
 *
 * These describe what renderMessages() does *today*, so the A1/A2 reconciliation
 * refactor can be judged on whether it changed anything it did not intend to.
 * They are deliberately behavioural (assert on rendered DOM) rather than unit
 * tests of internals, because the render functions are not exported.
 *
 * The final block are the A1/A2 acceptance tests for the foundation PR
 * (reconcile message rows; do not wipe-and-rebuild). They were `it.fails` on
 * main before the refactor and are plain `it` once reconciliation lands.
 *
 * See a11y-audits/8-5-26/resolution-plan.md → Wave 1 → A1+A2+A11.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  bootApp,
  settle,
  fakeChats,
  storedUser,
  storedAssistant,
  liveAssistant,
  q,
  qa,
} from './harness.js';

const label = (el) => el.getAttribute('aria-label');

describe('message list', () => {
  it('renders stored user and assistant messages in order', async () => {
    await bootApp({
      messages: [storedUser('First question'), storedAssistant('First answer'), storedUser('Second question')],
    });

    const rows = qa('.message');
    expect(rows.map((r) => (r.classList.contains('message--user') ? 'user' : 'ai'))).toEqual([
      'user',
      'ai',
      'user',
    ]);
    expect(q('.message--user .message__bubble').textContent).toBe('First question');
    expect(q('.message--ai .message__body').textContent).toContain('First answer');
  });

  it('renders restored history before live messages', async () => {
    await bootApp({ messages: [storedUser('From disk'), storedAssistant('Also from disk')] });

    fakeChats[0].setMessages([liveAssistant([{ type: 'text', text: 'From the stream' }], 'done')], 'idle');
    await settle();

    const bodies = qa('.message').map((r) => r.textContent.replace(/\s+/g, ' ').trim());
    expect(bodies[0]).toContain('From disk');
    expect(bodies[1]).toContain('Also from disk');
    expect(bodies[2]).toContain('From the stream');
  });

  it('hides the empty state once messages exist', async () => {
    await bootApp({ messages: [] });
    expect(q('#emptyState').hidden).toBe(false);

    await bootApp({ messages: [storedUser('Anything')] });
    expect(q('#emptyState').hidden).toBe(true);
  });
});

describe('conversation heading a11y (A10)', () => {
  it('keeps a single h1 named for the active session when empty', async () => {
    await bootApp({ messages: [] });
    const headings = qa('h1');
    expect(headings).toHaveLength(1);
    expect(headings[0].id).toBe('conversationHeading');
    expect(headings[0].textContent).toBe('Test conversation');
    expect(q('#emptyState .empty-state__heading')?.tagName).toBe('P');
  });

  it('keeps a single h1 named for the active session once messages exist', async () => {
    await bootApp({ messages: [storedUser('First question'), storedAssistant('Answer')] });
    const headings = qa('h1');
    expect(headings).toHaveLength(1);
    expect(headings[0].textContent).toBe('Test conversation');
    expect(q('#emptyState').hidden).toBe(true);
  });

  it('updates the h1 when starting a new chat', async () => {
    await bootApp({ messages: [] });
    expect(q('#conversationHeading').textContent).toBe('Test conversation');
    q('#newChatBtn').click();
    await settle();
    expect(qa('h1')).toHaveLength(1);
    expect(q('#conversationHeading').textContent).toBe('New conversation');
  });
});

describe('assistant reasoning', () => {
  it('renders one Thoughts section with a block per thought', async () => {
    await bootApp({
      messages: [storedAssistant('The answer', { reasoning: ['First thought', 'Second thought'] })],
    });

    expect(qa('.message__thoughts').length).toBe(1);
    expect(qa('.message__thoughts-block').map((b) => b.textContent)).toEqual([
      'First thought',
      'Second thought',
    ]);
    expect(q('.message__thoughts-summary-label').textContent).toBe('Thoughts');
  });

  it('collapses Thoughts when idle and opens them while streaming', async () => {
    await bootApp({ messages: [storedAssistant('Done', { reasoning: ['A thought'] })] });
    expect(q('.message__thoughts').hasAttribute('open')).toBe(false);

    fakeChats[0].setMessages(
      [liveAssistant([{ type: 'reasoning', text: 'Thinking now', status: 'streaming' }], 'streaming')],
      'streaming',
    );
    await settle();

    const streamingThoughts = qa('.message__thoughts').at(-1);
    expect(streamingThoughts.hasAttribute('open')).toBe(true);
    expect(q('.message--ai--streaming .message__thoughts-summary-label')?.textContent).toBe('Thinking…');
  });

  it('omits Thoughts when showReasoning is disabled', async () => {
    await bootApp({
      messages: [storedAssistant('The answer', { reasoning: ['Hidden thought'] })],
      config: { showReasoning: false },
    });
    expect(qa('.message__thoughts').length).toBe(0);
  });
});

describe('markdown rendering', () => {
  it('renders a fenced code block with a language label and copy button', async () => {
    await bootApp({ messages: [storedAssistant('```python\nprint("hi")\n```')] });

    expect(q('.code-block__lang').textContent).toBe('python');
    expect(label(q('.code-block__copy'))).toBe('Copy code');
    expect(q('.code-block__pre code').classList.contains('language-python')).toBe(true);
    expect(q('.code-block__pre code').textContent).toContain('print');
  });

  it('wraps tables in a horizontal scroll container', async () => {
    await bootApp({ messages: [storedAssistant('| a | b |\n|---|---|\n| 1 | 2 |')] });
    expect(q('.message__table-scroll > table')).toBeTruthy();
  });

  it('opens links in a new tab with safe rel attributes', async () => {
    await bootApp({ messages: [storedAssistant('[example](https://example.com)')] });
    const link = q('.message__body a');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('strips emoji from prose but leaves code blocks untouched', async () => {
    await bootApp({ messages: [storedAssistant('Hello 🎉 there\n\n```\nkeep 🎉 this\n```')] });
    expect(q('.message__body p').textContent).not.toContain('🎉');
    expect(q('.code-block__pre').textContent).toContain('🎉');
  });

  it('demotes markdown headings under the turn h2 for a correct outline', async () => {
    await bootApp({
      messages: [storedAssistant('# Top\n\n## Section\n\n### Detail')],
    });

    const turnHeading = q('article.message--ai > h2.visually-hidden');
    expect(turnHeading?.textContent).toBe("Cosmo's reply");

    const contentHeadings = qa('.message__body :is(h1,h2,h3,h4,h5,h6)');
    // # and ## both become h3 (models usually start at ##); ### → h4.
    expect(contentHeadings.map((h) => h.tagName)).toEqual(['H3', 'H3', 'H4']);
    expect(contentHeadings.map((h) => h.textContent)).toEqual(['Top', 'Section', 'Detail']);
    // No content heading at h2 — those would compete with the turn chrome in the rotor.
    expect(qa('.message__body h2').length).toBe(0);
  });
});

describe('file parts', () => {
  it('renders an image part as an img with the filename as alt', async () => {
    await bootApp({
      messages: [storedUser('Look', { files: [{ filename: 'shot.png', mediaType: 'image/png', url: '/f/shot.png' }] })],
    });
    const img = q('.message__file-image');
    expect(img.getAttribute('src')).toBe('/f/shot.png');
    expect(img.getAttribute('alt')).toBe('shot.png');
  });

  it('renders a non-image part as a download chip', async () => {
    await bootApp({
      messages: [storedUser('Doc', { files: [{ filename: 'notes.pdf', mediaType: 'application/pdf', url: '/f/notes.pdf' }] })],
    });
    const chip = q('.message__file-chip');
    expect(chip.getAttribute('href')).toBe('/f/notes.pdf');
    expect(chip.textContent).toContain('notes.pdf');
  });
});

describe('message actions', () => {
  it('gives every assistant message regenerate and copy when idle', async () => {
    await bootApp({ messages: [storedUser('Q'), storedAssistant('A')] });

    const actions = qa('.message--ai .message__hover-btn').map(label);
    expect(actions).toEqual(['Regenerate response', 'Copy as Markdown']);
  });

  it('attaches actions to the trailing row on the last assistant message only', async () => {
    await bootApp({
      messages: [storedAssistant('Earlier'), storedUser('Q'), storedAssistant('Latest')],
    });

    const aiRows = qa('.message--ai');
    expect(aiRows[0].querySelector('.message__ai-trailing')).toBeNull();
    expect(aiRows[0].querySelector('.message__msg-actions--standalone')).toBeTruthy();
    expect(aiRows[1].querySelector('.message__ai-trailing .message__msg-actions')).toBeTruthy();
  });

  it('gives user messages an edit button', async () => {
    await bootApp({ messages: [storedUser('Editable')] });
    expect(label(q('.message__actions--user .button-icon'))).toBe('Edit message');
  });

  it('A17: cancelling edit restores focus to the Edit button', async () => {
    await bootApp({ messages: [storedUser('Editable')] });
    const editBtn = q('.message__actions--user .button-icon');
    editBtn.focus();
    editBtn.click();
    await settle();

    expect(q('.message__edit-textarea')).toBeTruthy();
    expect(document.activeElement).toBe(q('.message__edit-textarea'));

    q('.message__edit-actions .button-tertiary').click();
    await settle();

    expect(q('.message__edit-textarea')).toBeNull();
    expect(document.activeElement).toBe(editBtn);
  });

  it('A17: Escape cancels edit and restores focus to the Edit button', async () => {
    await bootApp({ messages: [storedUser('Editable')] });
    const editBtn = q('.message__actions--user .button-icon');
    editBtn.click();
    await settle();

    q('.message__edit-textarea').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();

    expect(q('.message__edit-textarea')).toBeNull();
    expect(document.activeElement).toBe(editBtn);
  });

  it('hides all message actions while streaming', async () => {
    await bootApp({ messages: [storedUser('Q'), storedAssistant('A')] });
    expect(qa('.message__hover-btn').length).toBeGreaterThan(0);

    fakeChats[0].setMessages([liveAssistant([{ type: 'text', text: 'partial' }], 'streaming')], 'streaming');
    await settle();

    expect(qa('.message__hover-btn').length).toBe(0);
    expect(qa('.message__actions--user').length).toBe(0);
  });

  it('marks a stopped response', async () => {
    await bootApp({ messages: [storedAssistant('Half an answer', { stopped: true })] });
    expect(q('.message__stopped').textContent).toBe('Response stopped');
  });

  it('respects hidePromptControls', async () => {
    await bootApp({
      messages: [storedUser('Q'), storedAssistant('A')],
      config: { hidePromptControls: true },
    });
    expect(qa('.message__hover-btn').length).toBe(0);
    expect(qa('.message__actions--user').length).toBe(0);
  });
});

describe('streaming state', () => {
  it('marks the streaming row and shows a cursor', async () => {
    await bootApp({ messages: [] });
    fakeChats[0].setMessages([liveAssistant([{ type: 'text', text: 'partial' }], 'streaming')], 'streaming');
    await settle();

    expect(q('.message--ai--streaming')).toBeTruthy();
    expect(q('.message--ai--streaming .cursor')).toBeTruthy();
  });

  it('switches the send button to a stop control', async () => {
    await bootApp({ messages: [] });
    expect(label(q('#sendBtn'))).toBe('Send prompt');

    fakeChats[0].setMessages([liveAssistant([{ type: 'text', text: 'partial' }], 'streaming')], 'streaming');
    await settle();

    expect(label(q('#sendBtn'))).toBe('Stop generation');
    expect(q('#sendBtn').disabled).toBe(false);
  });
});

/**
 * Accessibility acceptance — A1 and A2 (foundation PR with A11).
 *
 * Converted from `it.fails` when reconciliation landed. Do not delete.
 */
describe('accessibility characteristics of re-rendering', () => {
  it('A2: keyboard focus on a message action survives a re-render', async () => {
    await bootApp({ messages: [storedUser('Q'), storedAssistant('A')] });

    const regenerate = qa('.message__hover-btn').find((b) => label(b) === 'Regenerate response');
    regenerate.focus();
    expect(document.activeElement).toBe(regenerate);

    // A status tick with no content change must not destroy focus.
    fakeChats[0].setMessages([], 'idle');
    await settle();

    // Focus has to land back on Regenerate specifically. Merely being somewhere
    // other than <body> would still have moved the user without telling them.
    // Asserted by accessible name rather than node identity, so a fix is free to
    // either reuse the node or recreate it and restore focus.
    const refocused = document.activeElement;
    expect(label(refocused)).toBe('Regenerate response');
    expect(q('.messages').contains(refocused)).toBe(true);
  });

  it('A1: an unchanged message keeps its DOM node across a re-render', async () => {
    await bootApp({ messages: [storedUser('Unchanged'), storedAssistant('Also unchanged')] });

    const before = qa('.message');
    fakeChats[0].setMessages([], 'idle');
    await settle();
    const after = qa('.message');

    // Reconciliation reuses unchanged rows so AT does not see the whole
    // conversation as new content on every tick.
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
  });

  it('exposes each message as a named article with a heading for AT navigation', async () => {
    await bootApp({ messages: [storedUser('Q'), storedAssistant('A')] });

    const rows = qa('.message');
    expect(rows.map((r) => r.tagName)).toEqual(['ARTICLE', 'ARTICLE']);
    expect(rows[0].getAttribute('aria-labelledby')).toBeTruthy();
    expect(rows[1].getAttribute('aria-labelledby')).toBeTruthy();
    expect(rows[0].querySelector('h2.visually-hidden')?.textContent).toBe('Your message');
    expect(rows[1].querySelector('h2.visually-hidden')?.textContent).toBe("Cosmo's reply");
  });

  it('keeps the streaming reply article and heading stable across token ticks', async () => {
    await bootApp({ messages: [storedUser('Q')] });

    fakeChats[0].setMessages(
      [liveAssistant([{ type: 'text', text: 'Hel' }], 'streaming')],
      'streaming',
    );
    await settle();

    const article = q('.message--ai');
    const heading = article.querySelector('h2.visually-hidden');
    expect(heading?.textContent).toBe("Cosmo's reply");
    expect(qa('article.message > h2.visually-hidden').map((h) => h.textContent)).toEqual([
      'Your message',
      "Cosmo's reply",
    ]);

    fakeChats[0].setMessages(
      [liveAssistant([{ type: 'text', text: 'Hello, world' }], 'streaming')],
      'streaming',
    );
    await settle();

    // Same nodes — not replaceWith — so VoiceOver can keep reading mid-stream.
    expect(q('.message--ai')).toBe(article);
    expect(article.querySelector('h2.visually-hidden')).toBe(heading);
    expect(qa('article.message > h2.visually-hidden').length).toBe(2);
    expect(q('.message--ai .message__body').textContent).toContain('Hello, world');
  });

  it('A11: persistent status region receives short stream lifecycle messages', async () => {
    await bootApp({ messages: [] });

    const statusEl = q('#chatStatus');
    expect(statusEl).toBeTruthy();
    expect(statusEl.getAttribute('role')).toBe('status');
    expect(q('.messages')?.contains(statusEl) ?? false).toBe(false);

    fakeChats[0].setMessages(
      [liveAssistant([{ type: 'text', text: 'partial' }], 'streaming')],
      'streaming',
    );
    await settle();
    expect(statusEl.textContent).toBe('Cosmo is responding');
    expect(q('.message__ai-status')?.hasAttribute('aria-live') ?? false).toBe(false);

    fakeChats[0].setMessages(
      [liveAssistant([{ type: 'text', text: 'done' }], 'done')],
      'idle',
    );
    await settle();
    expect(statusEl.textContent).toBe('Response complete');
  });

  it('A11: stop announces Response stopped and idle does not overwrite it', async () => {
    await bootApp({ messages: [] });

    const statusEl = q('#chatStatus');
    fakeChats[0].setMessages(
      [liveAssistant([{ type: 'text', text: 'partial' }], 'streaming')],
      'streaming',
    );
    await settle();
    expect(statusEl.textContent).toBe('Cosmo is responding');
    expect(label(q('#sendBtn'))).toBe('Stop generation');

    q('#sendBtn').click();
    await settle();

    expect(statusEl.textContent).toBe('Response stopped');
    expect(q('.message__stopped')?.textContent).toBe('Response stopped');
  });
});

/**
 * Accessibility acceptance — A3 (composer stays focusable mid-stream).
 */
describe('composer availability during streaming (A3)', () => {
  it('uses readOnly instead of disabled while a response streams', async () => {
    await bootApp({ messages: [] });
    const input = q('#promptInput');
    expect(input.disabled).toBe(false);
    expect(input.readOnly).toBe(false);

    fakeChats[0].setMessages(
      [liveAssistant([{ type: 'text', text: 'partial' }], 'streaming')],
      'streaming',
    );
    await settle();

    expect(input.disabled).toBe(false);
    expect(input.readOnly).toBe(true);
    expect(input.getAttribute('aria-describedby')).toBe('promptInputBusyHint');
    expect(q('#promptInputBusyHint').textContent).toBe(
      'Wait for Cosmo to finish responding before typing.',
    );
  });

  it('keeps focus on the composer across a stream tick', async () => {
    await bootApp({ messages: [] });
    const input = q('#promptInput');
    input.focus();
    expect(document.activeElement).toBe(input);

    fakeChats[0].setMessages(
      [liveAssistant([{ type: 'text', text: 'Hel' }], 'streaming')],
      'streaming',
    );
    await settle();
    expect(document.activeElement).toBe(input);
    expect(input.readOnly).toBe(true);

    fakeChats[0].setMessages(
      [liveAssistant([{ type: 'text', text: 'Hello' }], 'streaming')],
      'streaming',
    );
    await settle();
    expect(document.activeElement).toBe(input);
  });

  it('clears readOnly and restores focus from body when the response completes', async () => {
    await bootApp({ messages: [] });
    const input = q('#promptInput');

    fakeChats[0].setMessages(
      [liveAssistant([{ type: 'text', text: 'partial' }], 'streaming')],
      'streaming',
    );
    await settle();
    expect(input.readOnly).toBe(true);

    // Simulate the pre-fix failure mode: focus already fallen to <body>.
    document.body.focus();
    if (document.activeElement !== document.body) {
      document.activeElement?.blur?.();
    }
    expect(['BODY', 'HTML']).toContain(document.activeElement?.tagName);

    fakeChats[0].setMessages(
      [liveAssistant([{ type: 'text', text: 'done' }], 'done')],
      'idle',
    );
    await settle();

    expect(input.readOnly).toBe(false);
    expect(input.disabled).toBe(false);
    expect(input.hasAttribute('aria-describedby')).toBe(false);
    expect(document.activeElement).toBe(input);
  });
});

describe('new chat while create is slow', () => {
  it('shows a new sidebar thread before POST /api/sessions resolves', async () => {
    const { requests, releaseNewSession } = await bootApp({ holdNewSession: true });
    const chatsBefore = fakeChats.length;

    const before = qa('.session-item').length;
    q('#newChatBtn').click();
    await settle();

    // Optimistic thread appears even though Octavus create is still held.
    expect(qa('.session-item').length).toBe(before + 1);
    expect(qa('.session-item')[0].classList.contains('session-item--active')).toBe(true);
    expect(q('#emptyState')?.hidden).toBe(false);
    // Real OctavusChat is not attached until create finishes.
    expect(fakeChats.length).toBe(chatsBefore);
    expect(qa('.session-item')[0].dataset.sessionId).toMatch(/^pending-/);

    releaseNewSession();
    await settle(8);

    // Create finished → runtime wired with a real chat instance.
    expect(fakeChats.length).toBe(chatsBefore + 1);
    expect(qa('.session-item').length).toBe(before + 1);

    const createdId = 'session-2';
    expect(requests.some((r) => r.url === '/api/sessions' && r.method === 'POST')).toBe(true);
    const sidebarIds = qa('.session-item').map((el) => el.dataset.sessionId);
    expect(sidebarIds).toContain(createdId);
    expect(sidebarIds.some((id) => id?.startsWith('pending-'))).toBe(false);
  });

  it('rolls back pending session metadata when POST /api/sessions fails', async () => {
    await bootApp({ failNewSession: true });
    const before = qa('.session-item').map((el) => el.dataset.sessionId);

    q('#newChatBtn').click();
    await settle(8);

    const after = qa('.session-item').map((el) => el.dataset.sessionId);
    expect(after.some((id) => id?.startsWith('pending-'))).toBe(false);
    expect(after).toEqual(before);
  });
});

describe('session list a11y (A4)', () => {
  const twoSessions = [
    { session_id: 'session-1', title: 'Active chat', updated_at: '2026-08-05T12:00:00Z' },
    { session_id: 'session-2', title: 'Other chat', updated_at: '2026-08-04T00:00:00Z' },
  ];

  it('renders sibling select/delete buttons inside list items', async () => {
    await bootApp({ sessions: twoSessions });

    const list = q('#sessionList .session-list');
    expect(list?.tagName).toBe('UL');

    const items = qa('.session-item');
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item.tagName).toBe('LI');
      const select = item.querySelector(':scope > .session-item__select');
      const del = item.querySelector(':scope > .session-item__delete');
      expect(select?.tagName).toBe('BUTTON');
      expect(del?.tagName).toBe('BUTTON');
      expect(select.contains(del)).toBe(false);
      expect(item.querySelector('.session-item__select .session-item__delete')).toBeNull();
    }
  });

  it('exposes aria-current=page on the active conversation select control', async () => {
    await bootApp({ sessions: twoSessions });

    const active = q('.session-item--active > .session-item__select');
    const inactive = qa('.session-item:not(.session-item--active) > .session-item__select');
    expect(active?.getAttribute('aria-current')).toBe('page');
    expect(inactive.every((el) => el.getAttribute('aria-current') == null)).toBe(true);
  });

  it('Enter on Delete deletes without also switching sessions', async () => {
    const { requests } = await bootApp({ sessions: twoSessions });
    requests.length = 0;

    const other = q('.session-item[data-session-id="session-2"]');
    const del = other.querySelector('.session-item__delete');
    del.focus();
    del.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    // Native buttons activate on keyup/click; jsdom does not synthesize click
    // from keydown, so fire the activation that a real Enter would produce.
    del.click();
    await settle(8);

    const deletes = requests.filter((r) => r.method === 'DELETE');
    const switches = requests.filter((r) => r.url.startsWith('/api/session?id='));
    expect(deletes).toEqual([{ url: '/api/sessions/session-2', method: 'DELETE' }]);
    expect(switches).toEqual([]);
    expect(qa('.session-item').map((el) => el.dataset.sessionId)).toEqual(['session-1']);
  });
});

describe('settings labels a11y (D6)', () => {
  async function openSettings() {
    await bootApp();
    q('#settingsBtn').click();
    await settle();
  }

  it('associates Temperature label and description with the slider', async () => {
    await openSettings();

    const label = q('#temperatureLabel');
    const desc = q('#temperatureDesc');
    const wrapper = q('#temperatureSliderEl .numeric-slider-wrapper');
    const slider = q('#temperatureSliderEl .numeric-slider-handle[role="slider"]');

    expect(label?.textContent).toBe('Temperature');
    expect(desc).toBeTruthy();
    // D5: wrapper is presentational; the handle is the slider.
    expect(wrapper?.getAttribute('role')).toBeNull();
    expect(slider?.getAttribute('aria-labelledby')).toBe('temperatureLabel');
    expect(slider?.getAttribute('aria-describedby')).toBe('temperatureDesc');
    expect(document.getElementById('temperatureLabel')).toBe(label);
    expect(document.getElementById('temperatureDesc')).toBe(desc);
  });

  it('associates Thinking label and description with the dropdown toggle and listbox', async () => {
    await openSettings();

    const label = q('#thinkingLabel');
    const desc = q('#thinkingDesc');
    const toggle = q('#thinkingDropdownEl .dropdown-toggle');
    const menu = document.querySelector('[id^="portal-dropdown-menu-"]');

    expect(label?.textContent).toBe('Thinking');
    expect(desc).toBeTruthy();
    expect(toggle?.getAttribute('aria-labelledby')?.split(/\s+/)).toEqual(
      expect.arrayContaining(['thinkingLabel']),
    );
    expect(toggle?.getAttribute('aria-describedby')).toBe('thinkingDesc');
    expect(menu?.getAttribute('role')).toBe('listbox');
    expect(menu?.getAttribute('aria-labelledby')).toBe('thinkingLabel');
    expect(menu?.getAttribute('aria-describedby')).toBe('thinkingDesc');
  });
});

describe('settings thinking menu a11y (D7)', () => {
  async function openSettings() {
    await bootApp();
    q('#settingsBtn').click();
    await settle();
  }

  it('keeps the open Thinking menu inside the aria-modal dialog and not inert', async () => {
    await openSettings();

    const overlay = q('.modal-overlay[aria-modal="true"]');
    const toggle = q('#thinkingDropdownEl .dropdown-toggle');
    expect(overlay).toBeTruthy();
    expect(toggle).toBeTruthy();

    toggle.click();
    await settle();

    const menu = document.querySelector('[id^="portal-dropdown-menu-"]');
    expect(menu).toBeTruthy();
    expect(menu.classList.contains('dropdown-menu--portaled')).toBe(true);
    // Mounted on the overlay (sibling of .modal-dialog), not document.body.
    expect(menu.parentElement).toBe(overlay);
    expect(overlay.contains(menu)).toBe(true);
    expect(menu.parentElement === document.body).toBe(false);
    // Not under an inert subtree (body-portaled menus get inert via D1).
    expect(menu.closest('[inert]')).toBeNull();
    // Options remain interactive for keyboard / pointer.
    const options = menu.querySelectorAll('.dropdown-menu-item');
    expect(options.length).toBeGreaterThan(0);
    expect([...options].every((el) => el.closest('[inert]') == null)).toBe(true);
  });

  it('can select a Thinking option while Settings stays open', async () => {
    await openSettings();

    const toggle = q('#thinkingDropdownEl .dropdown-toggle');
    toggle.click();
    await settle();

    const menu = document.querySelector('[id^="portal-dropdown-menu-"]');
    const high = menu.querySelector('.dropdown-menu-item[data-value="high"]');
    expect(high).toBeTruthy();
    high.click();
    await settle();

    expect(q('.modal-overlay.open')).toBeTruthy();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.textContent).toMatch(/High/i);
  });
});

describe('copy confirmation a11y (A12)', () => {
  it('announces Copied via the persistent status region', async () => {
    await bootApp({ messages: [storedUser('Q'), storedAssistant('Answer to copy')] });

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(async () => {}) },
    });

    const copyBtn = qa('.message--ai .message__hover-btn').find((b) => label(b) === 'Copy as Markdown');
    expect(copyBtn).toBeTruthy();
    copyBtn.click();
    await settle();

    expect(q('#chatStatus').textContent).toBe('Copied');
    expect(copyBtn.getAttribute('aria-label')).toBe('Copied');
    expect(copyBtn.querySelector('svg path')?.getAttribute('d')).toBe('M20 6 9 17l-5-5');
  });
});

describe('composer actions a11y (A13)', () => {
  it('exposes composer actions as a group, not a toolbar', async () => {
    await bootApp();
    const group = q('.composer__toolbar');
    expect(group?.getAttribute('role')).toBe('group');
    expect(group?.getAttribute('aria-label')).toBe('Composer actions');
    expect(q('#sendBtn')?.tagName).toBe('BUTTON');
  });
});

describe('sidebar resizer landmark (A23)', () => {
  it('keeps the sidebar resizer inside the complementary landmark', async () => {
    await bootApp();
    const resizer = q('#sidebarResizer');
    const sidebar = q('#sidebar');
    expect(resizer).toBeTruthy();
    expect(sidebar?.tagName).toBe('ASIDE');
    expect(sidebar.contains(resizer)).toBe(true);
    expect(resizer.getAttribute('role')).toBe('separator');
  });
});

describe('page language and chrome names (A14/A15)', () => {
  const esChrome = {
    Workspace: 'Espacio de trabajo',
    'Open settings': 'Abrir configuración',
    Conversations: 'Conversaciones',
    'Resize sidebar': 'Redimensionar la barra lateral',
    'Prompt input': 'Campo de mensaje',
    'Composer actions': 'Acciones del compositor',
    'Attach an image': 'Adjuntar una imagen',
    'Attach a file': 'Adjuntar un archivo',
    Settings: 'Configuración',
  };

  it('keeps html lang en when no locale is configured', async () => {
    await bootApp();
    expect(document.documentElement.lang).toBe('en');
    expect(q('.sidebar__nav').getAttribute('aria-label')).toBe('Workspace');
  });

  it('sets html lang and translates static chrome names from the catalog', async () => {
    await bootApp({ config: { htmlLang: 'es', strings: esChrome } });

    expect(document.documentElement.lang).toBe('es');
    expect(q('.sidebar__nav').getAttribute('aria-label')).toBe('Espacio de trabajo');
    expect(q('#settingsBtn').getAttribute('aria-label')).toBe('Abrir configuración');
    expect(q('#sessionList').getAttribute('aria-label')).toBe('Conversaciones');
    expect(q('#sidebarResizer').getAttribute('aria-label')).toBe('Redimensionar la barra lateral');
    expect(q('#promptInput').getAttribute('aria-label')).toBe('Campo de mensaje');
    expect(q('.composer__toolbar').getAttribute('aria-label')).toBe('Acciones del compositor');
    expect(q('#uploadImageBtn').getAttribute('aria-label')).toBe('Adjuntar una imagen');
    expect(q('#uploadFileBtn').getAttribute('aria-label')).toBe('Adjuntar un archivo');
    expect(q('#uploadImageBtn').getAttribute('title')).toBe('Adjuntar una imagen');
  });
});
