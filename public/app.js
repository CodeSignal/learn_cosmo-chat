/**
 * ChatCPT – app.js
 * Connects to the backend via @octavus/client-sdk (HTTP/SSE transport).
 */

import { OctavusChat, createHttpTransport } from '@octavus/client-sdk';
import Dropdown from '../design-system/components/dropdown/dropdown.js';
import Modal from '../design-system/components/modal/modal.js';
import NumericSlider from '../design-system/components/numeric-slider/numeric-slider.js';
import { marked, Renderer } from 'marked';
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
        <span class="code-block__lang">${label}</span>
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

renderer.table = function (token) {
  const inner = Renderer.prototype.table.call(this, token);
  return `<div class="message__table-scroll">${inner}</div>`;
};

// Force all rendered links to open in a new tab (with safe rel attributes).
renderer.link = function (token) {
  const html = Renderer.prototype.link.call(this, token);
  return html.replace(/^<a /, '<a target="_blank" rel="noopener noreferrer" ');
};

marked.use({ breaks: true, gfm: true, renderer });

/** Strip leading emoji / pictographic decorations models often put before heading text (e.g. colored squares). */
const HEADING_LEAD_PICTO = /^((?:\p{Extended_Pictographic}|\uFE0F|\u200D)+[\s\uFE0F\u200D]*)+/u;

function stripLeadingDecorationsFromFirstTextNode(el) {
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent.replace(HEADING_LEAD_PICTO, '');
      if (t !== node.textContent) node.textContent = t;
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      stripLeadingDecorationsFromFirstTextNode(node);
      return;
    }
  }
}

function stripHeadingLeadDecorationsFromHtml(html) {
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  wrap.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(stripLeadingDecorationsFromFirstTextNode);
  return wrap.innerHTML;
}

/** Remove emoji / pictographs from prose; leaves &lt;pre&gt; code blocks untouched. */
const EMOJI_CHAR_RE = /\p{Extended_Pictographic}/gu;

function stripEmojisFromHtml(html) {
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  const walker = document.createTreeWalker(wrap, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      let el = node.parentElement;
      while (el) {
        if (el.tagName === 'PRE') return NodeFilter.FILTER_REJECT;
        el = el.parentElement;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes = [];
  let n;
  while ((n = walker.nextNode())) nodes.push(n);
  for (const node of nodes) {
    const cleaned = node.textContent.replace(EMOJI_CHAR_RE, '').replace(/\uFE0F/g, '');
    if (cleaned !== node.textContent) node.textContent = cleaned;
  }
  return wrap.innerHTML;
}

// ── DOM references ────────────────────────────────────────────
const promptInput         = document.getElementById('promptInput');
const sendBtn             = document.getElementById('sendBtn');
const chatHistory         = document.getElementById('chatHistory');
const emptyState          = document.getElementById('emptyState');
const uploadImageBtn      = document.getElementById('uploadImageBtn');
const uploadFileBtn       = document.getElementById('uploadFileBtn');
const fileInput           = document.getElementById('fileInput');
const attachmentPreview   = document.getElementById('attachmentPreview');
const newChatBtn          = document.getElementById('newChatBtn');
const sessionList         = document.getElementById('sessionList');
const modelSelect         = document.getElementById('modelSelect');
const settingsBtn         = document.getElementById('settingsBtn');
const historyHeading      = document.getElementById('historyHeading');
const sidebarSpacer       = document.getElementById('sidebarSpacer');

/** True when the viewport is near the bottom of the chat log (follow new tokens without snapping when scrolled up). */
function isChatNearBottom(thPx = 120) {
  if (!chatHistory) return true;
  const { scrollHeight, scrollTop, clientHeight } = chatHistory;
  return scrollHeight - scrollTop - clientHeight < thPx;
}

// ── State ─────────────────────────────────────────────────────
let chat = null;
let chatUnsubscribe = null;
let sessionId = null;
// Each entry: { file: File, ref: FileRef|null, status: 'uploading'|'ready'|'error' }
let fileItems = [];
let isUploading = false;
let lastStatus = null;
let restoredMessages = [];
let allSessionsMeta = []; // [{session_id, title, updated_at}]
let streamingStartTime = null;
let loadingIntervalId = null;
let chatConfig = {};
let availableModels = [];
let selectedModel = '';
let selectedTemperature = 0.7;
let selectedThinking = 'off';
let currentAbortController = null;
let settingsModal = null;
let thinkingDropdownInstance = null;
let temperatureSliderInstance = null;

// ── Session wiring ────────────────────────────────────────────
function buildChat(sid) {
  if (chatUnsubscribe) { chatUnsubscribe(); chatUnsubscribe = null; }

  const transport = createHttpTransport({
    request: (payload, options) => {
      currentAbortController = new AbortController();
      return fetch('/api/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sid, ...payload }),
        signal: currentAbortController.signal,
      });
    },
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

    // Persistence strategy:
    //  • Entering streaming → save immediately so the user message is
    //    durable even if the turn never finishes (crash / closed tab).
    //  • Mid-stream → persist partial output at most once per second.
    //  • Leaving streaming → force a final save so the complete message
    //    is never lost to throttling.
    if (status === 'streaming') {
      if (lastStatus !== 'streaming') flushSave();
      else throttledSave();
    } else if (lastStatus === 'streaming') {
      flushSave();
    }
    lastStatus = status;
  });
}

// Switch to an existing session (by id).
async function switchSession(sid) {
  cancelPendingSave();
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

// ── Model selector ────────────────────────────────────────────
let modelDropdownInstance = null;

function modelDisplayName(modelId) {
  const names = chatConfig.modelDisplayNames || {};
  return names[modelId] || modelId.replace(/^openrouter\//, '');
}

function renderModelSelector() {
  const modelStatic = document.getElementById('modelStatic');

  if (availableModels.length === 1) {
    modelSelect.style.display = 'none';
    modelStatic.removeAttribute('hidden');
    modelStatic.style.display = '';
    modelStatic.textContent = modelDisplayName(availableModels[0]);
    return;
  }

  modelStatic.setAttribute('hidden', '');
  modelSelect.style.display = '';

  // Tear down existing instance before rebuilding
  if (modelDropdownInstance) {
    modelDropdownInstance.destroy();
    modelDropdownInstance = null;
  }

  const items = availableModels.map((m) => ({
    value: m,
    label: modelDisplayName(m),
  }));

  modelDropdownInstance = new Dropdown(modelSelect, {
    items,
    selectedValue: selectedModel || undefined,
    width: '100%',
    onSelect: (value) => {
      selectedModel = value;
      startNewChat();
    },
  });
}

// ── Settings modal ────────────────────────────────────────────
const THINKING_OPTIONS = [
  { value: 'off',    label: 'Off' },
  { value: 'low',    label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high',   label: 'High' },
  { value: 'max',    label: 'Max' },
];

// Apply the (client-side) parts of chatConfig to the live UI. Safe to
// call repeatedly — used at load and whenever a setting changes in the
// settings modal. Toggles both ways so runtime changes take effect.
function applyChatConfigUI() {
  if (settingsBtn) settingsBtn.style.display = chatConfig.hideSettings ? 'none' : '';

  const headingEl = document.querySelector('.empty-state__heading');
  if (headingEl && chatConfig.heading !== undefined) headingEl.textContent = chatConfig.heading;

  const footerEl = document.querySelector('.composer__hint');
  if (footerEl && chatConfig.footer !== undefined) footerEl.textContent = chatConfig.footer;

  if (chatConfig.title !== undefined) {
    document.title = chatConfig.title;
    const titleEl = document.querySelector('.sidebar__title');
    if (titleEl) titleEl.textContent = chatConfig.title;
  }

  if (chatConfig.placeholder !== undefined) promptInput.placeholder = chatConfig.placeholder;

  const attachIcons = document.getElementById('attachIcons');
  if (attachIcons) attachIcons.style.display = chatConfig.hideFileUpload ? 'none' : '';

  if (chatConfig.hideHistory) {
    if (sidebarSpacer)   sidebarSpacer.style.display   = '';
    if (historyHeading)  historyHeading.style.display  = 'none';
    if (sessionList)     sessionList.style.display     = 'none';
  } else {
    if (sidebarSpacer)   sidebarSpacer.style.display   = 'none';
    if (historyHeading)  historyHeading.style.display  = '';
    if (sessionList)     sessionList.style.display     = '';
  }
}

function openSettings() {
  if (!settingsModal) {
    const content = document.createElement('div');
    content.className = 'settings-content';
    content.innerHTML = `
      <section class="settings-section">
        <h3 class="label-small settings-section__title">Generation</h3>

        <div class="settings-row" id="temperatureRow">
          <div class="settings-row__label-line">
            <label class="body-small settings-row__label">Temperature</label>
            <span class="body-small settings-row__value" id="temperatureValue"></span>
          </div>
          <p class="body-xsmall settings-row__desc">Controls randomness (0–2). Lower = more focused, higher = more creative. Disabled when Thinking is on.</p>
          <div class="settings-slider-container" id="temperatureSliderEl"></div>
        </div>

        <div class="settings-row">
          <label class="body-small settings-row__label">Thinking</label>
          <p class="body-xsmall settings-row__desc">Extended reasoning depth. When enabled, temperature is ignored by the model.</p>
          <div class="settings-dropdown-container" id="thinkingDropdownEl"></div>
        </div>
      </section>
    `;

    settingsModal = new Modal({
      size: 'medium',
      title: 'Settings',
      content,
      closeOnOverlayClick: true,
      closeOnEscape: true,
      onOpen: () => {
        const sliderEl    = settingsModal.content.querySelector('#temperatureSliderEl');
        const dropdownEl  = settingsModal.content.querySelector('#thinkingDropdownEl');
        const tempRow     = settingsModal.content.querySelector('#temperatureRow');

        // Thinking dropdown
        if (thinkingDropdownInstance) thinkingDropdownInstance.destroy();
        thinkingDropdownInstance = new Dropdown(dropdownEl, {
          items: THINKING_OPTIONS,
          selectedValue: selectedThinking,
          width: '100%',
          onSelect: (value) => {
            selectedThinking = value;
            // Dim temperature row when thinking is active
            tempRow.classList.toggle('settings-row--disabled', value !== 'off');
          },
        });

        // Temperature slider — reinit each open so it measures the visible DOM
        const tempValueEl = settingsModal.content.querySelector('#temperatureValue');
        const updateTempLabel = (v) => { if (tempValueEl) tempValueEl.textContent = Number(v).toFixed(2); };
        updateTempLabel(selectedTemperature);

        if (temperatureSliderInstance) temperatureSliderInstance.destroy();
        temperatureSliderInstance = new NumericSlider(sliderEl, {
          type: 'single',
          min: 0,
          max: 2,
          step: 0.05,
          value: selectedTemperature,
          showInputs: false,
          continuousUpdates: true,
          onChange: (value) => { selectedTemperature = value; updateTempLabel(value); },
        });

        // Reflect current thinking state on open
        tempRow.classList.toggle('settings-row--disabled', selectedThinking !== 'off');
      },
      footerButtons: [
        { label: 'Close', type: 'secondary', onClick: () => settingsModal.close() },
        { label: 'Apply & New Chat', type: 'primary', onClick: () => { settingsModal.close(); startNewChat(); } },
      ],
    });
  }
  settingsModal.open();
}

if (settingsBtn) settingsBtn.addEventListener('click', openSettings);

// ── Sidebar resizer ───────────────────────────────────────────
(function initSidebarResizer() {
  const sidebarEl = document.getElementById('sidebar');
  const resizer   = document.getElementById('sidebarResizer');
  if (!sidebarEl || !resizer) return;

  const MIN = 200;
  const MAX = 480;
  const STEP = 16;
  const STORAGE_KEY = 'chatcpt:sidebarWidth';
  const clamp = (w) => Math.max(MIN, Math.min(MAX, w));
  const setWidth = (w, persist = true) => {
    const c = clamp(Math.round(w));
    document.documentElement.style.setProperty('--sidebar-width', `${c}px`);
    if (persist) localStorage.setItem(STORAGE_KEY, String(c));
    resizer.setAttribute('aria-valuenow', String(c));
  };

  // Advertise the adjustable range to assistive tech (static bounds).
  resizer.setAttribute('aria-valuemin', String(MIN));
  resizer.setAttribute('aria-valuemax', String(MAX));

  // Sync aria-valuenow to whatever width the sidebar currently renders at.
  const syncValueNow = () => {
    resizer.setAttribute('aria-valuenow', String(Math.round(parseFloat(getComputedStyle(sidebarEl).width))));
  };

  // Restore a saved width.
  const saved = parseInt(localStorage.getItem(STORAGE_KEY), 10);
  if (Number.isFinite(saved)) setWidth(saved, false);
  else syncValueNow();

  let dragging = false;
  const onMove = (e) => {
    if (!dragging) return;
    setWidth(e.clientX - sidebarEl.getBoundingClientRect().left, false);
  };
  const onUp = (e) => {
    if (!dragging) return;
    dragging = false;
    resizer.classList.remove('is-dragging');
    document.body.classList.remove('is-resizing-sidebar');
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    try { resizer.releasePointerCapture(e.pointerId); } catch {}
    // Persist the final width.
    setWidth(parseFloat(getComputedStyle(sidebarEl).width));
  };

  resizer.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    dragging = true;
    resizer.classList.add('is-dragging');
    document.body.classList.add('is-resizing-sidebar');
    try { resizer.setPointerCapture(e.pointerId); } catch {}
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });

  // Keyboard support (arrow keys nudge the width).
  resizer.addEventListener('keydown', (e) => {
    const cur = parseFloat(getComputedStyle(sidebarEl).width);
    if (e.key === 'ArrowLeft')  { setWidth(cur - STEP); e.preventDefault(); }
    if (e.key === 'ArrowRight') { setWidth(cur + STEP); e.preventDefault(); }
  });

  // Double-click resets to the default width.
  resizer.addEventListener('dblclick', () => {
    document.documentElement.style.removeProperty('--sidebar-width');
    localStorage.removeItem(STORAGE_KEY);
    // Reflect the restored default width in ARIA.
    syncValueNow();
  });
})();

function showBootError(message) {
  const el = document.getElementById('bootError');
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
}

// ── Init ──────────────────────────────────────────────────────
async function init() {
  try {
    const sessionRes = await fetch('/api/session');

    if (!sessionRes.ok) {
      if (sessionRes.status === 503) {
        showBootError(
          'Chat cannot start: the server is missing Octavus configuration. Create a .env in the project root with OCTAVUS_API_URL, OCTAVUS_API_KEY, and OCTAVUS_AGENT_ID, then stop the dev server completely and run npm run dev again (environment variables load only at startup).',
        );
      } else {
        const raw = await sessionRes.text();
        showBootError(`Could not start session (HTTP ${sessionRes.status}). ${raw || ''}`.trim());
      }
      throw new Error('session init failed');
    }

    const data = await sessionRes.json();
    sessionId = data.sessionId;
    restoredMessages = data.messages ?? [];

    const [listRes, configRes, modelsRes] = await Promise.all([
      fetch('/api/sessions'),
      fetch('/api/config'),
      fetch('/api/models'),
    ]);

    const listData = await listRes.json();
    allSessionsMeta = listData.sessions ?? [];
    if (!allSessionsMeta.some((s) => s.session_id === sessionId)) {
      allSessionsMeta.unshift({
        session_id: sessionId,
        title: 'New conversation',
        updated_at: new Date().toISOString(),
      });
    }

    chatConfig = configRes.ok ? await configRes.json() : {};
    applyInitialPrompt();
    if (chatConfig.temperature !== undefined) selectedTemperature = chatConfig.temperature;
    if (chatConfig.thinking   !== undefined) selectedThinking    = chatConfig.thinking;
    applyChatConfigUI();

    const modelsData = modelsRes.ok ? await modelsRes.json() : { models: [] };
    availableModels = modelsData.models;
    selectedModel = chatConfig.model || availableModels[0] || '';
    renderModelSelector();

    buildChat(sessionId);
    renderMessages([], 'idle');
    renderSidebar();

    document.querySelector('.chat-app').style.visibility = '';
  } catch (err) {
    console.error('[ChatCPT] Failed to initialise session:', err);
    const el = document.getElementById('bootError');
    if (el && el.hidden) {
      showBootError(
        'Could not start the app. Make sure npm run dev is running and check the browser console for details.',
      );
    }
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

const THINKING_BORDER_DURATION_SEC = 1.5;

function activeToolNameFromParts(parts = []) {
  const active = parts.find((p) => p.type === 'tool-call' && (p.status === 'pending' || p.status === 'running'));
  return active?.toolName ?? '';
}

function isImageGenerationLoading(parts) {
  return activeToolNameFromParts(parts) === 'octavus_generate_image';
}

/** Keeps conic border phase continuous across renderMessages() DOM rebuilds (matches animation duration in app.css). */
function thinkingBorderAnimationDelayAttr() {
  if (!streamingStartTime) return '';
  const sec = (Date.now() - streamingStartTime) / 1000;
  const wrapped = ((sec % THINKING_BORDER_DURATION_SEC) + THINKING_BORDER_DURATION_SEC) % THINKING_BORDER_DURATION_SEC;
  return ` style="animation-delay: -${wrapped.toFixed(3)}s"`;
}

/** Image-generation canvas + shimmer only (status text lives in .message__ai-trailing). */
function renderImagePlaceholderBody() {
  return `
      <div class="image-placeholder image-placeholder--body" style="list-style:none">
        <div class="image-placeholder__canvas">
          <svg class="image-placeholder__icon" width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
        </div>
      </div>
    `;
}

/**
 * Label shown next to the avatar while streaming (no three-dot animation).
 * @returns {{ label: string, icon: string | null, isImage: boolean }}
 */
function getStreamingStatus(parts = []) {
  const elapsed = streamingStartTime ? (Date.now() - streamingStartTime) / 1000 : 0;
  const toolName = activeToolNameFromParts(parts);

  if (toolName === 'octavus_generate_image') {
    const stage = IMAGE_STAGES.filter((s) => elapsed >= s.after).pop();
    const label = stage?.label ?? IMAGE_STAGES[0].label;
    return { label, icon: null, isImage: true };
  }

  let stages;
  if (toolName === 'octavus_web_search') {
    stages = [{ after: 0, label: 'Searching the web…' }];
  } else if (toolName.startsWith('octavus_skill')) {
    stages = [{ after: 0, label: 'Running tool…' }, { after: 10, label: 'Still running…' }];
  } else {
    stages = THINKING_STAGES;
  }

  const stage = stages.filter((s) => elapsed >= s.after).pop();
  const label = stage?.label ?? stages[0].label;
  return { label, icon: null, isImage: false };
}

// ── Render messages ───────────────────────────────────────────
// `liveMessages` comes from OctavusChat; `restoredMessages` are pre-loaded from disk.
// We display restored first, then live so the conversation reads continuously.
function renderMessages(liveMessages, status) {
  const wasPinnedToBottom = isChatNearBottom();
  const messages = [...restoredMessages.map(storedToDisplayMsg), ...liveMessages];

  let messagesEl = chatHistory.querySelector('.messages');
  if (!messagesEl) {
    messagesEl = document.createElement('div');
    messagesEl.className = 'messages';
    chatHistory.appendChild(messagesEl);
  }

  messagesEl.innerHTML = '';

  const isIdle = status !== 'streaming';
  let userAssistantIdx = 0;
  const lastAssistantIdx = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return i;
    }
    return -1;
  })();

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const row = document.createElement('div');

    if (msg.role === 'assistant') {
      const text = msg.parts.filter((p) => p.type === 'text').map((p) => p.text).join('');
      const fileParts = msg.parts.filter((p) => p.type === 'file');
      const streaming = msg.status === 'streaming';
      const hasText = text.trim().length > 0;
      const renderedHtml = stripEmojisFromHtml(
        stripHeadingLeadDecorationsFromHtml(marked.parse(text)),
      );
      const filesHtml = fileParts.map((f) => renderFilePart(f)).join('');

      const isImageGen = isImageGenerationLoading(msg.parts);

      let bodyContent;
      if (streaming && !hasText && fileParts.length === 0 && isImageGen) {
        bodyContent = renderImagePlaceholderBody();
      } else if (streaming && !hasText && fileParts.length === 0 && !isImageGen) {
        bodyContent = '';
      } else if (streaming && fileParts.length === 0) {
        bodyContent = `${renderedHtml}<span class="cursor" aria-hidden="true"></span>`;
      } else {
        bodyContent = `${renderedHtml}${filesHtml}${streaming ? '<span class="cursor" aria-hidden="true"></span>' : ''}`;
      }

      const streamingStatus = streaming && fileParts.length === 0 ? getStreamingStatus(msg.parts) : null;
      const statusHtml = streamingStatus
        ? `<div class="message__ai-status body-xsmall" aria-live="polite">${streamingStatus.icon ? `${streamingStatus.icon} ` : ''}${streamingStatus.label}</div>`
        : '';

      const showThinkingRing = streaming;
      const avatarOpen = showThinkingRing
        ? `<div class="message__avatar message__avatar--thinking"${thinkingBorderAnimationDelayAttr()}>`
        : '<div class="message__avatar">';
      const avatarClose = '</div>';

      // Only the last assistant message gets the trailing Cosmo avatar
      // (and its thinking animation) — earlier replies don't repeat it.
      const trailingHtml = i === lastAssistantIdx ? `
        <div class="message__ai-trailing">
          ${avatarOpen}
            <span class="cosmo-avatar small" role="img" aria-label="Cosmo"></span>
          ${avatarClose}
          ${statusHtml}
        </div>
      ` : '';

      row.className = streaming ? 'message message--ai message--ai--streaming' : 'message message--ai';
      row.innerHTML = `
        <div class="message__body body-medium markdown">
          ${bodyContent}
        </div>
        ${trailingHtml}
      `;

      if (msg.stopped) {
        const stoppedEl = document.createElement('div');
        stoppedEl.className = 'message__stopped body-xsmall';
        stoppedEl.textContent = 'Response stopped';
        row.querySelector('.message__body').appendChild(stoppedEl);
      }

      // Hover actions on every assistant message (when idle): regenerate
      // and copy-as-markdown. Both use the .button-icon style and reveal on
      // hover. On the last message they share the trailing avatar row (12px
      // from the avatar); earlier messages get their own row below.
      if (!chatConfig.hidePromptControls && isIdle && (hasText || msg.stopped)) {
        const actions = document.createElement('div');
        actions.className = 'message__msg-actions';

        const regenBtn = document.createElement('button');
        regenBtn.type = 'button';
        regenBtn.className = 'button-icon message__hover-btn';
        regenBtn.setAttribute('aria-label', 'Regenerate response');
        regenBtn.title = 'Regenerate';
        regenBtn.innerHTML = REGEN_ICON_SVG;
        const capturedIdx = userAssistantIdx;
        regenBtn.addEventListener('click', () => regenerateResponse(capturedIdx));
        actions.appendChild(regenBtn);

        if (hasText) {
          const copyBtn = document.createElement('button');
          copyBtn.type = 'button';
          copyBtn.className = 'button-icon message__hover-btn';
          copyBtn.setAttribute('aria-label', 'Copy as Markdown');
          copyBtn.title = 'Copy';
          copyBtn.innerHTML = COPY_ICON_SVG;
          const markdown = text;
          copyBtn.addEventListener('click', () => copyMessageMarkdown(copyBtn, markdown));
          actions.appendChild(copyBtn);
        }

        const trailing = row.querySelector('.message__ai-trailing');
        if (trailing) {
          trailing.appendChild(actions);
        } else {
          actions.classList.add('message__msg-actions--standalone');
          row.appendChild(actions);
        }
      }
    } else if (msg.role === 'user') {
      const text = msg.parts.filter((p) => p.type === 'text').map((p) => p.text).join('');
      const fileParts = msg.parts.filter((p) => p.type === 'file');

      const filesHtml = fileParts.map((f) => renderFilePart(f)).join('');

      row.className = 'message message--user';
      row.innerHTML = `
        <div class="message__user-content">
          ${filesHtml}
          ${text ? `<div class="message__bubble body-medium">${text}</div>` : ''}
        </div>
      `;

      if (!chatConfig.hidePromptControls && isIdle && text) {
        const actionsEl = document.createElement('div');
        actionsEl.className = 'message__actions message__actions--user';

        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'button-icon';
        editBtn.setAttribute('aria-label', 'Edit message');
        editBtn.title = 'Edit';
        // Edit icon (local inline SVG) — inherits currentColor. A matching
        // stroke fattens the otherwise-thin fill paths.
        editBtn.innerHTML = `<svg viewBox="0 0 32 32" fill="currentColor" stroke="currentColor" stroke-width="0.75" stroke-linejoin="round" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="m27.1 7.16-2.26-2.26c-1.2-1.2-3.15-1.2-4.35 0l-3.79 3.8s0 0 0 0l-11.19 11.18c-.98.98-1.51 2.27-1.51 3.65v3.47c0 .55.45 1 1 1h3.47c1.38 0 2.67-.54 3.65-1.51l11.19-11.18s0 0 0 0l3.79-3.8c.58-.58.9-1.35.9-2.17s-.32-1.59-.9-2.17zm-16.4 17.91c-.6.6-1.39.93-2.23.93h-2.47v-2.47c0-.84.33-1.64.93-2.23l10.48-10.47 3.78 3.78-10.48 10.48zm14.99-14.98s0 0 0 0l-3.08 3.09-3.78-3.78 3.08-3.09c.42-.42 1.1-.42 1.52 0l2.26 2.26c.2.2.31.47.31.76s-.11.55-.31.76z"/>
          <path d="m26 26h-10c-.55 0-1 .45-1 1s.45 1 1 1h10c.55 0 1-.45 1-1s-.45-1-1-1z"/>
        </svg>`;
        const capturedIdx = userAssistantIdx;
        const capturedText = text;
        editBtn.addEventListener('click', () => startEditingMessage(row, capturedIdx, capturedText));

        actionsEl.appendChild(editBtn);
        row.querySelector('.message__user-content').appendChild(actionsEl);
      }
    } else {
      continue;
    }

    if (msg.role === 'user' || msg.role === 'assistant') userAssistantIdx++;
    messagesEl.appendChild(row);
  }

  if (emptyState) {
    emptyState.hidden = messagesEl.childElementCount > 0;
  }

  if (wasPinnedToBottom) {
    requestAnimationFrame(() => {
      if (!chatHistory) return;
      chatHistory.scrollTop = Math.max(0, chatHistory.scrollHeight - chatHistory.clientHeight);
    });
  }

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
  if (!isComposerSendAllowed()) return;

  const text = promptInput.value.trim();
  const readyRefs = fileItems.filter((i) => i.status === 'ready').map((i) => i.ref);
  if (!text && readyRefs.length === 0) return;

  promptInput.value = '';
  const filesToSend = readyRefs;
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
const ACCEPT_IMAGE_TYPES =
  'image/png,image/jpeg,image/jpg,image/gif,image/webp';
const ACCEPT_FILE_TYPES =
  '.pdf,.txt,.doc,.docx,.png,.jpg,.jpeg,.gif,.webp,application/pdf,text/plain';

function openFilePicker(accept) {
  fileInput.accept = accept;
  fileInput.click();
}

uploadImageBtn.addEventListener('click', () => openFilePicker(ACCEPT_IMAGE_TYPES));
uploadFileBtn.addEventListener('click', () => openFilePicker(ACCEPT_FILE_TYPES));

async function handleFiles(files) {
  if (!files.length || !chat) return;

  const newItems = files.map((f) => ({
    file: f,
    ref: null,
    status: 'uploading',
    previewUrl: f.type?.startsWith('image/') ? URL.createObjectURL(f) : null,
  }));
  fileItems = [...fileItems, ...newItems];
  isUploading = true;
  renderAttachmentPreview();
  updateSendBtn();

  try {
    const refs = await chat.uploadFiles(files);
    refs.forEach((ref, i) => {
      newItems[i].ref = ref;
      newItems[i].status = 'ready';
    });
  } catch (err) {
    console.error('[ChatCPT] Upload error:', err);
    newItems.forEach((item) => { item.status = 'error'; });
  } finally {
    isUploading = false;
    renderAttachmentPreview();
    updateSendBtn();
  }
}

fileInput.addEventListener('change', () => {
  const files = Array.from(fileInput.files);
  fileInput.value = '';
  handleFiles(files);
});

promptInput.addEventListener('paste', (e) => {
  const items = Array.from(e.clipboardData?.items ?? []);
  const imageFiles = items
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter(Boolean);
  if (imageFiles.length > 0) {
    e.preventDefault();
    handleFiles(imageFiles);
  }
});

function renderAttachmentPreview() {
  const hasItems = fileItems.length > 0;
  attachmentPreview.hidden = !hasItems;
  attachmentPreview.innerHTML = '';

  fileItems.forEach((item) => {
    const isImage = item.file.type?.startsWith('image/');
    const wrap = document.createElement('div');
    wrap.className = 'composer__thumb composer__thumb-plate';
    if (item.status === 'uploading') wrap.classList.add('composer__thumb--uploading');
    else if (item.status === 'error') wrap.classList.add('composer__thumb--error');
    else wrap.classList.add('composer__thumb--ready');
    wrap.setAttribute('aria-busy', item.status === 'uploading' ? 'true' : 'false');

    const inner = document.createElement('div');
    inner.className = 'composer__thumb-inner';

    if (isImage && item.previewUrl) {
      const img = document.createElement('img');
      img.className = 'composer__thumb-img';
      img.src = item.previewUrl;
      img.alt = item.file.name || '';
      inner.appendChild(img);
    } else {
      const ph = document.createElement('div');
      ph.className = 'composer__thumb-file';
      ph.setAttribute('aria-hidden', 'true');
      ph.innerHTML = `
        <svg class="composer__thumb-file-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
        <span class="composer__thumb-file-ext body-xsmall"></span>
      `;
      const ext = item.file.name?.includes('.')
        ? item.file.name.split('.').pop().slice(0, 8).toUpperCase()
        : 'FILE';
      ph.querySelector('.composer__thumb-file-ext').textContent = ext;
      inner.appendChild(ph);
    }

    if (item.status === 'uploading') {
      const overlay = document.createElement('div');
      overlay.className = 'composer__thumb-overlay';
      overlay.setAttribute('aria-hidden', 'true');
      const spinner = document.createElement('div');
      spinner.className = 'composer__thumb-spinner';
      spinner.setAttribute('aria-hidden', 'true');
      inner.appendChild(overlay);
      inner.appendChild(spinner);
    }

    if (item.status === 'error') {
      const err = document.createElement('div');
      err.className = 'composer__thumb-error';
      err.textContent = 'Upload failed';
      inner.appendChild(err);
    }

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'composer__thumb-remove';
    removeBtn.setAttribute('aria-label', `Remove ${item.file.name || 'attachment'}`);
    removeBtn.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
        <path d="M18 6L6 18M6 6l12 12"/>
      </svg>
    `;
    removeBtn.addEventListener('click', () => {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      const i = fileItems.indexOf(item);
      if (i >= 0) fileItems.splice(i, 1);
      renderAttachmentPreview();
      updateSendBtn();
    });

    inner.appendChild(removeBtn);
    wrap.appendChild(inner);
    attachmentPreview.appendChild(wrap);
  });
}

function clearAttachment() {
  fileItems.forEach((item) => {
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  });
  fileItems = [];
  renderAttachmentPreview();
}

// ── Input wiring ──────────────────────────────────────────────
promptInput.addEventListener('input', updateSendBtn);

function isComposerSendAllowed() {
  if (!chat || isUploading) return false;
  if (chat.status === 'streaming') return false;
  const hasText = promptInput.value.trim().length > 0;
  const hasFile = fileItems.some((i) => i.status === 'ready');
  return hasText || hasFile;
}

promptInput.addEventListener('keydown', (e) => {
  const isEnter = e.key === 'Enter' || e.key === 'NumpadEnter';
  if (!isEnter || e.isComposing) return;
  if (e.shiftKey) return; // Shift+Enter / Shift+Return → new line
  if (!isComposerSendAllowed()) return;
  e.preventDefault();
  sendMessage();
});

sendBtn.addEventListener('click', () => {
  if (!chatConfig.hidePromptControls && chat?.status === 'streaming') {
    stopGeneration();
  } else {
    sendMessage();
  }
});

function stopGeneration() {
  cancelPendingSave();
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
  }

  if (loadingIntervalId) {
    clearInterval(loadingIntervalId);
    loadingIntervalId = null;
  }
  streamingStartTime = null;

  const partialMessages = chat?.messages ?? [];
  const hadPartial = partialMessages.length > 0;
  if (hadPartial) {
    const serialized = serializeLiveMessages(partialMessages);

    // Flag the final assistant turn so the UI shows "Response stopped".
    for (let i = serialized.length - 1; i >= 0; i--) {
      if (serialized[i].role === 'assistant') {
        serialized[i].stopped = true;
        break;
      }
    }

    // Fold the partial turn into the pre-load history (append, don't
    // overwrite) so any earlier resumed/forked history is preserved.
    restoredMessages = [...restoredMessages, ...serialized];
  }

  // Rebuild the chat so the live message set is cleared before we persist;
  // saveSession() then writes restoredMessages (the full convo) only.
  lastStatus = null;
  buildChat(sessionId);
  renderMessages([], 'idle');
  if (hadPartial) saveSession();
}

function updateSendBtn() {
  const streaming = chat?.status === 'streaming';
  const showStop = streaming && !chatConfig.hidePromptControls;
  const sendSvg = sendBtn.querySelector('.composer__send-svg');
  const stopSvg = sendBtn.querySelector('.composer__stop-svg');

  if (showStop) {
    sendBtn.disabled = false;
    sendBtn.setAttribute('aria-label', 'Stop generation');
    if (sendSvg) sendSvg.style.display = 'none';
    if (stopSvg) stopSvg.style.display = '';
  } else {
    sendBtn.disabled = !isComposerSendAllowed();
    sendBtn.setAttribute('aria-label', 'Send prompt');
    if (sendSvg) sendSvg.style.display = '';
    if (stopSvg) stopSvg.style.display = 'none';
  }
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
    title.className = 'session-item__title';
    title.textContent = s.title;

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'session-item__delete';
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

if (newChatBtn) {
  newChatBtn.addEventListener('click', () => {
    if (chatConfig.hideHistory) {
      confirmAndReplaceChat();
    } else {
      startNewChat();
    }
  });
}

function applyInitialPrompt() {
  if (chatConfig.initialPrompt) {
    promptInput.value = chatConfig.initialPrompt;
    promptInput.dispatchEvent(new Event('input'));
  }
}

function confirmAndReplaceChat() {
  const hasMessages = restoredMessages.length > 0 ||
    (chatHistory && chatHistory.querySelector('.messages')?.childElementCount > 0);

  if (!hasMessages) {
    replaceCurrentChat();
    return;
  }

  const content = document.createElement('div');
  content.innerHTML = `<p class="body-medium">Starting a new chat will <strong>permanently delete</strong> your current conversation. This cannot be undone.</p>`;

  const confirmModal = new Modal({
    size: 'small',
    title: 'Start new chat?',
    content,
    closeOnOverlayClick: true,
    closeOnEscape: true,
    footerButtons: [
      { label: 'Cancel', type: 'secondary', onClick: () => confirmModal.close() },
      { label: 'Delete & Start New', type: 'primary', onClick: async () => {
        confirmModal.close();
        await replaceCurrentChat();
      }},
    ],
  });
  confirmModal.open();
}

async function replaceCurrentChat() {
  if (sessionId) {
    await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
    allSessionsMeta = allSessionsMeta.filter((s) => s.session_id !== sessionId);
  }
  await startNewChat();
}

async function startNewChat() {
  cancelPendingSave();
  const res = await fetch('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: selectedModel, temperature: selectedTemperature, thinking: selectedThinking }),
  });
  if (!res.ok) return;
  const data = await res.json();

  sessionId = data.sessionId;
  restoredMessages = [];
  lastStatus = null;
  clearAttachment();
  applyInitialPrompt();

  if (chatConfig.hideHistory) {
    allSessionsMeta = [{ session_id: sessionId, title: 'New conversation', updated_at: new Date().toISOString() }];
  } else {
    allSessionsMeta.unshift({ session_id: sessionId, title: 'New conversation', updated_at: new Date().toISOString() });
  }

  buildChat(sessionId);
  renderMessages([], 'idle');
  renderSidebar();
}

// ── Regenerate / Edit ─────────────────────────────────────────

// Serialise live OctavusChat messages into the on-disk storage shape.
// OctavusChat only holds messages produced in the current page session,
// so this never includes the pre-load `restoredMessages` history.
function serializeLiveMessages(liveMessages) {
  return liveMessages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role,
      content: m.parts.filter((p) => p.type === 'text').map((p) => p.text).join(''),
      files: m.parts
        .filter((p) => p.type === 'file')
        .map((p) => ({ filename: p.filename, mediaType: p.mediaType, url: p.url })),
      timestamp: new Date().toISOString(),
    }));
}

// The full conversation in storage shape: pre-load history followed by
// the live turns. This is the single source of truth used for rendering
// indices, regenerate/edit targeting, and persistence — keep it in sync
// with how renderMessages() composes the displayed list.
function getAllCurrentMessages() {
  return [...restoredMessages, ...serializeLiveMessages(chat?.messages ?? [])];
}

async function forkSession(messages) {
  const res = await fetch('/api/session/fork', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      oldSessionId: sessionId,
      messages,
      model: selectedModel,
      temperature: selectedTemperature,
      thinking: selectedThinking,
    }),
  });
  if (!res.ok) throw new Error('Fork failed');
  return res.json();
}

async function resendOnForkedSession(historyMessages, userText, userFiles) {
  const data = await forkSession(historyMessages);

  const oldSessionId = sessionId;
  sessionId = data.sessionId;
  restoredMessages = historyMessages;
  lastStatus = null;

  const metaIdx = allSessionsMeta.findIndex((s) => s.session_id === oldSessionId);
  if (metaIdx >= 0) {
    allSessionsMeta[metaIdx].session_id = sessionId;
  } else {
    allSessionsMeta.unshift({
      session_id: sessionId,
      title: deriveTitle(historyMessages) || 'New conversation',
      updated_at: new Date().toISOString(),
    });
  }
  renderSidebar();

  buildChat(sessionId);
  renderMessages([], 'idle');

  const filesToSend = userFiles?.length > 0 ? userFiles : undefined;
  await chat.send(
    'user-message',
    { USER_MESSAGE: userText, ...(filesToSend ? { FILES: filesToSend } : {}) },
    { userMessage: { content: userText, ...(filesToSend ? { files: filesToSend } : {}) } },
  );
}

// Icons for the message hover actions (inline SVG, inherit currentColor).
const REGEN_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
</svg>`;
const COPY_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M16 16v2.8c0 1.12 0 1.68-.218 2.108a2 2 0 0 1-.874.874C14.48 22 13.92 22 12.8 22H5.2c-1.12 0-1.68 0-2.108-.218a2 2 0 0 1-.874-.874C2 20.48 2 19.92 2 18.8v-7.6c0-1.12 0-1.68.218-2.108a2 2 0 0 1 .874-.874C3.52 8 4.08 8 5.2 8H8m3.2 8h7.6c1.12 0 1.68 0 2.108-.218a2 2 0 0 0 .874-.874C22 14.48 22 13.92 22 12.8V5.2c0-1.12 0-1.68-.218-2.108a2 2 0 0 0-.874-.874C20.48 2 19.92 2 18.8 2h-7.6c-1.12 0-1.68 0-2.108.218a2 2 0 0 0-.874.874C8 3.52 8 4.08 8 5.2v7.6c0 1.12 0 1.68.218 2.108a2 2 0 0 0 .874.874C9.52 16 10.08 16 11.2 16Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
const CHECK_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M20 6 9 17l-5-5"/>
</svg>`;

// Copy the message's markdown source to the clipboard, with a brief
// checkmark confirmation on the button.
async function copyMessageMarkdown(btn, markdown) {
  try {
    await navigator.clipboard.writeText(markdown);
  } catch (err) {
    console.error('[ChatCPT] Copy failed:', err);
    return;
  }
  const original = btn.innerHTML;
  btn.innerHTML = CHECK_ICON_SVG;
  btn.title = 'Copied';
  setTimeout(() => {
    btn.innerHTML = original;
    btn.title = 'Copy';
  }, 1500);
}

// Regenerate a specific assistant response: re-run the user turn that
// preceded it (forking the session, which drops everything after).
async function regenerateResponse(assistantIdx) {
  const allMsgs = getAllCurrentMessages();
  if (assistantIdx < 0 || assistantIdx >= allMsgs.length) return;
  if (allMsgs[assistantIdx].role !== 'assistant') return;

  let userIdx = -1;
  for (let i = assistantIdx - 1; i >= 0; i--) {
    if (allMsgs[i].role === 'user') { userIdx = i; break; }
  }
  if (userIdx < 0) return;

  const userMsg = allMsgs[userIdx];
  const historyBeforeUser = allMsgs.slice(0, userIdx);

  try {
    await resendOnForkedSession(historyBeforeUser, userMsg.content, userMsg.files);
  } catch (err) {
    console.error('[ChatCPT] Regenerate error:', err);
  }
}

async function editAndResend(messageIndex, newText) {
  const allMsgs = getAllCurrentMessages();
  const historyBeforeEdit = allMsgs.slice(0, messageIndex);

  try {
    await resendOnForkedSession(historyBeforeEdit, newText);
  } catch (err) {
    console.error('[ChatCPT] Edit & resend error:', err);
  }
}

function startEditingMessage(row, msgIndex, originalText) {
  const content = row.querySelector('.message__user-content');
  const bubble = row.querySelector('.message__bubble');
  const actionsRow = content?.querySelector('.message__actions--user');
  if (!content || !bubble) return;

  // Editor box matches the bubble; the textarea and the action buttons
  // both live inside it.
  const box = document.createElement('div');
  box.className = 'message__edit-box';

  const textarea = document.createElement('textarea');
  textarea.className = 'message__edit-textarea body-medium';
  textarea.value = originalText;

  const actions = document.createElement('div');
  actions.className = 'message__edit-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'button button-tertiary button-xsmall';
  cancelBtn.textContent = 'Cancel';

  const submitBtn = document.createElement('button');
  submitBtn.type = 'button';
  submitBtn.className = 'button button-primary button-xsmall';
  submitBtn.textContent = 'Save';

  actions.append(cancelBtn, submitBtn);
  box.append(textarea, actions);

  // ── Enter edit mode ─────────────────────────────────────────
  // Measure the bubble first so the box can grow from that height
  // rather than popping to its full size.
  const startHeight = bubble.offsetHeight;
  content.classList.add('is-editing');
  bubble.hidden = true;
  if (actionsRow) actionsRow.hidden = true;
  content.insertBefore(box, actionsRow ?? null);

  const autosize = () => {
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  };
  textarea.addEventListener('input', autosize);

  // Animate the box open from the bubble's height; drop the height
  // transition afterwards so typing doesn't lag behind an animation.
  box.style.height = `${startHeight}px`;
  requestAnimationFrame(() => {
    autosize();
    box.classList.add('is-animating', 'is-visible');
    box.style.height = `${box.scrollHeight}px`;
    setTimeout(() => {
      box.classList.remove('is-animating');
      box.style.height = 'auto';
    }, 220);
  });

  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);

  function exitEditMode() {
    content.classList.remove('is-editing');
    box.remove();
    if (actionsRow) actionsRow.hidden = false;
    bubble.hidden = false;
  }

  cancelBtn.addEventListener('click', exitEditMode);

  submitBtn.addEventListener('click', async () => {
    const newText = textarea.value.trim();
    if (!newText) return;
    submitBtn.disabled = true;
    cancelBtn.disabled = true;
    await editAndResend(msgIndex, newText);
  });
}

function deriveTitle(messages) {
  const first = messages.find((m) => m.role === 'user');
  if (!first?.content) return '';
  return first.content.length > 45 ? first.content.slice(0, 45) + '…' : first.content;
}

// ── Session persistence ───────────────────────────────────────

// Convert a stored plain-object message back into the shape renderMessages expects
// (mirrors the OctavusChat message structure just enough for rendering).
function storedToDisplayMsg(m) {
  return {
    role: m.role,
    status: 'done',
    stopped: m.stopped || false,
    parts: [
      ...(m.content ? [{ type: 'text', text: m.content }] : []),
      ...(m.files ?? []).map((f) => ({ type: 'file', ...f })),
    ],
  };
}

// ── Throttled persistence ─────────────────────────────────────
// While a response streams we persist partial state at most once per
// SAVE_THROTTLE_MS via throttledSave(). flushSave() bypasses the throttle
// for guaranteed writes — the initial user-message save on turn start and
// the final complete-message save on completion — so no data is lost.
const SAVE_THROTTLE_MS = 1000;
let saveThrottleTimer = null;
let lastSaveTime = 0;

function throttledSave() {
  const elapsed = Date.now() - lastSaveTime;
  if (elapsed >= SAVE_THROTTLE_MS) {
    flushSave();
  } else if (!saveThrottleTimer) {
    // Trailing-edge save covering the remainder of the current window.
    saveThrottleTimer = setTimeout(flushSave, SAVE_THROTTLE_MS - elapsed);
  }
}

function flushSave() {
  if (saveThrottleTimer) { clearTimeout(saveThrottleTimer); saveThrottleTimer = null; }
  lastSaveTime = Date.now();
  saveSession();
}

// Cancel any pending trailing-edge save so it can't fire against a
// different session after a switch / new chat / stop. Resetting
// lastSaveTime lets the next turn's first save run immediately.
function cancelPendingSave() {
  if (saveThrottleTimer) { clearTimeout(saveThrottleTimer); saveThrottleTimer = null; }
  lastSaveTime = 0;
}

// Persist the full conversation (pre-load history + live turns) to disk.
// Combining both is essential for resumed sessions, where chat.messages
// only contains turns from the current page session — saving live-only
// would otherwise drop the earlier history.
function saveSession() {
  const allMessages = getAllCurrentMessages();

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
