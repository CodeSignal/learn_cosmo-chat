/**
 * ChatCPT – app.js
 * Connects to the backend via @octavus/client-sdk (HTTP/SSE transport).
 */

import { OctavusChat, createHttpTransport } from '@octavus/client-sdk';
import { marked } from 'marked';
import hljs from 'highlight.js/lib/core';
import python from 'highlight.js/lib/languages/python';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import sql from 'highlight.js/lib/languages/sql';
import xml from 'highlight.js/lib/languages/xml';
import markdown from 'highlight.js/lib/languages/markdown';
import yaml from 'highlight.js/lib/languages/yaml';
import plaintext from 'highlight.js/lib/languages/plaintext';
import java from 'highlight.js/lib/languages/java';
import csharp from 'highlight.js/lib/languages/csharp';
import cpp from 'highlight.js/lib/languages/cpp';
import c from 'highlight.js/lib/languages/c';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import ruby from 'highlight.js/lib/languages/ruby';
import php from 'highlight.js/lib/languages/php';
import swift from 'highlight.js/lib/languages/swift';
import kotlin from 'highlight.js/lib/languages/kotlin';

hljs.registerLanguage('python', python);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('plaintext', plaintext);
hljs.registerLanguage('java', java);
hljs.registerLanguage('csharp', csharp);
hljs.registerLanguage('cs', csharp);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('c', c);
hljs.registerLanguage('go', go);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('ruby', ruby);
hljs.registerLanguage('rb', ruby);
hljs.registerLanguage('php', php);
hljs.registerLanguage('swift', swift);
hljs.registerLanguage('kotlin', kotlin);
hljs.registerLanguage('kt', kotlin);

// marked may HTML-encode the code text before passing it to the renderer;
// decode it so hljs receives raw source, not entities.
function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// Custom renderer: single place for highlighting + block structure.
// No markedHighlight plugin — that would double-process the code.
const renderer = new marked.Renderer();
renderer.code = function ({ text, lang }) {
  const rawCode = decodeHtmlEntities(text);
  const language = hljs.getLanguage(lang) ? lang : 'plaintext';
  const highlighted = hljs.highlight(rawCode, { language }).value;
  const label = lang || 'code';
  return `
    <div class="code-block">
      <div class="code-block__header">
        <span class="code-block__lang label-medium">${label}</span>
      </div>
      <pre class="code-block__pre"><code class="hljs language-${language}">${highlighted}</code></pre>
    </div>
  `;
};

marked.use({ breaks: true, gfm: true, renderer });

// ── DOM references ────────────────────────────────────────────
const promptInput         = document.getElementById('promptInput');
const sendBtn             = document.getElementById('sendBtn');
const chatHistory         = document.getElementById('chatHistory');
const emptyState          = document.getElementById('emptyState');
const uploadBtn           = document.getElementById('uploadBtn');
const fileInput           = document.getElementById('fileInput');
const attachmentPreview   = document.getElementById('attachmentPreview');
const attachmentName      = document.getElementById('attachmentName');
const removeAttachmentBtn = document.getElementById('removeAttachmentBtn');

// ── State ─────────────────────────────────────────────────────
let chat = null;
let sessionId = null;
let pendingFiles = [];
let uploadedFileRefs = [];
let isUploading = false;
let lastStatus = null;
// Messages loaded from disk on startup; combined with live chat.messages for display/save
let restoredMessages = [];

// ── Init ──────────────────────────────────────────────────────
async function init() {
  try {
    // GET /api/session resumes the most recent persisted session, or creates a new one
    const res = await fetch('/api/session');
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    sessionId = data.sessionId;
    restoredMessages = data.messages ?? [];

    // Show historical messages immediately before any new activity
    renderMessages([], 'idle');

    const transport = createHttpTransport({
      request: (payload, options) =>
        fetch('/api/trigger', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, ...payload }),
          signal: options?.signal,
        }),
    });

    const requestUploadUrls = async (files) => {
      const r = await fetch('/api/upload-urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, files }),
      });
      return r.json();
    };

    chat = new OctavusChat({ transport, requestUploadUrls });
    chat.subscribe(() => {
      const { messages, status } = chat;
      renderMessages(messages, status);

      // Persist to disk whenever a streaming turn finishes
      if (lastStatus === 'streaming' && status !== 'streaming') {
        saveSession(messages);
      }
      lastStatus = status;
    });
  } catch (err) {
    console.error('[ChatCPT] Failed to initialise session:', err);
  }
}

// ── Render messages ───────────────────────────────────────────
// `liveMessages` comes from OctavusChat; `restoredMessages` are pre-loaded from disk.
// We display restored first, then live so the conversation reads continuously.
function renderMessages(liveMessages, status) {
  const messages = [...restoredMessages.map(storedToDisplayMsg), ...liveMessages];
  if (emptyState) emptyState.hidden = messages.length > 0;

  let messagesEl = chatHistory.querySelector('.messages');
  if (!messagesEl) {
    messagesEl = document.createElement('div');
    messagesEl.className = 'messages';
    chatHistory.appendChild(messagesEl);
  }

  messagesEl.innerHTML = '';

  for (const msg of messages) {
    const row = document.createElement('div');

    if (msg.role === 'assistant') {
      const text = msg.parts.filter((p) => p.type === 'text').map((p) => p.text).join('');
      const streaming = msg.status === 'streaming';

      const renderedHtml = marked.parse(text);

      row.className = 'message message--ai';
      row.innerHTML = `
        <div class="message__avatar">
          <span class="icon icon-cosmo-black icon-small"></span>
        </div>
        <div class="message__body body-medium markdown">
          ${renderedHtml}${streaming ? '<span class="cursor" aria-hidden="true"></span>' : ''}
        </div>
      `;
    } else if (msg.role === 'user') {
      const text = msg.parts.filter((p) => p.type === 'text').map((p) => p.text).join('');
      const fileParts = msg.parts.filter((p) => p.type === 'file');

      const filesHtml = fileParts.map((f) => renderFilePart(f)).join('');

      row.className = 'message message--user';
      row.innerHTML = `
        <div class="message__user-content">
          ${filesHtml}
          ${text ? `<div class="box non-interactive message__bubble body-medium">${text}</div>` : ''}
        </div>
      `;
    } else {
      continue;
    }

    messagesEl.appendChild(row);
  }

  chatHistory.scrollTop = chatHistory.scrollHeight;

  const streaming = status === 'streaming';
  promptInput.disabled = streaming;
  updateSendBtn();
}

function renderFilePart(part) {
  if (part.mediaType?.startsWith('image/')) {
    return `<img class="message__file-image" src="${part.url}" alt="${part.filename || 'image'}" />`;
  }
  return `
    <a class="tag outline message__file-chip" href="${part.url}" target="_blank" rel="noopener">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
      </svg>
      ${part.filename || 'file'}
    </a>
  `;
}

// ── Send ──────────────────────────────────────────────────────
async function sendMessage() {
  if (!chat || sendBtn.disabled) return;

  const text = promptInput.value.trim();
  if (!text && uploadedFileRefs.length === 0) return;

  promptInput.value = '';
  const filesToSend = [...uploadedFileRefs];
  clearAttachment();
  updateSendBtn();

  try {
    await chat.send(
      'user-message',
      {
        USER_MESSAGE: text,
        ...(filesToSend.length > 0 && { FILES: filesToSend }),
      },
      {
        userMessage: {
          content: text,
          ...(filesToSend.length > 0 && { files: filesToSend }),
        },
      },
    );
  } catch (err) {
    console.error('[ChatCPT] Send error:', err);
  }
}

// ── File handling ─────────────────────────────────────────────
uploadBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  if (!file || !chat) return;

  pendingFiles = [file];
  isUploading = true;
  attachmentName.textContent = file.name;
  attachmentPreview.hidden = false;
  attachmentPreview.classList.add('uploading');
  updateSendBtn();

  try {
    // Pass the raw File; the SDK uploads it via requestUploadUrls and returns FileReferences
    const refs = await chat.uploadFiles([file]);
    uploadedFileRefs = refs;
    attachmentPreview.classList.remove('uploading');
    attachmentPreview.classList.add('ready');
  } catch (err) {
    console.error('[ChatCPT] Upload error:', err);
    attachmentPreview.classList.remove('uploading');
    attachmentPreview.classList.add('error');
    attachmentName.textContent = `Upload failed: ${file.name}`;
  } finally {
    isUploading = false;
    updateSendBtn();
  }
});

removeAttachmentBtn.addEventListener('click', () => {
  fileInput.value = '';
  clearAttachment();
  updateSendBtn();
});

function clearAttachment() {
  pendingFiles = [];
  uploadedFileRefs = [];
  attachmentPreview.hidden = true;
  attachmentPreview.classList.remove('uploading', 'ready', 'error');
}

// ── Input wiring ──────────────────────────────────────────────
promptInput.addEventListener('input', updateSendBtn);

promptInput.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !sendBtn.disabled) {
    e.preventDefault();
    sendMessage();
  }
});

sendBtn.addEventListener('click', sendMessage);

function updateSendBtn() {
  const streaming = chat?.status === 'streaming';
  const hasText = promptInput.value.trim().length > 0;
  const hasFile = uploadedFileRefs.length > 0;
  sendBtn.disabled = streaming || isUploading || (!hasText && !hasFile);
}

// ── Session persistence ───────────────────────────────────────

// Convert a stored plain-object message back into the shape renderMessages expects
// (mirrors the OctavusChat message structure just enough for rendering).
function storedToDisplayMsg(m) {
  return {
    role: m.role,
    status: 'done',
    parts: [
      ...(m.content ? [{ type: 'text', text: m.content }] : []),
      ...(m.files ?? []).map((f) => ({ type: 'file', ...f })),
    ],
  };
}

// Serialise OctavusChat messages into the storage format, prepend historical
// messages (already in storage format), and write the whole lot to disk.
function saveSession(liveMessages) {
  const liveSerialized = liveMessages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role,
      content: m.parts.filter((p) => p.type === 'text').map((p) => p.text).join(''),
      files: m.parts.filter((p) => p.type === 'file').map((p) => ({ filename: p.filename, mediaType: p.mediaType, url: p.url })),
      timestamp: new Date().toISOString(),
    }));

  const allMessages = [...restoredMessages, ...liveSerialized];

  // Update in-memory restored set so subsequent saves don't lose new messages
  restoredMessages = allMessages;

  fetch('/api/session/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, messages: allMessages }),
  }).catch((err) => console.warn('[ChatCPT] Session save failed:', err));
}

// ── Boot ──────────────────────────────────────────────────────
init();
