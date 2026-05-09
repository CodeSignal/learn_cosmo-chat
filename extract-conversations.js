#!/usr/bin/env node
/**
 * extract-conversations.js
 * Reads chat-sessions.json and prints all sessions in human-readable form,
 * newest session first.
 *
 * Usage:
 *   node extract-conversations.js [--mode full|user-only] [--latest]
 *
 * Modes:
 *   full       (default) Print user messages and LLM responses.
 *   user-only  Print only the user messages.
 *
 * Options:
 *   --latest   Only print the most recent conversation.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSIONS_FILE = join(__dirname, 'chat-sessions.json');

// ── Parse args ────────────────────────────────────────────────
const args = process.argv.slice(2);
const modeIdx = args.indexOf('--mode');
const VALID_MODES = ['full', 'user-only'];
let mode = 'full';
const latestOnly = args.includes('--latest');

if (modeIdx !== -1) {
  const provided = args[modeIdx + 1];
  if (!provided || !VALID_MODES.includes(provided)) {
    console.error(`Error: --mode must be one of: ${VALID_MODES.join(', ')}`);
    process.exit(1);
  }
  mode = provided;
}

// ── Load sessions ─────────────────────────────────────────────
let data;
try {
  data = JSON.parse(readFileSync(SESSIONS_FILE, 'utf8'));
} catch (err) {
  console.error(`Could not read ${SESSIONS_FILE}: ${err.message}`);
  process.exit(1);
}

const sessions = (data.sessions ?? [])
  .filter((s) => s.messages && s.messages.length > 0)
  .sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));

if (sessions.length === 0) {
  console.log('No conversations found.');
  process.exit(0);
}

const toRender = latestOnly ? sessions.slice(0, 1) : sessions;

// ── Helpers ───────────────────────────────────────────────────
function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function printMessages(messages, label) {
  console.log(`${label}:`);
  if (messages.length === 0) {
    console.log('  (none)');
  } else {
    messages.forEach((m, i) => {
      const lines = m.content.split('\n');
      console.log(`${i + 1}. ${lines[0]}`);
      lines.slice(1).forEach((l) => console.log(`   ${l}`));
      if (m.files && m.files.length > 0) {
        console.log(`   [${m.files.length} file(s) attached]`);
      }
    });
  }
}

// ── Render ────────────────────────────────────────────────────
toRender.forEach((session, idx) => {
  const userMessages = session.messages.filter((m) => m.role === 'user');
  const assistantMessages = session.messages.filter((m) => m.role === 'assistant');

  const label = latestOnly ? 'Latest Chat' : `Chat ${idx + 1}`;
  const dateStr = formatDate(session.updated_at || session.created_at);

  console.log(`# ${label}  (${dateStr})`);
  console.log();

  if (mode === 'user-only') {
    printMessages(userMessages, 'User sent these prompts');
  } else {
    printMessages(userMessages, 'User sent these messages');
    console.log();
    printMessages(assistantMessages, 'LLM responded with these messages');
  }

  if (idx < toRender.length - 1) {
    console.log();
    console.log('---');
    console.log();
  }
});
