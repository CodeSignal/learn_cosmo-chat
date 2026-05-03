/**
 * ChatCPT – app.js
 * Connects to the backend via @octavus/client-sdk (HTTP/SSE transport).
 */

import { OctavusChat, createHttpTransport } from '@octavus/client-sdk';

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
// Holds File objects waiting to be uploaded-and-sent
let pendingFiles = [];
// Holds resolved FileReference objects after successful upload
let uploadedFileRefs = [];
let isUploading = false;

// ── Init ──────────────────────────────────────────────────────
async function init() {
  try {
    const res = await fetch('/api/sessions', { method: 'POST' });
    if (!res.ok) throw new Error(await res.text());
    ({ sessionId } = await res.json());

    const transport = createHttpTransport({
      request: (payload, options) =>
        fetch('/api/trigger', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, ...payload }),
          signal: options?.signal,
        }),
    });

    // requestUploadUrls keeps the API key server-side
    const requestUploadUrls = async (files) => {
      const res = await fetch('/api/upload-urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, files }),
      });
      return res.json();
    };

    chat = new OctavusChat({ transport, requestUploadUrls });
    chat.subscribe(() => renderMessages(chat.messages, chat.status));
  } catch (err) {
    console.error('[ChatCPT] Failed to initialise session:', err);
  }
}

// ── Render messages ───────────────────────────────────────────
function renderMessages(messages, status) {
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

      row.className = 'message message--ai';
      row.innerHTML = `
        <div class="message__avatar">
          <span class="icon icon-cosmo-black icon-small"></span>
        </div>
        <div class="message__body body-medium">
          ${text}${streaming ? '<span class="cursor" aria-hidden="true"></span>' : ''}
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

// ── Boot ──────────────────────────────────────────────────────
init();
