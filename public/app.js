/**
 * ChatCPT – app.js
 * Connects to the backend via @octavus/client-sdk (HTTP/SSE transport).
 */

import { OctavusChat, createHttpTransport } from '@octavus/client-sdk';
import {
  MAX_CONCURRENT_STREAMS,
  streamingCount as countStreaming,
  canSendMessage,
  nextSaveAction,
} from '../lib/stream-registry.js';
import { resolveAssistantContent, segmentAssistantParts } from '../lib/thinking.js';
import { supportsThinking } from '../lib/model-capabilities.js';
import Dropdown from '../design-system/components/dropdown/dropdown.js';
import PortalDropdown from './portal-dropdown.js';
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

const COPY_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M16 16v2.8c0 1.12 0 1.68-.218 2.108a2 2 0 0 1-.874.874C14.48 22 13.92 22 12.8 22H5.2c-1.12 0-1.68 0-2.108-.218a2 2 0 0 1-.874-.874C2 20.48 2 19.92 2 18.8v-7.6c0-1.12 0-1.68.218-2.108a2 2 0 0 1 .874-.874C3.52 8 4.08 8 5.2 8H8m3.2 8h7.6c1.12 0 1.68 0 2.108-.218a2 2 0 0 0 .874-.874C22 14.48 22 13.92 22 12.8V5.2c0-1.12 0-1.68-.218-2.108a2 2 0 0 0-.874-.874C20.48 2 19.92 2 18.8 2h-7.6c-1.12 0-1.68 0-2.108.218a2 2 0 0 0-.874.874C8 3.52 8 4.08 8 5.2v7.6c0 1.12 0 1.68.218 2.108a2 2 0 0 0 .874.874C9.52 16 10.08 16 11.2 16Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
const CHECK_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M20 6 9 17l-5-5"/>
</svg>`;

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
        <button type="button" class="button-icon code-block__copy" aria-label="${t('Copy code')}" title="${t('Copy')}">
          ${COPY_ICON_SVG}
        </button>
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

// Nest markdown headings under the per-turn h2 ("Cosmo's reply" / "Your message").
// Models usually start sections at ## (not #); shift by +1 and never emit h1/h2
// so content can't compete with the turn chrome: #/## → h3, ### → h4, … ≤ h6.
// Visual size is kept via message__heading--N (original markdown depth).
renderer.heading = function ({ tokens, depth }) {
  const level = Math.min(6, Math.max(3, depth + 1));
  const body = this.parser.parseInline(tokens);
  return `<h${level} class="message__heading message__heading--${depth}">${body}</h${level}>\n`;
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
// ── Session registry ──────────────────────────────────────────
// Each chat session gets its own Runtime so several can stream at once.
// Only `active` is rendered, but every runtime persists itself independently
// so a backgrounded stream never loses its tail when you switch away.
// Runtime = { sessionId, chat, unsubscribe, abortController,
//             restoredMessages, lastStatus, lastSaveTime,
//             saveThrottleTimer, streamingStartTime }
const sessions = new Map();
let active = null; // the displayed Runtime
// Id of the most recent switchSession() request; used to ignore the result of
// an earlier in-flight session fetch that resolves after a newer switch.
let lastSwitchRequestId = null;
// Count live streams across all sessions (pure logic lives in lib/stream-registry).
const streamingCount = () => countStreaming(sessions.values());

// Each entry: { file: File, ref: FileRef|null, status: 'uploading'|'ready'|'error' }
let fileItems = [];
let isUploading = false;
let allSessionsMeta = []; // [{session_id, title, updated_at}]
let loadingIntervalId = null;
let chatConfig = {};
let availableModels = [];
/** @type {Record<string, { supportsThinking?: boolean }>} */
let modelCapabilities = {};

/**
 * Translate a user-facing UI string via the `strings` map in chat-config.json.
 * The map is keyed by the original English text; when no (non-empty) override is
 * provided for a key, the original text is used unchanged. Any `{name}` tokens
 * in the resolved string are replaced with the matching value from `vars`.
 * @param {string} key - The original English string (with optional {tokens}).
 * @param {Record<string, string|number>} [vars] - Values for {token} substitution.
 * @returns {string} The configured translation (or `key`) with tokens filled in.
 */
function t(key, vars) {
  const map = chatConfig.strings;
  let str = key;
  if (map && Object.prototype.hasOwnProperty.call(map, key)) {
    const value = map[key];
    if (typeof value === 'string' && value.length > 0) str = value;
  }
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      str = str.split(`{${name}}`).join(String(value));
    }
  }
  return str;
}
let selectedModel = '';
let selectedTemperature = 0.7;
let selectedThinking = 'off';
let selectedCustomInstructions = '';
let settingsModal = null;

// The CUSTOM_INSTRUCTIONS value sent with each user turn. Only honored when the
// practice opts in via `allowCustomInstructions`; otherwise the agent receives
// a sentinel telling it there are none.
function customInstructionsValue() {
  return (
    (chatConfig.allowCustomInstructions && selectedCustomInstructions?.trim()) ||
    'NO CUSTOM INSTRUCTIONS'
  );
}

let thinkingDropdownInstance = null;
let temperatureSliderInstance = null;

// ── Session wiring ────────────────────────────────────────────
// Return the runtime for `sid`, creating (and wiring up) one if needed.
// Reusing an existing runtime is what lets a live stream survive a
// switch-away-and-back without being torn down.
function getOrCreateRuntime(sid, restored = []) {
  let rt = sessions.get(sid);
  if (rt) return rt;
  rt = {
    sessionId: sid,
    chat: null,
    unsubscribe: null,
    abortController: null,
    restoredMessages: restored,
    lastStatus: null,
    lastSaveTime: 0,
    saveThrottleTimer: null,
    streamingStartTime: null,
  };
  attachChat(rt);
  sessions.set(sid, rt);
  return rt;
}

// (Re)build the OctavusChat for a runtime and wire its subscription. Used on
// creation and by stopGeneration() to clear live messages.
function attachChat(rt) {
  if (rt.unsubscribe) { rt.unsubscribe(); rt.unsubscribe = null; }

  const transport = createHttpTransport({
    request: (payload, options) => {
      rt.abortController = new AbortController();
      return fetch('/api/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: rt.sessionId, ...payload }),
        signal: rt.abortController.signal,
      });
    },
  });

  const requestUploadUrls = async (files) => {
    const r = await fetch('/api/upload-urls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: rt.sessionId, files }),
    });
    return r.json();
  };

  rt.chat = new OctavusChat({ transport, requestUploadUrls });
  rt.unsubscribe = rt.chat.subscribe(() => {
    const status = rt.chat.status;
    const prevStatus = rt.lastStatus;

    // Track when streaming starts so the elapsed-time indicator is accurate.
    if (status === 'streaming' && prevStatus !== 'streaming') {
      rt.streamingStartTime = Date.now();
    } else if (status !== 'streaming') {
      rt.streamingStartTime = null;
    }

    // Short status announcements for AT (A1/A11). Never the transcript itself.
    if (rt === active && status !== prevStatus) {
      if (status === 'streaming') {
        announceChatStatus(t('Cosmo is responding'));
      } else if (prevStatus === 'streaming') {
        if (rt.stopAnnouncementPending) {
          rt.stopAnnouncementPending = false;
        } else {
          announceChatStatus(t('Response complete'));
        }
      }
    }

    // Persistence runs for EVERY runtime, even when it isn't on screen, so a
    // backgrounded stream keeps saving its tail. Policy:
    //  • Entering streaming → immediate save (durable user message).
    //  • Mid-stream → throttled partial saves.
    //  • Leaving streaming → final flush so nothing is lost to throttling.
    persist(rt);

    // Only the displayed runtime renders / drives the re-render loop.
    if (rt === active) {
      renderActive();
      syncStreamingLoop();
    }

    // The send/stop gate depends on the global streaming count, so any
    // runtime's status change can flip it.
    updateSendBtn();

    // Reflect the streaming indicator (dot + ARIA) in the sidebar immediately
    // on each status transition, independent of the save callbacks (which may
    // be throttled, delayed, or fail). Only on transitions — not every token —
    // so a full sidebar re-render here stays cheap.
    if (status !== prevStatus) renderSidebar();

    rt.lastStatus = status;
  });
}

// Render the currently displayed runtime (idle-safe).
function renderActive() {
  if (!active?.chat) { renderMessages([], 'idle'); return; }
  renderMessages(active.chat.messages, active.chat.status);
}

// One re-render loop, pointed at the active runtime, so streaming text keeps
// updating even when no new tokens arrive (e.g. image generation).
function syncStreamingLoop() {
  const streaming = active?.chat?.status === 'streaming';
  if (streaming && !loadingIntervalId) {
    loadingIntervalId = setInterval(() => {
      if (active?.chat?.status === 'streaming') renderActive();
      else { clearInterval(loadingIntervalId); loadingIntervalId = null; }
    }, 1000);
  } else if (!streaming && loadingIntervalId) {
    clearInterval(loadingIntervalId);
    loadingIntervalId = null;
  }
}

// Abort, unsubscribe, and forget a runtime (on delete / fork replacement).
function teardownRuntime(sid) {
  const rt = sessions.get(sid);
  if (!rt) return;
  if (rt.abortController) { rt.abortController.abort(); rt.abortController = null; }
  clearSaveTimer(rt);
  if (rt.unsubscribe) { rt.unsubscribe(); rt.unsubscribe = null; }
  sessions.delete(sid);
  if (active === rt) active = null;
}

// Switch to an existing session (by id). Reuses a live runtime if one exists
// (preserving its in-flight stream); otherwise loads it from disk.
async function switchSession(sid) {
  clearAttachment();
  promptInput.value = '';
  lastSwitchRequestId = sid;

  let rt = sessions.get(sid);
  if (!rt) {
    const res = await fetch(`/api/session?id=${sid}`);
    if (!res.ok) return;
    const data = await res.json();
    rt = getOrCreateRuntime(data.sessionId, data.messages ?? []);
    // The fetch may resolve out of order; if the user switched again while it
    // was in flight, drop this stale result so the newest switch wins.
    if (lastSwitchRequestId !== sid) return;
  }
  active = rt;
  renderActive();
  renderSidebar();
  updateSendBtn();
  syncStreamingLoop();
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
      syncThinkingForSelectedModel();
      startNewChat();
    },
  });
}

/** Prefer server `/api/models` capabilities; fall back to local heuristics. */
function modelSupportsThinking(modelId = selectedModel) {
  return supportsThinking(modelId, chatConfig, modelCapabilities);
}

/** Force Thinking to Off when the current model does not support it. */
function syncThinkingForSelectedModel() {
  if (!modelSupportsThinking(selectedModel)) {
    selectedThinking = 'off';
  }
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

  // Static labels: a dedicated config key (heading/footer/title/...) wins when
  // set; otherwise fall back to the `strings` map keyed by the English default.
  const headingEl = document.querySelector('.empty-state__heading');
  if (headingEl) headingEl.textContent = chatConfig.heading ?? t("What's on your mind?");

  const footerEl = document.querySelector('.composer__hint');
  if (footerEl) footerEl.textContent = chatConfig.footer ?? t('Cosmo can make mistakes. Practice refining your prompts.');

  {
    const titleText = chatConfig.title ?? t('ChatCPT');
    document.title = titleText;
    const titleEl = document.querySelector('.sidebar__title');
    if (titleEl) titleEl.textContent = titleText;
  }

  if (promptInput) promptInput.placeholder = chatConfig.placeholder ?? t('Ask me anything...');

  if (newChatBtn) {
    const newChatLabelEl = newChatBtn.querySelector('.sidebar__nav-label');
    if (newChatLabelEl) newChatLabelEl.textContent = chatConfig.newChatLabel ?? t('New chat');
  }

  if (settingsBtn) {
    const settingsLabelEl = settingsBtn.querySelector('.sidebar__nav-label');
    if (settingsLabelEl) settingsLabelEl.textContent = t('Settings');
  }

  if (historyHeading) historyHeading.textContent = t('History');

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

// Writes the custom instructions back to chat-config.json so they're restored
// on the next page load. Updates the in-memory config to stay in sync.
async function persistCustomInstructions(value) {
  selectedCustomInstructions = value;
  chatConfig.customInstructions = value;
  try {
    await fetch('/api/config/custom-instructions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customInstructions: value }),
    });
  } catch (err) {
    console.error('[ChatCPT] Failed to persist custom instructions:', err);
  }
}

function openSettings() {
  if (!settingsModal) {
    const content = document.createElement('div');
    content.className = 'settings-content';
    // Opt-in: the Custom Instructions field only appears when a practice
    // explicitly enables it via `allowCustomInstructions: true`. Hidden
    // everywhere else so unrelated practices can't change the system prompt.
    const customInstructionsSection = chatConfig.allowCustomInstructions ? `
      <section class="settings-section">
        <h3 class="label-small settings-section__title">${t('Response preferences')}</h3>

        <div class="settings-row">
          <label class="body-small settings-row__label" for="customInstructionsEl">${t('System Prompt')}</label>
          <p class="body-xsmall settings-row__desc">${t("Shape Cosmo's tone, style, persona, or expertise. Sent with each message and applied to your next reply. Cosmo's core guidelines and safety guardrails always take precedence.")}</p>
          <textarea id="customInstructionsEl" class="settings-textarea body-small" rows="5" placeholder="${t('e.g. You are an expert in Data Science with an IQ of 159. Maintain a positive, helpful style.')}"></textarea>
        </div>
      </section>
    ` : '';
    // The Generation section (Temperature + Thinking) can be hidden entirely
    // via `hideModelSettings: true` for practices that shouldn't expose
    // model-tuning controls.
    const modelSettingsSection = chatConfig.hideModelSettings ? '' : `
      <section class="settings-section">
        <h3 class="label-small settings-section__title">${t('Generation')}</h3>

        <div class="settings-row" id="temperatureRow">
          <div class="settings-row__label-line">
            <label class="body-small settings-row__label">${t('Temperature')}</label>
            <span class="body-small settings-row__value" id="temperatureValue"></span>
          </div>
          <p class="body-xsmall settings-row__desc">${t('Controls randomness (0–2). Lower = more focused, higher = more creative. Disabled when Thinking is on.')}</p>
          <div class="settings-slider-container" id="temperatureSliderEl"></div>
        </div>

        <div class="settings-row" id="thinkingRow">
          <label class="body-small settings-row__label">${t('Thinking')}</label>
          <p class="body-xsmall settings-row__desc">${t('Extended reasoning depth. When enabled, temperature is ignored by the model.')}</p>
          <div class="settings-dropdown-container" id="thinkingDropdownEl"></div>
          <p class="body-xsmall settings-row__note" id="thinkingUnsupportedNote" hidden></p>
        </div>
      </section>
    `;
    content.innerHTML = `
      ${modelSettingsSection}
      ${customInstructionsSection}
    `;

    settingsModal = new Modal({
      size: 'medium',
      title: t('Settings'),
      content,
      closeOnOverlayClick: true,
      closeOnEscape: true,
      // The Thinking menu renders in <body>, so it outlives the modal unless
      // it is closed here.
      onClose: () => { thinkingDropdownInstance?.close(); },
      onOpen: () => {
        const sliderEl    = settingsModal.content.querySelector('#temperatureSliderEl');
        const dropdownEl  = settingsModal.content.querySelector('#thinkingDropdownEl');
        const tempRow     = settingsModal.content.querySelector('#temperatureRow');

        // Generation controls only exist when `hideModelSettings` is falsy.
        if (sliderEl && dropdownEl && tempRow) {
          const thinkingRow = settingsModal.content.querySelector('#thinkingRow');
          const thinkingNote = settingsModal.content.querySelector('#thinkingUnsupportedNote');
          const canThink = modelSupportsThinking(selectedModel);
          if (!canThink) selectedThinking = 'off';

          // Thinking dropdown
          if (thinkingDropdownInstance) thinkingDropdownInstance.destroy();
          // PortalDropdown, not Dropdown: the modal body scrolls and would clip
          // the menu.
          thinkingDropdownInstance = new PortalDropdown(dropdownEl, {
            items: THINKING_OPTIONS.map((o) => ({ ...o, label: t(o.label) })),
            selectedValue: selectedThinking,
            width: '100%',
            matchToggleWidth: true,
            menuClassName: 'settings-thinking-menu',
            onSelect: (value) => {
              const canThinkNow = modelSupportsThinking(selectedModel);
              if (!canThinkNow && value !== 'off') {
                if (thinkingNote) {
                  thinkingNote.hidden = false;
                  thinkingNote.textContent = t(
                    "This model does not support Thinking. Switch to a model that does, then update Thinking.",
                  );
                }
                // Snap back to Off without leaving a non-supported level selected.
                if (thinkingDropdownInstance.getValue() !== 'off') {
                  thinkingDropdownInstance.setValue('off');
                }
                selectedThinking = 'off';
                tempRow.classList.remove('settings-row--disabled');
                return;
              }
              selectedThinking = value;
              if (thinkingNote) {
                if (canThinkNow) {
                  thinkingNote.hidden = true;
                  thinkingNote.textContent = '';
                } else {
                  thinkingNote.hidden = false;
                  thinkingNote.textContent = t(
                    "This model does not support Thinking. Switch to a model that does, then update Thinking.",
                  );
                }
              }
              // Dim temperature row when thinking is active
              tempRow.classList.toggle('settings-row--disabled', value !== 'off');
            },
          });

          if (thinkingNote) {
            if (canThink) {
              thinkingNote.hidden = true;
              thinkingNote.textContent = '';
            } else {
              thinkingNote.hidden = false;
              thinkingNote.textContent = t(
                "This model does not support Thinking. Switch to a model that does, then update Thinking.",
              );
            }
          }
          thinkingRow?.classList.toggle('settings-row--thinking-locked', !canThink);

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
        }

        // Custom instructions textarea
        const customInstructionsEl = settingsModal.content.querySelector('#customInstructionsEl');
        if (customInstructionsEl) {
          customInstructionsEl.value = selectedCustomInstructions;
          customInstructionsEl.oninput = (e) => { selectedCustomInstructions = e.target.value; };
          // Persist on blur so the value survives a reload without spamming
          // the server on every keystroke.
          customInstructionsEl.onchange = (e) => { persistCustomInstructions(e.target.value); };
        }
      },
      footerButtons: [
        { label: t('Close'), type: 'secondary', onClick: () => settingsModal.close() },
        { label: t('Apply & New Chat'), type: 'primary', onClick: () => { settingsModal.close(); startNewChat(); } },
      ],
    });
  }
  settingsModal.open();
}

if (settingsBtn) settingsBtn.addEventListener('click', openSettings);

/**
 * Delegated click handler for `.code-block__copy` buttons in rendered markdown.
 * @param {MouseEvent} e
 */
function handleCodeBlockCopyClick(e) {
  const btn = e.target.closest('.code-block__copy');
  if (!btn) return;
  const codeEl = btn.closest('.code-block')?.querySelector('.code-block__pre code');
  if (!codeEl) return;
  copyCodeBlock(btn, codeEl.textContent);
}

if (chatHistory) {
  chatHistory.addEventListener('click', handleCodeBlockCopyClick);
}

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
          t('Chat cannot start: the server is missing Octavus configuration. Create a .env in the project root with OCTAVUS_API_URL, OCTAVUS_API_KEY, and OCTAVUS_AGENT_ID, then stop the dev server completely and run npm run dev again (environment variables load only at startup).'),
        );
      } else {
        const raw = await sessionRes.text();
        showBootError(`Could not start session (HTTP ${sessionRes.status}). ${raw || ''}`.trim());
      }
      throw new Error('session init failed');
    }

    const data = await sessionRes.json();
    active = getOrCreateRuntime(data.sessionId, data.messages ?? []);

    const [listRes, configRes, modelsRes] = await Promise.all([
      fetch('/api/sessions'),
      fetch('/api/config'),
      fetch('/api/models'),
    ]);

    const listData = await listRes.json();
    allSessionsMeta = listData.sessions ?? [];
    if (!allSessionsMeta.some((s) => s.session_id === active.sessionId)) {
      allSessionsMeta.unshift({
        session_id: active.sessionId,
        title: t('New conversation'),
        updated_at: new Date().toISOString(),
      });
    }

    chatConfig = configRes.ok ? await configRes.json() : {};
    applyInitialPrompt();
    if (chatConfig.temperature !== undefined) selectedTemperature = chatConfig.temperature;
    if (chatConfig.thinking   !== undefined) selectedThinking    = chatConfig.thinking;
    if (chatConfig.customInstructions !== undefined) selectedCustomInstructions = chatConfig.customInstructions;
    applyChatConfigUI();

    const modelsData = modelsRes.ok ? await modelsRes.json() : { models: [] };
    availableModels = modelsData.models ?? [];
    modelCapabilities =
      modelsData.capabilities && typeof modelsData.capabilities === 'object'
        ? modelsData.capabilities
        : {};
    selectedModel = chatConfig.model || availableModels[0] || '';
    syncThinkingForSelectedModel();
    renderModelSelector();

    renderActive();
    renderSidebar();
    updateSendBtn();

    document.querySelector('.chat-app').style.visibility = '';
  } catch (err) {
    console.error('[ChatCPT] Failed to initialise session:', err);
    const el = document.getElementById('bootError');
    if (el && el.hidden) {
      showBootError(
        t('Could not start the app. Make sure npm run dev is running and check the browser console for details.'),
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
  const streamingStartTime = active?.streamingStartTime;
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

/** Escape text for safe insertion into HTML attribute/text contexts. */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Whether to surface model reasoning/thoughts in the UI.
 * Course authors can opt out with `showReasoning: false`. When thinking is off,
 * models typically won't emit reasoning — but historical thoughts still show if present.
 */
function shouldShowReasoning() {
  return chatConfig.showReasoning !== false;
}

/**
 * Single collapsible "Thoughts" section for the whole reply (ChatGPT / Claude /
 * Gemini style). Each discrete thought is its own DIV inside the body so
 * consecutive reasoning parts stay delineated without mid-sentence gluing.
 * Open while streaming so learners can watch; collapsed when done.
 *
 * @param {string[]} reasoningBlocks
 */
function renderThoughtsBlock(reasoningBlocks, { streaming = false } = {}) {
  const openAttr = streaming ? ' open' : '';
  const summaryLabel = streaming ? t('Thinking…') : t('Thoughts');
  const blocks = (Array.isArray(reasoningBlocks) ? reasoningBlocks : [reasoningBlocks])
    .filter((text) => (text ?? '').trim().length > 0 || streaming);
  const body = blocks
    .map((text) => {
      const html = escapeHtml(text ?? '').replace(/\n/g, '<br>');
      return `<div class="message__thoughts-block">${html}</div>`;
    })
    .join('');
  return `
    <details class="message__thoughts"${openAttr}>
      <summary class="message__thoughts-summary body-xsmall">
        <span class="message__thoughts-summary-label">${escapeHtml(summaryLabel)}</span>
      </summary>
      <div class="message__thoughts-body body-small">${body}</div>
    </details>
  `;
}

/**
 * Label shown next to the avatar while streaming (no three-dot animation).
 * @returns {{ label: string, icon: string | null, isImage: boolean }}
 */
function getStreamingStatus(parts = []) {
  const streamingStartTime = active?.streamingStartTime;
  const elapsed = streamingStartTime ? (Date.now() - streamingStartTime) / 1000 : 0;
  const toolName = activeToolNameFromParts(parts);

  if (toolName === 'octavus_generate_image') {
    const stage = IMAGE_STAGES.filter((s) => elapsed >= s.after).pop();
    const label = stage?.label ?? IMAGE_STAGES[0].label;
    return { label: t(label), icon: null, isImage: true };
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
  return { label: t(label), icon: null, isImage: false };
}

// ── Chat status live region (A1 / A11) ─────────────────────────
// One persistent role="status" outside the message list. Only short
// deliberate strings — never streaming transcript text.
function announceChatStatus(message) {
  const el = document.getElementById('chatStatus');
  if (!el) return;
  // Clear-then-set so repeated identical strings still announce.
  el.textContent = '';
  void el.offsetWidth;
  el.textContent = message;
}

// ── Render messages ───────────────────────────────────────────
// `liveMessages` comes from OctavusChat; `restoredMessages` are pre-loaded from disk.
// We display restored first, then live so the conversation reads continuously.
//
// Reconciliation (A1/A2): rows are keyed by index and reused when their
// signature is unchanged, so idle re-renders and status ticks do not wipe
// focus or re-announce the whole transcript through the DOM.
function renderMessages(liveMessages, status) {
  const wasPinnedToBottom = isChatNearBottom();
  const messages = [...(active?.restoredMessages ?? []).map(storedToDisplayMsg), ...liveMessages];

  let messagesEl = chatHistory.querySelector('.messages');
  if (!messagesEl) {
    messagesEl = document.createElement('div');
    messagesEl.className = 'messages';
    chatHistory.appendChild(messagesEl);
  }

  const sessionId = active?.sessionId ?? '';
  if (messagesEl.dataset.sessionId !== sessionId) {
    messagesEl.replaceChildren();
    messagesEl.dataset.sessionId = sessionId;
  }

  const isIdle = status !== 'streaming';
  const lastAssistantIdx = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return i;
    }
    return -1;
  })();

  /** @type {{ key: string, structureSig: string, contentSig: string, msg: object, idx: number, isLastAssistant: boolean }[]} */
  const planned = [];
  let userAssistantIdx = 0;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== 'user' && msg.role !== 'assistant') continue;

    const idx = userAssistantIdx;
    const isLastAssistant = i === lastAssistantIdx;
    const ctx = { isIdle, isLastAssistant, hidePromptControls: !!chatConfig.hidePromptControls };
    const { structureSig, contentSig } = messageRowSignatures(msg, ctx);
    planned.push({
      key: String(i),
      structureSig,
      contentSig,
      msg,
      idx,
      isLastAssistant,
    });
    userAssistantIdx++;
  }

  for (let i = 0; i < planned.length; i++) {
    const { key, structureSig, contentSig, msg, idx, isLastAssistant } = planned[i];
    const current = messagesEl.children[i];
    const ctx = { isIdle, isLastAssistant };

    // In-place edit UI is DOM-only state; never tear it down on a re-render.
    if (current?.querySelector?.('.message__edit-box')) continue;

    if (current
      && current.dataset.msgKey === key
      && current.dataset.structureSig === structureSig
      && current.dataset.contentSig === contentSig) {
      continue;
    }

    // Same chrome (article/heading/actions); only prose/status changed —
    // patch in place so VoiceOver can keep reading during streaming.
    if (current
      && current.dataset.msgKey === key
      && current.dataset.structureSig === structureSig
      && msg.role === 'assistant') {
      patchAssistantRowContent(current, buildAssistantModel(msg, ctx));
      current.dataset.contentSig = contentSig;
      continue;
    }

    const next = createMessageRow(msg, idx, ctx);
    next.dataset.msgKey = key;
    next.dataset.structureSig = structureSig;
    next.dataset.contentSig = contentSig;
    if (current) current.replaceWith(next);
    else messagesEl.appendChild(next);
  }

  while (messagesEl.childElementCount > planned.length) {
    messagesEl.lastElementChild.remove();
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

/**
 * Split fingerprints so streaming token ticks can patch prose without
 * recreating the article/heading chrome (keeps VoiceOver's place).
 */
function messageRowSignatures(msg, { isIdle, isLastAssistant, hidePromptControls }) {
  if (msg.role === 'assistant') {
    const model = buildAssistantModel(msg, { isIdle, isLastAssistant });
    // Structure = chrome that needs a full rebuild (action buttons/listeners,
    // trailing avatar). Prose, thoughts, and status labels are content patches.
    const structureSig = JSON.stringify({
      role: 'assistant',
      isIdle,
      isLastAssistant,
      hidePromptControls,
      showActions: model.showActions,
    });
    const contentSig = JSON.stringify({
      className: model.className,
      bodyContent: model.bodyContent,
      stopped: model.stopped,
      statusLabel: model.statusLabel,
      statusIcon: model.statusIcon,
      showThoughts: model.showThoughts,
      reasoningBlocks: model.reasoningBlocks,
      summaryLabel: model.summaryLabel,
      streaming: model.streaming,
    });
    return { structureSig, contentSig };
  }

  const text = (msg.parts ?? []).filter((p) => p.type === 'text').map((p) => p.text).join('');
  const fileParts = (msg.parts ?? []).filter((p) => p.type === 'file');
  const structureSig = JSON.stringify({
    role: 'user',
    isIdle,
    hidePromptControls,
    showActions: !hidePromptControls && isIdle && !!text,
  });
  const contentSig = JSON.stringify({
    text,
    files: fileParts.map((f) => ({ url: f.url, filename: f.filename, mediaType: f.mediaType })),
  });
  return { structureSig, contentSig };
}

function buildAssistantModel(msg, { isIdle, isLastAssistant }) {
  const rawText = msg.parts.filter((p) => p.type === 'text').map((p) => p.text).join('');
  const fileParts = msg.parts.filter((p) => p.type === 'file');
  const segments = segmentAssistantParts(msg.parts);
  const reasoningSegments = segments.filter((seg) => seg.kind === 'reasoning');
  // Join only for resolveAssistantContent's string API; UI keeps one DIV per
  // thought so blocks stay delineated (Brian: single section, separate DIVs).
  const reasoningFromParts = reasoningSegments.map((seg) => seg.text).join('\n\n');
  const reasoningStreaming = reasoningSegments.some((seg) => seg.streaming);
  const resolved = resolveAssistantContent({
    text: rawText,
    reasoningFromParts,
    reasoningStreaming,
  });
  const text = resolved.answer;
  const streaming = msg.status === 'streaming';
  // Octavus: one entry per reasoning part. Embedded peel already joins with
  // blank lines — split those back into blocks for the same DIV treatment.
  const reasoningBlocks = resolved.source === 'octavus'
    ? reasoningSegments.map((seg) => seg.text)
    : (resolved.reasoning
      ? resolved.reasoning.split(/\n\n+/).filter((block) => block.trim().length > 0)
      : []);
  const hasText = text.trim().length > 0;
  const hasReasoning =
    reasoningBlocks.some((block) => block.trim().length > 0)
    || reasoningStreaming
    || resolved.thinkingOpen;
  const showThoughts = shouldShowReasoning() && hasReasoning;
  const renderedHtml = stripEmojisFromHtml(
    stripHeadingLeadDecorationsFromHtml(marked.parse(text)),
  );
  const filesHtml = fileParts.map((f) => renderFilePart(f)).join('');
  const isImageGen = isImageGenerationLoading(msg.parts);

  let bodyMode = 'content';
  let bodyContent;
  if (streaming && !hasText && fileParts.length === 0 && isImageGen) {
    bodyMode = 'image';
    bodyContent = renderImagePlaceholderBody();
  } else if (streaming && !hasText && fileParts.length === 0 && !isImageGen) {
    bodyMode = 'empty';
    bodyContent = '';
  } else if (streaming && fileParts.length === 0) {
    bodyContent = `${renderedHtml}<span class="cursor" aria-hidden="true"></span>`;
  } else {
    bodyContent = `${renderedHtml}${filesHtml}${streaming ? '<span class="cursor" aria-hidden="true"></span>' : ''}`;
  }

  const streamingStatus = streaming && fileParts.length === 0 ? getStreamingStatus(msg.parts) : null;
  const showActions = !chatConfig.hidePromptControls && isIdle && (hasText || msg.stopped);

  return {
    text,
    fileParts,
    streaming,
    stopped: !!msg.stopped,
    reasoningBlocks,
    showThoughts,
    summaryLabel: streaming ? t('Thinking…') : t('Thoughts'),
    thoughtsHtml: showThoughts ? renderThoughtsBlock(reasoningBlocks, { streaming }) : '',
    bodyMode,
    bodyContent,
    statusLabel: streamingStatus?.label ?? '',
    statusIcon: streamingStatus?.icon ?? null,
    statusHtml: streamingStatus
      ? `<div class="message__ai-status body-xsmall">${streamingStatus.icon ? `${streamingStatus.icon} ` : ''}${streamingStatus.label}</div>`
      : '',
    isLastAssistant,
    showActions,
    className: streaming ? 'message message--ai message--ai--streaming' : 'message message--ai',
  };
}

/** Update prose/status inside an existing assistant article without replacing it. */
function patchAssistantRowContent(row, model) {
  row.className = model.className;

  const heading = row.querySelector(':scope > h2.visually-hidden');
  let thoughts = row.querySelector(':scope > .message__thoughts');
  if (model.showThoughts) {
    const blocksHtml = model.reasoningBlocks
      .map((text) => {
        const html = escapeHtml(text ?? '').replace(/\n/g, '<br>');
        return `<div class="message__thoughts-block">${html}</div>`;
      })
      .join('');
    if (thoughts) {
      // Preserve the user's open/closed choice across token ticks (A20).
      const wasOpen = thoughts.open;
      const label = thoughts.querySelector('.message__thoughts-summary-label');
      if (label) label.textContent = model.summaryLabel;
      const thoughtsBody = thoughts.querySelector('.message__thoughts-body');
      if (thoughtsBody) thoughtsBody.innerHTML = blocksHtml;
      thoughts.open = wasOpen;
    } else if (heading) {
      heading.insertAdjacentHTML('afterend', model.thoughtsHtml);
    }
  } else if (thoughts) {
    thoughts.remove();
  }

  const body = row.querySelector(':scope > .message__body');
  if (body) {
    body.innerHTML = model.bodyContent;
    if (model.stopped) {
      const stoppedEl = document.createElement('div');
      stoppedEl.className = 'message__stopped body-xsmall';
      stoppedEl.textContent = t('Response stopped');
      body.appendChild(stoppedEl);
    }
  }

  const statusEl = row.querySelector('.message__ai-status');
  if (model.statusLabel) {
    const statusText = `${model.statusIcon ? `${model.statusIcon} ` : ''}${model.statusLabel}`;
    if (statusEl) {
      statusEl.textContent = statusText;
    } else {
      const trailing = row.querySelector('.message__ai-trailing');
      if (trailing) {
        trailing.insertAdjacentHTML('beforeend', model.statusHtml);
      }
    }
  } else if (statusEl) {
    statusEl.remove();
  }

  const avatar = row.querySelector('.message__avatar');
  if (avatar) {
    avatar.classList.toggle('message__avatar--thinking', model.streaming);
  }
}

function createMessageRow(msg, userAssistantIdx, { isIdle, isLastAssistant }) {
  // <article> + visually hidden heading so VoiceOver's Headings / Articles
  // rotors can land on each turn. Plain divs left replies as an unlabelled
  // paragraph soup inside a scrollable main — reachable in the AX tree, but
  // practically undiscoverable via landmark/heading navigation.
  const row = document.createElement('article');
  const whoLabel = msg.role === 'assistant' ? t("Cosmo's reply") : t('Your message');
  const labelId = `msg-label-${userAssistantIdx}`;
  row.setAttribute('aria-labelledby', labelId);
  const headingHtml = `<h2 id="${labelId}" class="visually-hidden">${escapeHtml(whoLabel)}</h2>`;

  if (msg.role === 'assistant') {
    const model = buildAssistantModel(msg, { isIdle, isLastAssistant });

    const avatarOpen = model.streaming
      ? `<div class="message__avatar message__avatar--thinking"${thinkingBorderAnimationDelayAttr()}>`
      : '<div class="message__avatar">';
    const avatarClose = '</div>';

    // Only the last assistant message gets the trailing Cosmo avatar
    // (and its thinking animation) — earlier replies don't repeat it.
    const trailingHtml = isLastAssistant ? `
      <div class="message__ai-trailing">
        ${avatarOpen}
          <span class="cosmo-avatar small" role="img" aria-label="Cosmo"></span>
        ${avatarClose}
        ${model.statusHtml}
      </div>
    ` : '';

    row.className = model.className;
    row.innerHTML = `
      ${headingHtml}
      ${model.thoughtsHtml}
      <div class="message__body body-medium markdown">
        ${model.bodyContent}
      </div>
      ${trailingHtml}
    `;

    if (model.stopped) {
      const stoppedEl = document.createElement('div');
      stoppedEl.className = 'message__stopped body-xsmall';
      stoppedEl.textContent = t('Response stopped');
      row.querySelector('.message__body').appendChild(stoppedEl);
    }

    // Hover actions on every assistant message (when idle): regenerate
    // and copy-as-markdown. Both use the .button-icon style and reveal on
    // hover. On the last message they share the trailing avatar row (12px
    // from the avatar); earlier messages get their own row below.
    if (model.showActions) {
      const actions = document.createElement('div');
      actions.className = 'message__msg-actions';

      const regenBtn = document.createElement('button');
      regenBtn.type = 'button';
      regenBtn.className = 'button-icon message__hover-btn';
      regenBtn.setAttribute('aria-label', t('Regenerate response'));
      regenBtn.title = t('Regenerate');
      regenBtn.innerHTML = REGEN_ICON_SVG;
      const capturedIdx = userAssistantIdx;
      regenBtn.addEventListener('click', () => regenerateResponse(capturedIdx));
      actions.appendChild(regenBtn);

      if (model.text.trim()) {
        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'button-icon message__hover-btn';
        copyBtn.setAttribute('aria-label', t('Copy as Markdown'));
        copyBtn.title = t('Copy');
        copyBtn.innerHTML = COPY_ICON_SVG;
        const markdown = model.text;
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
  } else {
    const text = msg.parts.filter((p) => p.type === 'text').map((p) => p.text).join('');
    const fileParts = msg.parts.filter((p) => p.type === 'file');

    const filesHtml = fileParts.map((f) => renderFilePart(f)).join('');

    row.className = 'message message--user';
    row.innerHTML = `
      ${headingHtml}
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
      editBtn.setAttribute('aria-label', t('Edit message'));
      editBtn.title = t('Edit');
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
  }

  return row;
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
    await active.chat.send(
      'user-message',
      {
        USER_MESSAGE: text,
        CUSTOM_INSTRUCTIONS: customInstructionsValue(),
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
  if (!files.length || !active?.chat) return;

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
    const refs = await active.chat.uploadFiles(files);
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
      err.textContent = t('Upload failed');
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
  return canSendMessage({
    hasActiveChat: Boolean(active?.chat),
    isUploading,
    activeStatus: active?.chat?.status,
    streamingCount: streamingCount(),
    maxStreams: MAX_CONCURRENT_STREAMS,
    hasText: promptInput.value.trim().length > 0,
    hasReadyFile: fileItems.some((i) => i.status === 'ready'),
  });
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
  if (!chatConfig.hidePromptControls && active?.chat?.status === 'streaming') {
    stopGeneration();
  } else {
    sendMessage();
  }
});

// Stop the ACTIVE session's stream and fold its partial turn into history.
function stopGeneration() {
  const rt = active;
  if (!rt) return;

  // Announce before abort so the subscribe handler can suppress the generic
  // "Response complete" that would otherwise fire on the streaming→idle tick.
  rt.stopAnnouncementPending = true;
  announceChatStatus(t('Response stopped'));

  clearSaveTimer(rt);
  if (rt.abortController) {
    rt.abortController.abort();
    rt.abortController = null;
  }
  rt.streamingStartTime = null;

  const partialMessages = rt.chat?.messages ?? [];
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
    rt.restoredMessages = [...rt.restoredMessages, ...serialized];
  }

  // Rebuild the chat so the live message set is cleared before we persist;
  // saveSession() then writes restoredMessages (the full convo) only.
  rt.lastStatus = null;
  rt.stopAnnouncementPending = false;
  attachChat(rt);
  renderActive();
  syncStreamingLoop();
  updateSendBtn();
  if (hadPartial) saveSession(rt);
}

function updateSendBtn() {
  const streaming = active?.chat?.status === 'streaming';
  const showStop = streaming && !chatConfig.hidePromptControls;
  const sendSvg = sendBtn.querySelector('.composer__send-svg');
  const stopSvg = sendBtn.querySelector('.composer__stop-svg');

  if (showStop) {
    sendBtn.disabled = false;
    sendBtn.setAttribute('aria-label', t('Stop generation'));
    if (sendSvg) sendSvg.style.display = 'none';
    if (stopSvg) stopSvg.style.display = '';
  } else {
    sendBtn.disabled = !isComposerSendAllowed();
    // When blocked purely by the concurrency cap, say so; otherwise it's a
    // normal "nothing to send yet" disabled state.
    const atCap = !streaming && streamingCount() >= MAX_CONCURRENT_STREAMS;
    sendBtn.setAttribute(
      'aria-label',
      atCap
        ? t('Waiting for a response to finish (max {max} at once)', { max: MAX_CONCURRENT_STREAMS })
        : t('Send prompt'),
    );
    sendBtn.title = atCap ? t('Up to {max} chats can respond at once', { max: MAX_CONCURRENT_STREAMS }) : '';
    if (sendSvg) sendSvg.style.display = '';
    if (stopSvg) stopSvg.style.display = 'none';
  }
}

// ── Sidebar ───────────────────────────────────────────────────
function renderSidebar() {
  sessionList.innerHTML = '';

  for (const s of allSessionsMeta) {
    const isActive = s.session_id === active?.sessionId;
    const isStreaming = sessions.get(s.session_id)?.chat?.status === 'streaming';
    const item = document.createElement('div');
    item.className = 'session-item'
      + (isActive ? ' session-item--active' : '')
      + (isStreaming ? ' session-item--streaming' : '');
    item.setAttribute('role', 'button');
    item.setAttribute('tabindex', '0');
    item.setAttribute('aria-label', isStreaming ? t('{title} (responding)', { title: s.title }) : s.title);

    const title = document.createElement('span');
    title.className = 'session-item__title';
    title.textContent = s.title;
    if (isStreaming) {
      const dot = document.createElement('span');
      dot.className = 'session-item__streaming-dot';
      dot.setAttribute('aria-hidden', 'true');
      dot.title = t('Responding…');
      item.appendChild(dot);
    }

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'session-item__delete';
    del.setAttribute('aria-label', t('Delete conversation'));
    del.title = t('Delete');
    del.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
    </svg>`;

    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      await deleteSession(s.session_id);
    });

    item.addEventListener('click', () => {
      if (s.session_id !== active?.sessionId) switchSession(s.session_id);
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
  const wasActive = active?.sessionId === sid;
  teardownRuntime(sid);
  await fetch(`/api/sessions/${sid}`, { method: 'DELETE' });
  allSessionsMeta = allSessionsMeta.filter((s) => s.session_id !== sid);

  if (wasActive) {
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
  const hasMessages = (active?.restoredMessages?.length ?? 0) > 0 ||
    (chatHistory && chatHistory.querySelector('.messages')?.childElementCount > 0);

  if (!hasMessages) {
    replaceCurrentChat();
    return;
  }

  const content = document.createElement('div');
  content.innerHTML = `<p class="body-medium">${t('Starting a new chat will <strong>permanently delete</strong> your current conversation. This cannot be undone.')}</p>`;

  const confirmModal = new Modal({
    size: 'small',
    title: t('Start new chat?'),
    content,
    closeOnOverlayClick: true,
    closeOnEscape: true,
    footerButtons: [
      { label: t('Cancel'), type: 'secondary', onClick: () => confirmModal.close() },
      { label: t('Delete & Start New'), type: 'primary', onClick: async () => {
        confirmModal.close();
        await replaceCurrentChat();
      }},
    ],
  });
  confirmModal.open();
}

async function replaceCurrentChat() {
  if (active) {
    const sid = active.sessionId;
    teardownRuntime(sid);
    await fetch(`/api/sessions/${sid}`, { method: 'DELETE' });
    allSessionsMeta = allSessionsMeta.filter((s) => s.session_id !== sid);
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

  clearAttachment();
  applyInitialPrompt();

  active = getOrCreateRuntime(data.sessionId, []);

  if (chatConfig.hideHistory) {
    allSessionsMeta = [{ session_id: active.sessionId, title: t('New conversation'), updated_at: new Date().toISOString() }];
  } else {
    allSessionsMeta.unshift({ session_id: active.sessionId, title: t('New conversation'), updated_at: new Date().toISOString() });
  }

  renderActive();
  renderSidebar();
  updateSendBtn();
  syncStreamingLoop();
}

// ── Regenerate / Edit ─────────────────────────────────────────

// Serialise live OctavusChat messages into the on-disk storage shape.
// OctavusChat only holds messages produced in the current page session,
// so this never includes the pre-load `restoredMessages` history.
function serializeLiveMessages(liveMessages) {
  return liveMessages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => {
      const rawText = m.parts.filter((p) => p.type === 'text').map((p) => p.text).join('');
      const reasoningBlocks = segmentAssistantParts(m.parts)
        .filter((seg) => seg.kind === 'reasoning')
        .map((seg) => seg.text);
      const resolved = resolveAssistantContent({
        text: rawText,
        reasoningFromParts: reasoningBlocks.join('\n\n'),
      });
      // One entry per thought so restore can render separate DIVs inside the
      // single Thoughts section (not one glued string).
      const reasoning = resolved.source === 'octavus'
        ? reasoningBlocks
        : (resolved.reasoning ? [resolved.reasoning] : []);
      return {
        role: m.role,
        content: m.role === 'assistant' ? resolved.answer : rawText,
        ...(reasoning.length ? { reasoning } : {}),
        files: m.parts
          .filter((p) => p.type === 'file')
          .map((p) => ({ filename: p.filename, mediaType: p.mediaType, url: p.url })),
        timestamp: new Date().toISOString(),
      };
    });
}

// The full conversation in storage shape: pre-load history followed by
// the live turns. This is the single source of truth used for rendering
// indices, regenerate/edit targeting, and persistence — keep it in sync
// with how renderMessages() composes the displayed list.
function getAllCurrentMessages(rt = active) {
  return [...(rt?.restoredMessages ?? []), ...serializeLiveMessages(rt?.chat?.messages ?? [])];
}

async function forkSession(messages) {
  const res = await fetch('/api/session/fork', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      oldSessionId: active.sessionId,
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
  const oldSessionId = active.sessionId;
  const data = await forkSession(historyMessages);

  // The fork replaces the current conversation with a new session id, so
  // retire the old runtime and stand up one for the forked session.
  teardownRuntime(oldSessionId);
  active = getOrCreateRuntime(data.sessionId, historyMessages);

  const metaIdx = allSessionsMeta.findIndex((s) => s.session_id === oldSessionId);
  if (metaIdx >= 0) {
    allSessionsMeta[metaIdx].session_id = active.sessionId;
  } else {
    allSessionsMeta.unshift({
      session_id: active.sessionId,
      title: deriveTitle(historyMessages) || t('New conversation'),
      updated_at: new Date().toISOString(),
    });
  }
  renderSidebar();
  renderActive();

  const rt = active;
  const filesToSend = userFiles?.length > 0 ? userFiles : undefined;
  await rt.chat.send(
    'user-message',
    {
      USER_MESSAGE: userText,
      CUSTOM_INSTRUCTIONS: customInstructionsValue(),
      ...(filesToSend ? { FILES: filesToSend } : {}),
    },
    { userMessage: { content: userText, ...(filesToSend ? { files: filesToSend } : {}) } },
  );
}

// Icons for the message hover actions (inline SVG, inherit currentColor).
const REGEN_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
</svg>`;

// Copy to clipboard with a brief checkmark confirmation on the button.

/**
 * Copy text to the clipboard, with a fallback for restricted contexts.
 *
 * The async Clipboard API (`navigator.clipboard.writeText`) is gated by the
 * `clipboard-write` Permissions Policy. When the app runs inside a (possibly
 * nested / cross-origin) iframe that delegation can fail to propagate, so the
 * call is blocked even when the host iframe sets `allow="clipboard-write"`
 * (see https://crbug.com/414348233). We fall back to the legacy
 * `document.execCommand('copy')` path, which is not subject to that policy.
 * @param {string} text
 * @returns {Promise<boolean>} Whether the copy succeeded.
 */
async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      // Fall through to the legacy path below.
    }
  }
  // Remember what was focused so selecting the temporary textarea doesn't
  // steal focus from the triggering element (e.g. the copy button).
  const previouslyFocused = document.activeElement;
  const textarea = document.createElement('textarea');
  try {
    textarea.value = text;
    // Keep it out of view and non-interactive, but still selectable.
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    if (ok) return true;
    throw new Error("document.execCommand('copy') returned false");
  } catch (err) {
    console.error('[ChatCPT] Copy failed:', err);
    return false;
  } finally {
    // Guaranteed cleanup even if select()/execCommand() throws.
    if (textarea.parentNode) {
      textarea.parentNode.removeChild(textarea);
    }
    if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
      previouslyFocused.focus();
    }
  }
}

/**
 * Write text to the clipboard and briefly swap the trigger button to a checkmark.
 * @param {HTMLButtonElement} btn - Button that initiated the copy; its icon, title, and aria-label are restored after 1.5s.
 * @param {string} text - Raw text to copy.
 * @param {{ ariaLabel?: string, copiedLabel?: string }} [options] - Labels restored/applied on the button.
 * @returns {Promise<void>}
 */
async function copyWithFeedback(btn, text, { ariaLabel = t('Copy'), copiedLabel = t('Copied') } = {}) {
  if (!(await copyText(text))) {
    return;
  }
  // Capture the true original state only when no reset is already pending; a
  // rapid second click would otherwise snapshot the checkmark as the "original".
  if (btn._copyResetTimer) {
    clearTimeout(btn._copyResetTimer);
  } else {
    btn._copyOriginalHtml = btn.innerHTML;
  }
  const original = btn._copyOriginalHtml;
  btn.innerHTML = CHECK_ICON_SVG;
  btn.title = copiedLabel;
  btn.setAttribute('aria-label', copiedLabel);
  btn._copyResetTimer = setTimeout(() => {
    btn.innerHTML = original;
    btn.title = ariaLabel;
    btn.setAttribute('aria-label', ariaLabel);
    btn._copyResetTimer = null;
    btn._copyOriginalHtml = null;
  }, 1500);
}

/**
 * Copy an assistant message's markdown source via the hover action button.
 * @param {HTMLButtonElement} btn
 * @param {string} markdown - Full message text as returned by the model.
 * @returns {Promise<void>}
 */
async function copyMessageMarkdown(btn, markdown) {
  await copyWithFeedback(btn, markdown, { ariaLabel: t('Copy as Markdown') });
}

/**
 * Copy a fenced code block's source via its header copy button.
 * @param {HTMLButtonElement} btn
 * @param {string} code - Plain source text from the block's `<code>` element.
 * @returns {Promise<void>}
 */
async function copyCodeBlock(btn, code) {
  await copyWithFeedback(btn, code, { ariaLabel: t('Copy code') });
}

// Regenerate a specific assistant response: re-run the user turn that
// preceded it (forking the session, which drops everything after).
async function regenerateResponse(assistantIdx) {
  // Forking starts a new stream; respect the global concurrency cap.
  if (streamingCount() >= MAX_CONCURRENT_STREAMS) return;
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
  // Forking starts a new stream; respect the global concurrency cap.
  if (streamingCount() >= MAX_CONCURRENT_STREAMS) return;
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
  cancelBtn.textContent = t('Cancel');

  const submitBtn = document.createElement('button');
  submitBtn.type = 'button';
  submitBtn.className = 'button button-primary button-xsmall';
  submitBtn.textContent = t('Save');

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
  // One entry per thought; sessions saved before that held a single string.
  const reasoningBlocks = Array.isArray(m.reasoning)
    ? m.reasoning
    : (m.reasoning ? [m.reasoning] : []);
  return {
    role: m.role,
    status: 'done',
    stopped: m.stopped || false,
    parts: [
      ...reasoningBlocks.map((text) => ({ type: 'reasoning', text, status: 'done' })),
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
// All save state is per-runtime so concurrent streams persist independently.
const SAVE_THROTTLE_MS = 1000;

// Persist a runtime's partial state, debounced to the throttle window.
function throttledSave(rt) {
  const elapsed = Date.now() - rt.lastSaveTime;
  if (elapsed >= SAVE_THROTTLE_MS) {
    flushSave(rt);
  } else if (!rt.saveThrottleTimer) {
    // Trailing-edge save covering the remainder of the current window.
    rt.saveThrottleTimer = setTimeout(() => flushSave(rt), SAVE_THROTTLE_MS - elapsed);
  }
}

function flushSave(rt) {
  if (rt.saveThrottleTimer) { clearTimeout(rt.saveThrottleTimer); rt.saveThrottleTimer = null; }
  rt.lastSaveTime = Date.now();
  saveSession(rt);
}

// Cancel a runtime's pending trailing-edge save (on stop / delete). Resetting
// lastSaveTime lets the next turn's first save run immediately.
function clearSaveTimer(rt) {
  if (rt.saveThrottleTimer) { clearTimeout(rt.saveThrottleTimer); rt.saveThrottleTimer = null; }
  rt.lastSaveTime = 0;
}

// Persistence policy applied on every subscription tick for a runtime:
//  • Entering streaming → immediate save so the user message is durable.
//  • Mid-stream → throttled partial saves.
//  • Leaving streaming → final flush so nothing is lost to throttling.
function persist(rt) {
  switch (nextSaveAction(rt.chat.status, rt.lastStatus)) {
    case 'flush': flushSave(rt); break;
    case 'throttle': throttledSave(rt); break;
    default: break;
  }
}

// Persist the full conversation (pre-load history + live turns) to disk.
// Combining both is essential for resumed sessions, where chat.messages
// only contains turns from the current page session — saving live-only
// would otherwise drop the earlier history.
function saveSession(rt = active) {
  if (!rt) return;
  const allMessages = getAllCurrentMessages(rt);

  fetch('/api/session/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: rt.sessionId, messages: allMessages }),
  })
    .then(() => {
      // Refresh the sidebar title (first user message may now be available)
      const firstUser = allMessages.find((m) => m.role === 'user');
      const title = firstUser?.content
        ? (firstUser.content.length > 45 ? firstUser.content.slice(0, 45) + '…' : firstUser.content)
        : t('New conversation');
      const meta = allSessionsMeta.find((s) => s.session_id === rt.sessionId);
      if (meta) { meta.title = title; meta.updated_at = new Date().toISOString(); }
      renderSidebar();
    })
    .catch((err) => console.warn('[ChatCPT] Session save failed:', err));
}

// ── Boot ──────────────────────────────────────────────────────
init();
