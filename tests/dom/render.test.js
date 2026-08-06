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

import { describe, it, expect } from 'vitest';
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
    expect(contentHeadings.map((h) => h.tagName)).toEqual(['H3', 'H4', 'H5']);
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
});
