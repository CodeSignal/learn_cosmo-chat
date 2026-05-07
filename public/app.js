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

// Octavus returns generated images both as a markdown reference in the text
// AND as a file part. Rendering both causes duplicates. Apply the constrained
// CSS class here so markdown-embedded images obey the same size limits, and
// skip the separate file-parts pass for assistant messages.
renderer.image = function ({ href, text }) {
  return `<img class="message__file-image" src="${href}" alt="${text}" />`;
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
const newChatBtn          = document.getElementById('newChatBtn');
const sessionList         = document.getElementById('sessionList');

// ── State ─────────────────────────────────────────────────────
let chat = null;
let chatUnsubscribe = null;
let sessionId = null;
let pendingFiles = [];
let uploadedFileRefs = [];
let isUploading = false;
let lastStatus = null;
let restoredMessages = [];
let allSessionsMeta = []; // [{session_id, title, updated_at}]
let streamingStartTime = null;
let loadingIntervalId = null;
let chatConfig = {};

// ── Session wiring ────────────────────────────────────────────
function buildChat(sid) {
  if (chatUnsubscribe) { chatUnsubscribe(); chatUnsubscribe = null; }

  const transport = createHttpTransport({
    request: (payload, options) =>
      fetch('/api/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sid, ...payload }),
        signal: options?.signal,
      }),
  });

  const requestUploadUrls = async (files) => {
    const r = await fetch('/api/upload-urls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sid, files }),
    });
    return r.json();
  };

  chat = new OctavusChat({ transport, requestUploadUrls });
  chatUnsubscribe = chat.subscribe(() => {
    const { messages, status } = chat;

    // Track when streaming starts so the loading indicator knows elapsed time.
    // Drive periodic re-renders while streaming so the message text updates
    // even when no tokens arrive (e.g. during image generation).
    if (status === 'streaming' && lastStatus !== 'streaming') {
      streamingStartTime = Date.now();
      if (loadingIntervalId) clearInterval(loadingIntervalId);
      loadingIntervalId = setInterval(() => {
        if (chat?.status === 'streaming') {
          renderMessages(chat.messages, 'streaming');
        } else {
          clearInterval(loadingIntervalId);
          loadingIntervalId = null;
        }
      }, 1000);
    } else if (status !== 'streaming') {
      streamingStartTime = null;
      if (loadingIntervalId) { clearInterval(loadingIntervalId); loadingIntervalId = null; }
    }

    renderMessages(messages, status);
    if (lastStatus === 'streaming' && status !== 'streaming') {
      saveSession(messages);
    }
    lastStatus = status;
  });
}

// Switch to an existing session (by id).
async function switchSession(sid) {
  clearAttachment();
  promptInput.value = '';
  lastStatus = null;

  const res = await fetch(`/api/session?id=${sid}`);
  if (!res.ok) return;
  const data = await res.json();

  sessionId = data.sessionId;
  restoredMessages = data.messages ?? [];

  buildChat(sessionId);
  renderMessages([], 'idle');
  renderSidebar();
}

// ── Init ──────────────────────────────────────────────────────
async function init() {
  try {
    const [sessionRes, listRes, configRes] = await Promise.all([
      fetch('/api/session'),
      fetch('/api/sessions'),
      fetch('/api/config'),
    ]);
    if (!sessionRes.ok) throw new Error(await sessionRes.text());

    const data = await sessionRes.json();
    sessionId = data.sessionId;
    restoredMessages = data.messages ?? [];

    const listData = await listRes.json();
    allSessionsMeta = listData.sessions ?? [];

    chatConfig = configRes.ok ? await configRes.json() : {};
    applyInitialPrompt();

    buildChat(sessionId);
    renderMessages([], 'idle');
    renderSidebar();
  } catch (err) {
    console.error('[ChatCPT] Failed to initialise session:', err);
  }
}

// ── Loading state ─────────────────────────────────────────────
const THINKING_STAGES = [
  { after:  0, label: 'Thinking…' },
  { after:  5, label: 'Working on it…' },
  { after: 15, label: 'Still working…' },
  { after: 30, label: 'This might take a moment…' },
];

const IMAGE_STAGES = [
  { after:  0, label: 'Creating image…' },
  { after: 10, label: 'Polishing details…' },
  { after: 25, label: 'Finishing up…' },
  { after: 45, label: 'Almost there…' },
];

function renderLoadingState(parts = []) {
  const elapsed = streamingStartTime ? (Date.now() - streamingStartTime) / 1000 : 0;

  const activeTool = parts.find((p) => p.type === 'tool-call' && (p.status === 'pending' || p.status === 'running'));
  const toolName = activeTool?.toolName ?? '';

  if (toolName === 'octavus_generate_image') {
    const stage = IMAGE_STAGES.filter((s) => elapsed >= s.after).pop();
    const label = stage?.label ?? IMAGE_STAGES[0].label;
    return `
      <div class="image-placeholder" style="list-style:none">
        <div class="image-placeholder__canvas">
          <svg class="image-placeholder__icon" width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
        </div>
        <div class="image-placeholder__status" style="list-style:none">
          <span class="loading-indicator__dots" aria-hidden="true" style="display:flex;gap:4px;list-style:none">
            <span></span><span></span><span></span>
          </span>
          <span>${label}</span>
        </div>
      </div>
    `;
  }

  let stages, icon;
  if (toolName === 'octavus_web_search') {
    stages = [{ after: 0, label: 'Searching the web…' }];
    icon = '🔍';
  } else if (toolName.startsWith('octavus_skill')) {
    stages = [{ after: 0, label: 'Running tool…' }, { after: 10, label: 'Still running…' }];
    icon = '⚙️';
  } else {
    stages = THINKING_STAGES;
    icon = null;
  }

  const stage = stages.filter((s) => elapsed >= s.after).pop();
  const label = stage?.label ?? stages[0].label;

  return `
    <div class="loading-indicator">
      <span class="loading-indicator__dots" aria-hidden="true">
        <span></span><span></span><span></span>
      </span>
      <span class="loading-indicator__label">${icon ? `${icon} ` : ''}${label}</span>
    </div>
  `;
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
      const hasText = text.trim().length > 0;

      const renderedHtml = marked.parse(text);
      const bodyContent = (streaming && !hasText)
        ? renderLoadingState(msg.parts)
        : `${renderedHtml}${streaming ? '<span class="cursor" aria-hidden="true"></span>' : ''}`;

      row.className = 'message message--ai';
      row.innerHTML = `
        <div class="message__avatar">
          <span class="icon icon-cosmo-black icon-small"></span>
        </div>
        <div class="message__body body-medium markdown">
          ${bodyContent}
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

// Matches phrasing that indicates the user wants to edit/transform an uploaded image
// rather than just analyze or describe it.
const IMAGE_EDIT_INTENT = /\b(edit|modify|change|transform|convert|turn\s+(?:it\s+)?into|make\s+(?:it\s+)?(?:look|into)|apply|remove|add\s+(?:a\s+)?(?:background|effect|filter|style)|draw|sketch|paint|stylize|render|filter|generate\s+(?:a\s+)?(?:new\s+)?(?:version|image)\s+(?:of|from)|based\s+on|create\s+(?:a\s+)?(?:new\s+)?(?:version|image)\s+(?:of|from)|alter|adjust|enhance|redraw|reimagine|recreate|redesign|without|with\s+(?:a\s+)?(?:beard|glasses|hat|smile|different))\b/i;

function chooseTrigger(text, filesToSend) {
  const hasImageFiles = filesToSend.some(
    (f) => f.mediaType && f.mediaType.startsWith('image/'),
  );
  if (hasImageFiles && IMAGE_EDIT_INTENT.test(text)) {
    return 'image-edit';
  }
  return 'user-message';
}

async function sendMessage() {
  if (!chat || sendBtn.disabled) return;

  const text = promptInput.value.trim();
  if (!text && uploadedFileRefs.length === 0) return;

  promptInput.value = '';
  const filesToSend = [...uploadedFileRefs];
  clearAttachment();
  updateSendBtn();

  const trigger = chooseTrigger(text, filesToSend);

  try {
    await chat.send(
      trigger,
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

// ── Sidebar ───────────────────────────────────────────────────
function renderSidebar() {
  sessionList.innerHTML = '';

  for (const s of allSessionsMeta) {
    const item = document.createElement('div');
    item.className = 'session-item' + (s.session_id === sessionId ? ' session-item--active' : '');
    item.setAttribute('role', 'button');
    item.setAttribute('tabindex', '0');
    item.setAttribute('aria-label', s.title);

    const title = document.createElement('span');
    title.className = 'session-item__title body-small';
    title.textContent = s.title;

    const del = document.createElement('button');
    del.className = 'button button-text button-xsmall session-item__delete';
    del.setAttribute('aria-label', 'Delete conversation');
    del.title = 'Delete';
    del.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
    </svg>`;

    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      await deleteSession(s.session_id);
    });

    item.addEventListener('click', () => {
      if (s.session_id !== sessionId) switchSession(s.session_id);
    });
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') switchSession(s.session_id);
    });

    item.appendChild(title);
    item.appendChild(del);
    sessionList.appendChild(item);
  }
}

async function deleteSession(sid) {
  await fetch(`/api/sessions/${sid}`, { method: 'DELETE' });
  allSessionsMeta = allSessionsMeta.filter((s) => s.session_id !== sid);

  if (sid === sessionId) {
    // Deleted the active session — switch to next or create new
    if (allSessionsMeta.length > 0) {
      await switchSession(allSessionsMeta[0].session_id);
    } else {
      await startNewChat();
    }
  } else {
    renderSidebar();
  }
}

newChatBtn.addEventListener('click', startNewChat);

function applyInitialPrompt() {
  if (chatConfig.initialPrompt) {
    promptInput.value = chatConfig.initialPrompt;
    promptInput.dispatchEvent(new Event('input'));
  }
}

async function startNewChat() {
  const res = await fetch('/api/sessions', { method: 'POST' });
  if (!res.ok) return;
  const data = await res.json();

  sessionId = data.sessionId;
  restoredMessages = [];
  lastStatus = null;
  clearAttachment();
  applyInitialPrompt();

  // Prepend to the meta list so it appears at the top
  allSessionsMeta.unshift({ session_id: sessionId, title: 'New conversation', updated_at: new Date().toISOString() });

  buildChat(sessionId);
  renderMessages([], 'idle');
  renderSidebar();
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
  })
    .then(() => {
      // Refresh the sidebar title (first user message may now be available)
      const firstUser = allMessages.find((m) => m.role === 'user');
      const title = firstUser?.content
        ? (firstUser.content.length > 45 ? firstUser.content.slice(0, 45) + '…' : firstUser.content)
        : 'New conversation';
      const meta = allSessionsMeta.find((s) => s.session_id === sessionId);
      if (meta) { meta.title = title; meta.updated_at = new Date().toISOString(); }
      renderSidebar();
    })
    .catch((err) => console.warn('[ChatCPT] Session save failed:', err));
}

// ── Boot ──────────────────────────────────────────────────────
init();
