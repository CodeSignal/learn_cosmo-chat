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
    if (!chatConfig.hideSettings && settingsBtn) settingsBtn.style.display = '';
    if (chatConfig.heading) {
      const headingEl = document.querySelector('.empty-state__heading');
      if (headingEl) headingEl.textContent = chatConfig.heading;
    }
    if (chatConfig.footer) {
      const footerEl = document.querySelector('.composer__hint');
      if (footerEl) footerEl.textContent = chatConfig.footer;
    }
    if (chatConfig.title) {
      document.title = chatConfig.title;
      const titleEl = document.querySelector('.sidebar__title');
      if (titleEl) titleEl.textContent = chatConfig.title;
    }
    if (chatConfig.placeholder) {
      promptInput.placeholder = chatConfig.placeholder;
    }
    if (!chatConfig.hideFileUpload) {
      const attachIcons = document.getElementById('attachIcons');
      if (attachIcons) attachIcons.style.display = '';
    }
    if (chatConfig.hideHistory) {
      if (sidebarSpacer) sidebarSpacer.style.display = '';
    } else {
      if (historyHeading) historyHeading.style.display = '';
      if (sessionList) sessionList.style.display = '';
    }

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

      row.className = streaming ? 'message message--ai message--ai--streaming' : 'message message--ai';
      row.innerHTML = `
        <div class="message__body body-medium markdown">
          ${bodyContent}
        </div>
        <div class="message__ai-trailing">
          ${avatarOpen}
            <span class="cosmo-avatar small" role="img" aria-label="Cosmo"></span>
          ${avatarClose}
          ${statusHtml}
        </div>
      `;

      if (msg.stopped) {
        const stoppedEl = document.createElement('div');
        stoppedEl.className = 'message__stopped body-xsmall';
        stoppedEl.textContent = 'Response stopped';
        row.querySelector('.message__body').appendChild(stoppedEl);
      }

      if (!chatConfig.hidePromptControls && isIdle && i === lastAssistantIdx && (hasText || msg.stopped)) {
        const actionsEl = document.createElement('div');
        actionsEl.className = 'message__actions';
        const regenBtn = document.createElement('button');
        regenBtn.type = 'button';
        regenBtn.className = 'message__action-btn';
        regenBtn.setAttribute('aria-label', 'Regenerate response');
        regenBtn.title = 'Regenerate';
        regenBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
        </svg>`;
        regenBtn.addEventListener('click', regenerateLastResponse);
        actionsEl.appendChild(regenBtn);
        row.appendChild(actionsEl);
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
        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'message__action-btn message__edit-btn';
        editBtn.setAttribute('aria-label', 'Edit message');
        editBtn.title = 'Edit';
        editBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
        </svg>`;
        const capturedIdx = userAssistantIdx;
        const capturedText = text;
        editBtn.addEventListener('click', () => startEditingMessage(row, capturedIdx, capturedText));
        row.querySelector('.message__user-content').appendChild(editBtn);
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

fileInput.addEventListener('change', async () => {
  const files = Array.from(fileInput.files);
  if (!files.length || !chat) return;

  // Reset so re-selecting the same file(s) fires 'change' again
  fileInput.value = '';

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
  if (partialMessages.length > 0) {
    restoredMessages = partialMessages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role,
        content: m.parts.filter((p) => p.type === 'text').map((p) => p.text).join(''),
        files: m.parts
          .filter((p) => p.type === 'file')
          .map((p) => ({ filename: p.filename, mediaType: p.mediaType, url: p.url })),
        timestamp: new Date().toISOString(),
      }));

    for (let i = restoredMessages.length - 1; i >= 0; i--) {
      if (restoredMessages[i].role === 'assistant') {
        restoredMessages[i].stopped = true;
        break;
      }
    }

    saveSession(partialMessages);
  }

  lastStatus = null;
  buildChat(sessionId);
  renderMessages([], 'idle');
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

function getAllCurrentMessages() {
  if (chat?.messages?.length > 0) {
    return chat.messages
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
  return [...restoredMessages];
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

async function regenerateLastResponse() {
  const allMsgs = getAllCurrentMessages();

  let lastAssistantIdx = -1;
  for (let i = allMsgs.length - 1; i >= 0; i--) {
    if (allMsgs[i].role === 'assistant') { lastAssistantIdx = i; break; }
  }
  if (lastAssistantIdx < 0) return;

  const beforeAssistant = allMsgs.slice(0, lastAssistantIdx);

  let lastUserIdx = -1;
  for (let i = beforeAssistant.length - 1; i >= 0; i--) {
    if (beforeAssistant[i].role === 'user') { lastUserIdx = i; break; }
  }
  if (lastUserIdx < 0) return;

  const lastUserMsg = beforeAssistant[lastUserIdx];
  const historyBeforeUser = beforeAssistant.slice(0, lastUserIdx);

  try {
    await resendOnForkedSession(
      historyBeforeUser,
      lastUserMsg.content,
      lastUserMsg.files,
    );
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
  const bubble = row.querySelector('.message__bubble');
  if (!bubble) return;

  const editor = document.createElement('div');
  editor.className = 'message__edit-form';

  const textarea = document.createElement('textarea');
  textarea.className = 'input message__edit-textarea';
  textarea.value = originalText;
  textarea.rows = Math.max(2, originalText.split('\n').length);

  const actions = document.createElement('div');
  actions.className = 'message__edit-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn btn--secondary message__edit-cancel';
  cancelBtn.textContent = 'Cancel';

  const submitBtn = document.createElement('button');
  submitBtn.type = 'button';
  submitBtn.className = 'btn btn--primary message__edit-submit';
  submitBtn.textContent = 'Save & Submit';

  actions.appendChild(cancelBtn);
  actions.appendChild(submitBtn);
  editor.appendChild(textarea);
  editor.appendChild(actions);

  bubble.replaceWith(editor);
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);

  cancelBtn.addEventListener('click', () => {
    renderMessages(chat?.messages ?? [], chat?.status ?? 'idle');
  });

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

  // Octavus returns the full session history in chat.messages, so liveSerialized
  // already contains every message. Only fall back to restoredMessages if no
  // live messages exist yet (e.g. the session was just loaded but nothing sent).
  const allMessages = liveSerialized.length > 0 ? liveSerialized : restoredMessages;

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
