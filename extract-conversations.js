#!/usr/bin/env node
/**
 * extract-conversations.js
 * Reads chat-sessions.json and prints all sessions in human-readable form,
 * newest session first.
 *
 * Usage:
 *   node extract-conversations.js [--mode full|user-only|report] [--latest] [--output <file>]
 *
 * Modes:
 *   full       (default) Print user messages and LLM responses.
 *   user-only  Print only the user messages.
 *   report     Generate a markdown report file (oldest conversations first).
 *
 * Options:
 *   --latest   Only print the most recent conversation.
 *   --output   Output file path for report mode (default: chat-report.md).
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { deriveTitle } from './lib/helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSIONS_FILE = join(__dirname, 'chat-sessions.json');

// ── Parse args ────────────────────────────────────────────────
const args = process.argv.slice(2);
const modeIdx = args.indexOf('--mode');
const VALID_MODES = ['full', 'user-only', 'report'];
let mode = 'full';
const latestOnly = args.includes('--latest');
const outputIdx = args.indexOf('--output');
const outputFile = (outputIdx !== -1 && args[outputIdx + 1]) ? args[outputIdx + 1] : 'chat-report.md';

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

function cleanAssistantContent(content) {
  return content.replace(/!\[([^\]]*)\]\([^)]+\)/g, '*(image: $1)*');
}

function generateReport(reportSessions, outFile) {
  const lines = [];

  lines.push('# Chat History Report');
  lines.push('');
  lines.push(`*Generated on ${formatDate(new Date().toISOString())}*  `);
  lines.push(`*${reportSessions.length} conversation(s)*`);
  lines.push('');
  lines.push('---');
  lines.push('');

  reportSessions.forEach((session, idx) => {
    const title = deriveTitle(session.messages);
    const dateStr = formatDate(session.updated_at || session.created_at);
    const userMsgs = session.messages.filter((m) => m.role === 'user');
    const assistantMsgs = session.messages.filter((m) => m.role === 'assistant');

    lines.push(`## ${idx + 1}. ${title}`);
    lines.push('');
    lines.push(`**Date:** ${dateStr}  `);
    lines.push(`**Messages:** ${userMsgs.length} from user, ${assistantMsgs.length} from assistant`);
    lines.push('');

    session.messages.forEach((m) => {
      const isUser = m.role === 'user';
      const content = m.content || '';
      lines.push(`**${isUser ? 'User' : 'Assistant'}:**`);

      if (isUser) {
        const contentLines = content.split('\n').map((l) => `> ${l}`);
        lines.push(...contentLines);
        if (m.files?.length > 0) {
          lines.push('>');
          m.files.forEach((f) => lines.push(`> 📎 *${f.filename}*`));
        }
      } else {
        lines.push('');
        lines.push(cleanAssistantContent(content));
      }

      lines.push('');
    });

    if (idx < reportSessions.length - 1) {
      lines.push('---');
      lines.push('');
    }
  });

  writeFileSync(outFile, lines.join('\n'));
  console.log(`Report written to ${outFile}`);
}

// ── Report mode ──────────────────────────────────────────────
if (mode === 'report') {
  const reportSessions = [...toRender].reverse();
  generateReport(reportSessions, outputFile);
  process.exit(0);
}

// ── Render ────────────────────────────────────────────────────
toRender.forEach((session, idx) => {
  const label = latestOnly ? 'Latest Chat' : `Chat ${idx + 1}`;
  const dateStr = formatDate(session.updated_at || session.created_at);

  console.log(`# ${label}  (${dateStr})`);
  console.log();

  if (mode === 'user-only') {
    const userMessages = session.messages.filter((m) => m.role === 'user');
    printMessages(userMessages, 'User sent these prompts');
  } else {
    session.messages.forEach((m) => {
      const role = m.role === 'user' ? 'User' : 'ASSISTANT';
      console.log(`**${role}:**`);
      const msgLines = m.content.split('\n');
      msgLines.forEach((l) => console.log(`  ${l}`));
      if (m.files && m.files.length > 0) {
        console.log(`  [${m.files.length} file(s) attached]`);
      }
      console.log();
    });
  }

  if (idx < toRender.length - 1) {
    console.log('---');
    console.log();
  }
});
