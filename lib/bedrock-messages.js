/**
 * Translation between this app's stored message shape and the Amazon Bedrock
 * Converse API request shape.
 *
 * Stored messages look like:
 *   { role: 'user'|'assistant', content: string, files?: [{ filename, mediaType, url }] }
 *
 * Converse messages look like:
 *   { role, content: [ContentBlock, ...] }
 *
 * Unlike the previous hosted-agent setup, Bedrock keeps no conversation state,
 * so the full history is rebuilt and re-sent on every turn.
 */

/** Image MIME types Converse accepts, mapped to its `format` values. */
export const IMAGE_FORMATS = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/jpg': 'jpeg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

/** Document MIME types Converse accepts, mapped to its `format` values. */
export const DOCUMENT_FORMATS = {
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'text/markdown': 'md',
  'text/html': 'html',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

/**
 * Extended-reasoning token budgets per UI level. Anthropic requires at least
 * 1024 budget tokens, and `maxTokens` must leave room for the visible answer on
 * top of the budget.
 */
export const THINKING_BUDGETS = {
  off: 0,
  low: 1024,
  medium: 4096,
  high: 12288,
  max: 24576,
};

/** Output tokens reserved for the visible answer. */
export const DEFAULT_MAX_TOKENS = 8192;

/**
 * Converse rejects document names containing anything outside this set, and the
 * name is model-visible so it is also a prompt-injection surface. Collapse to a
 * conservative, neutral form.
 */
export function sanitizeDocumentName(filename, fallback = 'document') {
  const base = String(filename ?? '')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9\s\-()[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return base || fallback;
}

/**
 * Inference parameters shared across models. Temperature is only sent when
 * extended reasoning is off — Anthropic models reject a custom temperature
 * while reasoning is enabled.
 * @param {{ temperature?: number, thinking?: string }} settings
 */
export function buildInferenceConfig({ temperature, thinking = 'off' } = {}) {
  const budget = THINKING_BUDGETS[thinking] ?? 0;
  const config = { maxTokens: DEFAULT_MAX_TOKENS + budget };
  if (budget === 0 && temperature !== undefined && temperature !== null) {
    config.temperature = temperature;
  }
  return config;
}

/**
 * Model-specific reasoning parameters, passed through `additionalModelRequestFields`.
 * Returns undefined when reasoning is off so the field can be omitted entirely.
 * @param {string} [thinking]
 */
export function buildAdditionalModelRequestFields(thinking = 'off') {
  const budget = THINKING_BUDGETS[thinking] ?? 0;
  if (budget === 0) return undefined;
  return { reasoning_config: { type: 'enabled', budget_tokens: budget } };
}

/**
 * Build the content block for one stored attachment, or null when the type
 * isn't something Converse can carry.
 * @param {{ filename?: string, mediaType?: string }} file
 * @param {Uint8Array} bytes
 */
export function buildAttachmentBlock(file, bytes) {
  if (!bytes?.length) return null;
  const mediaType = (file?.mediaType ?? '').toLowerCase();

  const imageFormat = IMAGE_FORMATS[mediaType];
  if (imageFormat) return { image: { format: imageFormat, source: { bytes } } };

  const documentFormat = DOCUMENT_FORMATS[mediaType];
  if (documentFormat) {
    return {
      document: {
        format: documentFormat,
        name: sanitizeDocumentName(file?.filename),
        source: { bytes },
      },
    };
  }

  return null;
}

/**
 * Converse requires messages to start with `user` and to alternate roles, and
 * rejects messages with empty content. History that has been forked, stopped
 * mid-stream, or trimmed by the UI can violate all three, so normalize before
 * sending.
 * @param {Array<{ role: string, content: Array<object> }>} messages
 */
export function normalizeConverseMessages(messages) {
  const normalized = [];
  for (const message of messages) {
    if (!message.content?.length) continue;
    // A leading assistant turn has no user prompt to answer; drop it.
    if (normalized.length === 0 && message.role !== 'user') continue;

    const previous = normalized[normalized.length - 1];
    if (previous?.role === message.role) {
      previous.content.push(...message.content);
      continue;
    }
    normalized.push({ role: message.role, content: [...message.content] });
  }
  return normalized;
}

/** Prompt used when a turn carries attachments but no typed text. */
export const ATTACHMENT_ONLY_PROMPT = 'Please take a look at the attached file(s).';

/**
 * Convert stored messages into Converse messages, loading attachment bytes on
 * demand.
 * @param {Array<{ role: string, content?: string, files?: Array<object> }>} messages
 * @param {(file: object) => Promise<Uint8Array|null>} loadAttachmentBytes
 */
export async function toConverseMessages(messages, loadAttachmentBytes) {
  const converse = [];

  for (const message of messages ?? []) {
    if (message.role !== 'user' && message.role !== 'assistant') continue;

    const content = [];
    const text = (message.content ?? '').trim();

    // Attachments are only meaningful on user turns; assistant-side files are
    // rendered from the transcript and carry no bytes worth replaying.
    if (message.role === 'user' && loadAttachmentBytes) {
      for (const file of message.files ?? []) {
        let bytes = null;
        try {
          bytes = await loadAttachmentBytes(file);
        } catch (err) {
          console.warn('[bedrock] Skipping unreadable attachment:', file?.filename, err?.message);
        }
        const block = buildAttachmentBlock(file, bytes);
        if (block) content.push(block);
      }
    }

    // A document block is only valid alongside a text block, so synthesize a
    // prompt when the user sent files with no message of their own.
    if (text) content.push({ text });
    else if (content.length > 0) content.push({ text: ATTACHMENT_ONLY_PROMPT });

    if (content.length > 0) converse.push({ role: message.role, content });
  }

  return normalizeConverseMessages(converse);
}
