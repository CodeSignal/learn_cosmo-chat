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

// ── Session + chat state ──────────────────────────────────────
let chat = null;

async function init() {
  try {
    const res = await fetch('/api/sessions', { method: 'POST' });
    if (!res.ok) throw new Error(await res.text());
    const { sessionId } = await res.json();

    const transport = createHttpTransport({
      request: (payload, options) =>
        fetch('/api/trigger', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, ...payload }),
          signal: options?.signal,
        }),
    });

    chat = new OctavusChat({ transport });

    // Re-render whenever message state changes
    chat.subscribe(() => renderMessages(chat.messages, chat.status));
  } catch (err) {
    console.error('[ChatCPT] Failed to initialise session:', err);
  }
}

// ── Render messages ───────────────────────────────────────────
function renderMessages(messages, status) {
  // Hide empty state once there's something to show
  if (messages.length > 0 && emptyState) {
    emptyState.hidden = true;
  } else if (messages.length === 0 && emptyState) {
    emptyState.hidden = false;
  }

  // Ensure messages container exists
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
      const textParts = msg.parts.filter((p) => p.type === 'text');
      const textContent = textParts.map((p) => p.text).join('');
      const isStreaming = msg.status === 'streaming';

      row.className = 'message message--ai';
      row.innerHTML = `
        <div class="message__avatar">
          <span class="icon icon-cosmo-black icon-small"></span>
        </div>
        <div class="message__body body-medium">
          ${textContent}${isStreaming ? '<span class="cursor" aria-hidden="true"></span>' : ''}
        </div>
      `;
    } else if (msg.role === 'user') {
      const textParts = msg.parts.filter((p) => p.type === 'text');
      const textContent = textParts.map((p) => p.text).join('');

      row.className = 'message message--user';
      row.innerHTML = `
        <div class="box non-interactive message__bubble body-medium">${textContent}</div>
      `;
    } else {
      continue;
    }

    messagesEl.appendChild(row);
  }

  // Auto-scroll to bottom
  chatHistory.scrollTop = chatHistory.scrollHeight;

  // Disable input while streaming
  const isStreaming = status === 'streaming';
  promptInput.disabled = isStreaming;
  sendBtn.disabled = isStreaming || promptInput.value.trim().length === 0;
}

// ── Send ──────────────────────────────────────────────────────
async function sendMessage() {
  if (!chat || sendBtn.disabled) return;

  const text = promptInput.value.trim();
  if (!text) return;

  promptInput.value = '';
  sendBtn.disabled = true;

  try {
    await chat.send(
      'user-message',
      { USER_MESSAGE: text },
      { userMessage: { content: text } },
    );
  } catch (err) {
    console.error('[ChatCPT] Send error:', err);
  }
}

// ── Input wiring ──────────────────────────────────────────────
promptInput.addEventListener('input', () => {
  const isStreaming = chat?.status === 'streaming';
  sendBtn.disabled = isStreaming || promptInput.value.trim().length === 0;
});

promptInput.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !sendBtn.disabled) {
    e.preventDefault();
    sendMessage();
  }
});

sendBtn.addEventListener('click', sendMessage);

// ── File attachment ───────────────────────────────────────────
uploadBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (!file) return;
  attachmentName.textContent = file.name;
  attachmentPreview.hidden = false;
});

removeAttachmentBtn.addEventListener('click', () => {
  fileInput.value = '';
  attachmentPreview.hidden = true;
});

// ── Boot ──────────────────────────────────────────────────────
init();
