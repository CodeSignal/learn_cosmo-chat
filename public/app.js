/**
 * ChatCPT – app.js
 * UI wiring only. No backend calls yet.
 */

const promptInput         = document.getElementById('promptInput');
const sendBtn             = document.getElementById('sendBtn');
const chatHistory         = document.getElementById('chatHistory');
const emptyState          = document.getElementById('emptyState');
const uploadBtn           = document.getElementById('uploadBtn');
const fileInput           = document.getElementById('fileInput');
const attachmentPreview   = document.getElementById('attachmentPreview');
const attachmentName      = document.getElementById('attachmentName');
const removeAttachmentBtn = document.getElementById('removeAttachmentBtn');

// ── Textarea: enable send when non-empty ──────────────────────
promptInput.addEventListener('input', () => {
  sendBtn.disabled = promptInput.value.trim().length === 0;
});

// ── Cmd/Ctrl + Enter to send ──────────────────────────────────
promptInput.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !sendBtn.disabled) {
    e.preventDefault();
    sendBtn.click();
  }
});

// ── Send (stub) ───────────────────────────────────────────────
sendBtn.addEventListener('click', () => {
  console.log('[ChatCPT] Send:', promptInput.value);
});

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
