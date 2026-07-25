import { describe, it, expect } from 'vitest';
import {
  toConverseMessages,
  normalizeConverseMessages,
  buildInferenceConfig,
  buildAdditionalModelRequestFields,
  buildAttachmentBlock,
  sanitizeDocumentName,
  THINKING_BUDGETS,
  DEFAULT_MAX_TOKENS,
  ATTACHMENT_ONLY_PROMPT,
} from '../lib/bedrock-messages.js';

const bytes = (n = 4) => new Uint8Array(n).fill(1);
const noAttachments = async () => null;

// ── buildInferenceConfig ──────────────────────────────────────

describe('buildInferenceConfig', () => {
  it('always sets maxTokens explicitly', () => {
    expect(buildInferenceConfig({}).maxTokens).toBe(DEFAULT_MAX_TOKENS);
  });

  it('includes temperature when reasoning is off', () => {
    expect(buildInferenceConfig({ temperature: 0.4 }).temperature).toBe(0.4);
  });

  it('keeps a temperature of 0', () => {
    expect(buildInferenceConfig({ temperature: 0 }).temperature).toBe(0);
  });

  it('omits temperature when reasoning is enabled', () => {
    const config = buildInferenceConfig({ temperature: 0.4, thinking: 'high' });
    expect(config).not.toHaveProperty('temperature');
  });

  it('raises maxTokens to leave room above the reasoning budget', () => {
    const config = buildInferenceConfig({ thinking: 'max' });
    expect(config.maxTokens).toBe(DEFAULT_MAX_TOKENS + THINKING_BUDGETS.max);
    expect(config.maxTokens).toBeGreaterThan(THINKING_BUDGETS.max);
  });

  it('treats an unknown thinking level as off', () => {
    const config = buildInferenceConfig({ temperature: 0.9, thinking: 'ludicrous' });
    expect(config.maxTokens).toBe(DEFAULT_MAX_TOKENS);
    expect(config.temperature).toBe(0.9);
  });
});

// ── buildAdditionalModelRequestFields ─────────────────────────

describe('buildAdditionalModelRequestFields', () => {
  it('returns undefined when reasoning is off', () => {
    expect(buildAdditionalModelRequestFields('off')).toBeUndefined();
    expect(buildAdditionalModelRequestFields()).toBeUndefined();
  });

  it('enables reasoning with the level budget', () => {
    expect(buildAdditionalModelRequestFields('medium')).toEqual({
      reasoning_config: { type: 'enabled', budget_tokens: THINKING_BUDGETS.medium },
    });
  });

  it('never emits a budget below the 1024 minimum', () => {
    for (const level of ['low', 'medium', 'high', 'max']) {
      const fields = buildAdditionalModelRequestFields(level);
      expect(fields.reasoning_config.budget_tokens).toBeGreaterThanOrEqual(1024);
    }
  });
});

// ── sanitizeDocumentName ──────────────────────────────────────

describe('sanitizeDocumentName', () => {
  it('strips the extension', () => {
    expect(sanitizeDocumentName('report.pdf')).toBe('report');
  });

  it('removes characters Converse rejects', () => {
    expect(sanitizeDocumentName('my/weird:name!.pdf')).toBe('my weird name');
  });

  it('collapses runs of whitespace', () => {
    expect(sanitizeDocumentName('a    b.txt')).toBe('a b');
  });

  it('falls back when nothing usable remains', () => {
    expect(sanitizeDocumentName('***.pdf')).toBe('document');
    expect(sanitizeDocumentName(undefined)).toBe('document');
  });
});

// ── buildAttachmentBlock ──────────────────────────────────────

describe('buildAttachmentBlock', () => {
  it('builds an image block for a supported image type', () => {
    const block = buildAttachmentBlock({ mediaType: 'image/png' }, bytes());
    expect(block.image.format).toBe('png');
  });

  it('normalizes image/jpg to jpeg', () => {
    expect(buildAttachmentBlock({ mediaType: 'image/jpg' }, bytes()).image.format).toBe('jpeg');
  });

  it('builds a document block with a sanitized name', () => {
    const block = buildAttachmentBlock({ mediaType: 'application/pdf', filename: 'q3 report!.pdf' }, bytes());
    expect(block.document.format).toBe('pdf');
    expect(block.document.name).toBe('q3 report');
  });

  it('returns null for unsupported types', () => {
    expect(buildAttachmentBlock({ mediaType: 'application/zip' }, bytes())).toBeNull();
  });

  it('returns null when bytes are missing', () => {
    expect(buildAttachmentBlock({ mediaType: 'image/png' }, null)).toBeNull();
  });
});

// ── normalizeConverseMessages ─────────────────────────────────

describe('normalizeConverseMessages', () => {
  it('drops leading assistant turns', () => {
    const result = normalizeConverseMessages([
      { role: 'assistant', content: [{ text: 'hi' }] },
      { role: 'user', content: [{ text: 'hello' }] },
    ]);
    expect(result).toEqual([{ role: 'user', content: [{ text: 'hello' }] }]);
  });

  it('merges consecutive same-role turns', () => {
    const result = normalizeConverseMessages([
      { role: 'user', content: [{ text: 'a' }] },
      { role: 'user', content: [{ text: 'b' }] },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].content).toEqual([{ text: 'a' }, { text: 'b' }]);
  });

  it('drops messages with empty content', () => {
    const result = normalizeConverseMessages([
      { role: 'user', content: [{ text: 'a' }] },
      { role: 'assistant', content: [] },
      { role: 'user', content: [{ text: 'b' }] },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].content).toEqual([{ text: 'a' }, { text: 'b' }]);
  });

  it('does not mutate the input messages', () => {
    const input = [
      { role: 'user', content: [{ text: 'a' }] },
      { role: 'user', content: [{ text: 'b' }] },
    ];
    normalizeConverseMessages(input);
    expect(input[0].content).toHaveLength(1);
  });

  it('leaves a well-formed alternating conversation untouched', () => {
    const input = [
      { role: 'user', content: [{ text: 'a' }] },
      { role: 'assistant', content: [{ text: 'b' }] },
      { role: 'user', content: [{ text: 'c' }] },
    ];
    expect(normalizeConverseMessages(input)).toEqual(input);
  });
});

// ── toConverseMessages ────────────────────────────────────────

describe('toConverseMessages', () => {
  it('maps stored text messages to Converse content blocks', async () => {
    const result = await toConverseMessages([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ], noAttachments);

    expect(result).toEqual([
      { role: 'user', content: [{ text: 'hello' }] },
      { role: 'assistant', content: [{ text: 'hi there' }] },
    ]);
  });

  it('returns an empty list for empty input', async () => {
    expect(await toConverseMessages([], noAttachments)).toEqual([]);
    expect(await toConverseMessages(undefined, noAttachments)).toEqual([]);
  });

  it('ignores roles other than user and assistant', async () => {
    const result = await toConverseMessages([
      { role: 'system', content: 'ignore me' },
      { role: 'user', content: 'hello' },
    ], noAttachments);
    expect(result).toEqual([{ role: 'user', content: [{ text: 'hello' }] }]);
  });

  it('places attachments before the text block', async () => {
    const result = await toConverseMessages([
      { role: 'user', content: 'what is this', files: [{ mediaType: 'image/png', url: '/uploads/s/a.png' }] },
    ], async () => bytes());

    expect(result[0].content[0]).toHaveProperty('image');
    expect(result[0].content[1]).toEqual({ text: 'what is this' });
  });

  it('synthesizes a prompt when files arrive with no text', async () => {
    const result = await toConverseMessages([
      { role: 'user', content: '', files: [{ mediaType: 'application/pdf', filename: 'a.pdf' }] },
    ], async () => bytes());

    expect(result[0].content[1]).toEqual({ text: ATTACHMENT_ONLY_PROMPT });
  });

  it('drops a turn whose attachment cannot be read and has no text', async () => {
    const result = await toConverseMessages([
      { role: 'user', content: '', files: [{ mediaType: 'image/png' }] },
    ], async () => null);
    expect(result).toEqual([]);
  });

  it('keeps the turn when an unreadable attachment accompanies text', async () => {
    const result = await toConverseMessages([
      { role: 'user', content: 'still here', files: [{ mediaType: 'image/png' }] },
    ], async () => null);
    expect(result).toEqual([{ role: 'user', content: [{ text: 'still here' }] }]);
  });

  it('survives a loader that throws', async () => {
    const result = await toConverseMessages([
      { role: 'user', content: 'text', files: [{ mediaType: 'image/png' }] },
    ], async () => { throw new Error('EACCES'); });
    expect(result).toEqual([{ role: 'user', content: [{ text: 'text' }] }]);
  });

  it('ignores attachments on assistant turns', async () => {
    const result = await toConverseMessages([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'here you go', files: [{ mediaType: 'image/png' }] },
    ], async () => bytes());
    expect(result[1].content).toEqual([{ text: 'here you go' }]);
  });

  it('trims whitespace-only content out entirely', async () => {
    expect(await toConverseMessages([{ role: 'user', content: '   ' }], noAttachments)).toEqual([]);
  });
});
