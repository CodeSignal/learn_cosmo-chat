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
 *   --latest          Only print the most recent conversation.
 *   --output          Write report to a file instead of stdout.
 *   --print-settings  Print the current chat-config.json settings in the heading.
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { deriveTitle, mergeConfig } from './lib/helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSIONS_FILE = join(__dirname, 'chat-sessions.json');
const CONFIG_FILE = join(__dirname, 'chat-config.json');
const CONFIG_OVERRIDE_FILE = join(__dirname, 'chat-config.override.json');

// ── Parse args ────────────────────────────────────────────────
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`Usage: node extract-conversations.js [options]

Options:
  --mode <mode>    Output mode (default: full)
                     full       Print interleaved user/assistant conversation
                     user-only  Print only the user messages
                     report     Generate a markdown report (oldest first)
  --latest         Only include the most recent conversation
  --output <file>  Write report to a file instead of stdout
  --print-settings Print the effective chat-config settings (base + override) in the heading
  -h, --help       Show this help message`);
  process.exit(0);
}

const modeIdx = args.indexOf('--mode');
const VALID_MODES = ['full', 'user-only', 'report'];
let mode = 'full';
const latestOnly = args.includes('--latest');
const printSettings = args.includes('--print-settings');
const outputIdx = args.indexOf('--output');
const outputFile = (outputIdx !== -1 && args[outputIdx + 1]) ? args[outputIdx + 1] : null;

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

// Returns the heading lines for the effective chat-config settings (base merged
// with optional override), or an empty array when --print-settings was not
// passed. Rendered as a fenced JSON block so it reads cleanly in both plain
// stdout and the markdown report.
function settingsHeadingLines() {
  if (!printSettings) return [];
  let base = {};
  try {
    base = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  } catch (err) {
    return ['# Settings', '', `_Could not read chat-config.json: ${err.message}_`, '', '---', ''];
  }
  let override = {};
  try {
    override = JSON.parse(readFileSync(CONFIG_OVERRIDE_FILE, 'utf8'));
  } catch {
    // Optional practice override — missing file is a no-op.
  }
  const config = mergeConfig(base, override);
  // Only the settings a user can change in the Settings panel. Defaults mirror
  // the agent protocol (temperature 0.7, thinking off).
  const settings = {
    customInstructions: config.customInstructions ?? '',
    temperature: config.temperature ?? 0.7,
    thinking: config.thinking ?? 'off',
  };
  return [
    '# Settings',
    '',
    '```json',
    JSON.stringify(settings, null, 2),
    '```',
    '',
    '---',
    '',
  ];
}

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

  lines.push(...settingsHeadingLines());

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

  const report = lines.join('\n');
  if (outFile) {
    writeFileSync(outFile, report);
    console.error(`Report written to ${outFile}`);
  } else {
    console.log(report);
  }
}

// ── Report mode ──────────────────────────────────────────────
if (mode === 'report') {
  const reportSessions = [...toRender].reverse();
  generateReport(reportSessions, outputFile);
  process.exit(0);
}

// ── Render ────────────────────────────────────────────────────
const settingsHeading = settingsHeadingLines();
if (settingsHeading.length > 0) {
  console.log(settingsHeading.join('\n'));
}

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
