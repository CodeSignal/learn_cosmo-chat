/**
 * Boots public/app.js inside jsdom against the real public/index.html.
 *
 * app.js queries the DOM and calls init() at import time, so it cannot be
 * imported in isolation. Rather than restructure the module — which is the very
 * code these tests exist to protect — the harness reproduces the browser
 * conditions it expects: the real markup, a stubbed API, and a fake
 * OctavusChat whose messages and status the test drives directly.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { vi } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Live fake chats, newest last. Tests drive streaming through these. */
export const fakeChats = [];

class FakeOctavusChat {
  constructor() {
    this.status = 'idle';
    this.messages = [];
    this.listeners = new Set();
    this.sent = [];
    fakeChats.push(this);
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn();
  }

  /** Replace the live message list and notify, as a real stream tick would. */
  setMessages(messages, status = this.status) {
    this.messages = messages;
    this.status = status;
    this.emit();
  }

  async send(name, vars, options) {
    this.sent.push({ name, vars, options });
  }

  async uploadFiles(files) {
    return files.map((f) => ({ filename: f.name, mediaType: f.type, url: `blob:${f.name}` }));
  }
}

vi.mock('@octavus/client-sdk', () => ({
  OctavusChat: FakeOctavusChat,
  createHttpTransport: () => ({}),
}));

const DEFAULT_CONFIG = {
  temperature: 0.7,
  allowCustomInstructions: true,
  model: 'anthropic/claude-sonnet-4-6',
  allowedModels: ['anthropic/claude-sonnet-4-6'],
  thinking: 'medium',
  showReasoning: true,
};

const DEFAULT_SESSIONS = [
  { session_id: 'session-1', title: 'Test conversation', updated_at: '2026-08-05T00:00:00Z' },
];

/**
 * @param {object} [options]
 * @param {Array} [options.messages]  Stored messages returned by /api/session.
 * @param {object} [options.config]   Overrides merged into the default chat config.
 * @param {string[]} [options.models] Model ids returned by /api/models. More than
 *                                    one causes app.js to construct a real Dropdown.
 * @param {Array} [options.sessions]  Session list returned by GET /api/sessions.
 * @param {boolean} [options.holdNewSession] When true, POST /api/sessions waits
 *                                    until releaseNewSession() is called — used to
 *                                    assert optimistic New chat UI.
 * @param {boolean} [options.failNewSession] When true, POST /api/sessions returns 500.
 */
export async function bootApp({
  messages = [],
  config = {},
  models = ['anthropic/claude-sonnet-4-6'],
  sessions = DEFAULT_SESSIONS,
  holdNewSession = false,
  failNewSession = false,
} = {}) {
  vi.resetModules();
  fakeChats.length = 0;

  const html = readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));
  document.documentElement.lang = 'en';
  document.body.innerHTML = body;

  const requests = [];
  /** @type {null | (() => void)} */
  let releaseNewSession = null;

  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url);
    requests.push({ url: u, method: init.method ?? 'GET' });
    const json = (data) => ({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) });

    if (u.startsWith('/api/session?id=')) return json({ sessionId: 'session-switched', messages: [] });
    if (u === '/api/session') return json({ sessionId: 'session-1', messages });
    // startNewChat() POSTs to the same path the session list is read from, so
    // the method check has to come first.
    if (u === '/api/sessions' && init.method === 'POST') {
      if (holdNewSession) {
        await new Promise((resolve) => {
          releaseNewSession = resolve;
        });
      }
      if (failNewSession) {
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: 'Failed to create session' }),
          text: async () => 'Failed to create session',
        };
      }
      return json({ sessionId: 'session-2' });
    }
    if (u === '/api/sessions') return json({ sessions });
    if (u.startsWith('/api/sessions/') && init.method === 'DELETE') return json({ ok: true });
    if (u === '/api/config') return json({ ...DEFAULT_CONFIG, ...config });
    if (u === '/api/models') return json({ models, capabilities: {} });
    if (u === '/api/session/save') return json({ ok: true });
    return json({ ok: true });
  });

  // jsdom omits these; app.js touches them on the attachment and resizer paths.
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:preview');
  globalThis.URL.revokeObjectURL = vi.fn();
  // Always timer-back rAF so settle() can drain announceChatStatus's deferred write.
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  installLocalStorage();

  await import('../../public/app.js');
  await settle();

  return {
    requests,
    chat: fakeChats[0],
    releaseNewSession: () => releaseNewSession?.(),
  };
}

/** Node 26 does not expose localStorage without a backing file; app.js needs one. */
function installLocalStorage() {
  const store = new Map();
  const shim = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
  for (const target of [globalThis, globalThis.window].filter(Boolean)) {
    Object.defineProperty(target, 'localStorage', { value: shim, configurable: true, writable: true });
  }
}

/** Let init()'s promise chain and any queued rAF callbacks drain. */
export async function settle(ticks = 4) {
  for (let i = 0; i < ticks; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** A stored (on-disk shape) assistant message. */
export function storedAssistant(content, extra = {}) {
  return { role: 'assistant', content, timestamp: '2026-08-05T00:00:00Z', ...extra };
}

/** A stored (on-disk shape) user message. */
export function storedUser(content, extra = {}) {
  return { role: 'user', content, timestamp: '2026-08-05T00:00:00Z', ...extra };
}

/** A live (OctavusChat shape) assistant message. */
export function liveAssistant(parts, status = 'streaming') {
  return { role: 'assistant', status, parts };
}

export const q = (sel) => document.querySelector(sel);
export const qa = (sel) => [...document.querySelectorAll(sel)];
