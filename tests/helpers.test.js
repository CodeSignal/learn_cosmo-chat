import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import {
  deriveTitle,
  readJsonFile,
  writeJsonFile,
  buildSessionInput,
  buildSessionRecord,
  filterModels,
  resolveVerbosity,
  VERBOSITY_LEVELS,
  normalizeLanguageName,
  matchLocaleStrings,
  mergeConfig,
  mergeStrings,
} from '../lib/helpers.js';

vi.mock('fs/promises');

// ── deriveTitle ───────────────────────────────────────────────

describe('deriveTitle', () => {
  it('returns the first user message content as-is when <= 45 chars', () => {
    const messages = [{ role: 'user', content: 'Hello world' }];
    expect(deriveTitle(messages)).toBe('Hello world');
  });

  it('truncates at 45 characters with ellipsis when content is longer', () => {
    const long = 'A'.repeat(60);
    const messages = [{ role: 'user', content: long }];
    const result = deriveTitle(messages);
    expect(result).toBe('A'.repeat(45) + '…');
    expect(result.length).toBe(46);
  });

  it('returns content exactly 45 chars without truncation', () => {
    const exact = 'B'.repeat(45);
    const messages = [{ role: 'user', content: exact }];
    expect(deriveTitle(messages)).toBe(exact);
  });

  it('skips non-user messages and uses the first user message', () => {
    const messages = [
      { role: 'assistant', content: 'I am Cosmo' },
      { role: 'user', content: 'Actual question' },
    ];
    expect(deriveTitle(messages)).toBe('Actual question');
  });

  it('returns "New conversation" when messages array is empty', () => {
    expect(deriveTitle([])).toBe('New conversation');
  });

  it('returns "New conversation" when messages is null', () => {
    expect(deriveTitle(null)).toBe('New conversation');
  });

  it('returns "New conversation" when messages is undefined', () => {
    expect(deriveTitle(undefined)).toBe('New conversation');
  });

  it('returns "New conversation" when no user message exists', () => {
    const messages = [{ role: 'assistant', content: 'Hello' }];
    expect(deriveTitle(messages)).toBe('New conversation');
  });

  it('returns "New conversation" when user message has no content', () => {
    const messages = [{ role: 'user' }];
    expect(deriveTitle(messages)).toBe('New conversation');
  });

  it('returns "New conversation" when user message content is empty string', () => {
    const messages = [{ role: 'user', content: '' }];
    expect(deriveTitle(messages)).toBe('New conversation');
  });
});

// ── readJsonFile ──────────────────────────────────────────────

describe('readJsonFile', () => {
  beforeEach(() => vi.resetAllMocks());

  it('parses valid JSON from a file', async () => {
    fs.readFile.mockResolvedValue('{"key": "value"}');
    const result = await readJsonFile('/fake/path.json');
    expect(result).toEqual({ key: 'value' });
    expect(fs.readFile).toHaveBeenCalledWith('/fake/path.json', 'utf8');
  });

  it('returns default fallback {} when file does not exist', async () => {
    fs.readFile.mockRejectedValue(new Error('ENOENT'));
    const result = await readJsonFile('/missing.json');
    expect(result).toEqual({});
  });

  it('returns custom fallback when file does not exist', async () => {
    fs.readFile.mockRejectedValue(new Error('ENOENT'));
    const result = await readJsonFile('/missing.json', { sessions: [] });
    expect(result).toEqual({ sessions: [] });
  });

  it('returns fallback when file contains invalid JSON', async () => {
    fs.readFile.mockResolvedValue('not json {{{');
    const result = await readJsonFile('/bad.json', []);
    expect(result).toEqual([]);
  });

  it('handles arrays in JSON', async () => {
    fs.readFile.mockResolvedValue('[1, 2, 3]');
    const result = await readJsonFile('/array.json');
    expect(result).toEqual([1, 2, 3]);
  });
});

// ── writeJsonFile ─────────────────────────────────────────────

describe('writeJsonFile', () => {
  beforeEach(() => vi.resetAllMocks());

  it('writes pretty-printed JSON to the specified path', async () => {
    fs.writeFile.mockResolvedValue(undefined);
    await writeJsonFile('/out.json', { a: 1 });
    expect(fs.writeFile).toHaveBeenCalledWith('/out.json', JSON.stringify({ a: 1 }, null, 2));
  });

  it('propagates write errors', async () => {
    fs.writeFile.mockRejectedValue(new Error('EACCES'));
    await expect(writeJsonFile('/readonly.json', {})).rejects.toThrow('EACCES');
  });
});

// ── buildSessionInput ─────────────────────────────────────────

describe('buildSessionInput', () => {
  it('uses model from options over config', () => {
    const input = buildSessionInput(
      { model: 'openai/gpt-4o' },
      { model: 'anthropic/claude-3' },
    );
    expect(input.MODEL).toBe('openai/gpt-4o');
  });

  it('falls back to config model when options.model is absent', () => {
    const input = buildSessionInput({}, { model: 'anthropic/claude-3' });
    expect(input.MODEL).toBe('anthropic/claude-3');
  });

  it('omits MODEL when neither options nor config provide one', () => {
    const input = buildSessionInput({}, {});
    expect(input).not.toHaveProperty('MODEL');
  });

  it('includes EXTRA_INSTRUCTIONS from config.systemPromptExtra', () => {
    const input = buildSessionInput({}, { systemPromptExtra: 'Be brief' });
    expect(input.EXTRA_INSTRUCTIONS).toBe('Be brief');
  });

  it('omits EXTRA_INSTRUCTIONS when systemPromptExtra is empty', () => {
    const input = buildSessionInput({}, { systemPromptExtra: '' });
    expect(input).not.toHaveProperty('EXTRA_INSTRUCTIONS');
  });

  it('defaults thinking to "off"', () => {
    const input = buildSessionInput({}, {});
    expect(input.THINKING).toBe('off');
  });

  it('uses thinking from options over config', () => {
    const input = buildSessionInput({ thinking: 'high' }, { thinking: 'low' });
    expect(input.THINKING).toBe('high');
  });

  it('falls back to config thinking', () => {
    const input = buildSessionInput({}, { thinking: 'medium' });
    expect(input.THINKING).toBe('medium');
  });

  it('includes TEMPERATURE when thinking is off', () => {
    const input = buildSessionInput({ temperature: 0.5 }, {});
    expect(input.TEMPERATURE).toBe(0.5);
  });

  it('falls back to config temperature when thinking is off', () => {
    const input = buildSessionInput({}, { temperature: 1.2 });
    expect(input.TEMPERATURE).toBe(1.2);
  });

  it('excludes TEMPERATURE when thinking is active', () => {
    const input = buildSessionInput(
      { thinking: 'high', temperature: 0.5 },
      { temperature: 0.7 },
    );
    expect(input).not.toHaveProperty('TEMPERATURE');
  });

  it('omits TEMPERATURE when neither options nor config provide one', () => {
    const input = buildSessionInput({}, {});
    expect(input).not.toHaveProperty('TEMPERATURE');
  });

  it('handles temperature of 0 correctly (falsy but valid)', () => {
    const input = buildSessionInput({ temperature: 0 }, {});
    expect(input.TEMPERATURE).toBe(0);
  });

  it('omits VERBOSITY_INSTRUCTIONS when verbosity is not provided', () => {
    const input = buildSessionInput({}, {});
    expect(input).not.toHaveProperty('VERBOSITY_INSTRUCTIONS');
  });

  it('uses the configured verbosity directive', () => {
    const input = buildSessionInput({}, { verbosity: 'concise' });
    expect(input.VERBOSITY_INSTRUCTIONS).toBe(VERBOSITY_LEVELS.concise);
  });

  it('supports the verbose level', () => {
    const input = buildSessionInput({}, { verbosity: 'verbose' });
    expect(input.VERBOSITY_INSTRUCTIONS).toBe(VERBOSITY_LEVELS.verbose);
  });

  it('lets options.verbosity override config.verbosity', () => {
    const input = buildSessionInput({ verbosity: 'normal' }, { verbosity: 'concise' });
    expect(input.VERBOSITY_INSTRUCTIONS).toBe(VERBOSITY_LEVELS.normal);
  });

  it('omits VERBOSITY_INSTRUCTIONS when verbosity is null (leaves prompt unchanged)', () => {
    const input = buildSessionInput({}, { verbosity: null });
    expect(input).not.toHaveProperty('VERBOSITY_INSTRUCTIONS');
  });

  it('omits VERBOSITY_INSTRUCTIONS for an unknown verbosity value', () => {
    const input = buildSessionInput({}, { verbosity: 'whisper' });
    expect(input).not.toHaveProperty('VERBOSITY_INSTRUCTIONS');
  });

  it('does not match inherited prototype keys like "constructor"', () => {
    for (const key of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      const input = buildSessionInput({}, { verbosity: key });
      expect(input).not.toHaveProperty('VERBOSITY_INSTRUCTIONS');
    }
  });

  it('defaults LANGUAGE to "English" when neither options nor config provide one', () => {
    const input = buildSessionInput({}, {});
    expect(input.LANGUAGE).toBe('English');
  });

  it('uses LANGUAGE from config', () => {
    const input = buildSessionInput({}, { language: 'Spanish' });
    expect(input.LANGUAGE).toBe('Spanish');
  });

  it('lets options.language override config.language', () => {
    const input = buildSessionInput({ language: 'French' }, { language: 'Spanish' });
    expect(input.LANGUAGE).toBe('French');
  });

  it('trims surrounding whitespace from the resolved language', () => {
    const input = buildSessionInput({}, { language: '  Spanish  ' });
    expect(input.LANGUAGE).toBe('Spanish');
  });

  it('treats an empty-string options.language as missing and falls back to config', () => {
    const input = buildSessionInput({ language: '' }, { language: 'Spanish' });
    expect(input.LANGUAGE).toBe('Spanish');
  });

  it('treats a whitespace-only options.language as missing and falls back to config', () => {
    const input = buildSessionInput({ language: '   ' }, { language: 'Spanish' });
    expect(input.LANGUAGE).toBe('Spanish');
  });

  it('defaults to "English" when both language values are empty/whitespace', () => {
    const input = buildSessionInput({ language: '   ' }, { language: '' });
    expect(input.LANGUAGE).toBe('English');
  });

  it('defaults to "English" for non-string language values', () => {
    const input = buildSessionInput({ language: 123 }, { language: null });
    expect(input.LANGUAGE).toBe('English');
  });
});

// ── resolveVerbosity ──────────────────────────────────────────

describe('resolveVerbosity', () => {
  it('returns undefined when neither options nor config specify it', () => {
    expect(resolveVerbosity({}, {})).toBeUndefined();
  });

  it('falls back to config verbosity', () => {
    expect(resolveVerbosity({}, { verbosity: 'concise' })).toBe('concise');
  });

  it('prefers options verbosity over config', () => {
    expect(resolveVerbosity({ verbosity: 'normal' }, { verbosity: 'concise' })).toBe('normal');
  });

  it('preserves an explicit null from config (no default substitution)', () => {
    expect(resolveVerbosity({}, { verbosity: null })).toBeNull();
  });

  it('preserves an explicit null from options', () => {
    expect(resolveVerbosity({ verbosity: null }, { verbosity: 'detailed' })).toBeNull();
  });
});

// ── normalizeLanguageName ─────────────────────────────────────

describe('normalizeLanguageName', () => {
  it('lowercases and trims', () => {
    expect(normalizeLanguageName('  Spanish ')).toBe('spanish');
  });

  it('returns empty string for null/undefined', () => {
    expect(normalizeLanguageName(null)).toBe('');
    expect(normalizeLanguageName(undefined)).toBe('');
  });
});

// ── matchLocaleStrings ────────────────────────────────────────

describe('matchLocaleStrings', () => {
  const locales = [
    { languageNames: ['en', 'english'], strings: { Hello: 'Hello' } },
    { languageNames: ['es', 'spanish', 'español'], strings: { Hello: 'Hola' } },
  ];

  it('matches a language name case-insensitively', () => {
    expect(matchLocaleStrings('Spanish', locales)).toEqual({ Hello: 'Hola' });
  });

  it('matches alternate names in the same locale', () => {
    expect(matchLocaleStrings('español', locales)).toEqual({ Hello: 'Hola' });
  });

  it('returns {} when no locale matches', () => {
    expect(matchLocaleStrings('French', locales)).toEqual({});
  });

  it('returns {} when language is blank or missing', () => {
    expect(matchLocaleStrings('', locales)).toEqual({});
    expect(matchLocaleStrings(undefined, locales)).toEqual({});
  });

  it('returns {} when there are no locales', () => {
    expect(matchLocaleStrings('Spanish', [])).toEqual({});
    expect(matchLocaleStrings('Spanish')).toEqual({});
  });

  it('ignores malformed locale entries', () => {
    const messy = [null, {}, { languageNames: 'es' }, { languageNames: ['es'], strings: { Hi: 'Hola' } }];
    expect(matchLocaleStrings('es', messy)).toEqual({ Hi: 'Hola' });
  });

  it('returns {} when the matched locale has no strings object', () => {
    expect(matchLocaleStrings('es', [{ languageNames: ['es'] }])).toEqual({});
  });
});

// ── mergeStrings ──────────────────────────────────────────────

describe('mergeStrings', () => {
  it('overrides base strings with config strings per key', () => {
    const base = { a: 'A', b: 'B' };
    const overrides = { b: 'B2', c: 'C' };
    expect(mergeStrings(base, overrides)).toEqual({ a: 'A', b: 'B2', c: 'C' });
  });

  it('returns base when overrides are absent', () => {
    expect(mergeStrings({ a: 'A' })).toEqual({ a: 'A' });
  });

  it('returns {} when both are absent', () => {
    expect(mergeStrings()).toEqual({});
  });
});

// ── mergeConfig ───────────────────────────────────────────────

describe('mergeConfig', () => {
  it('lets override scalars and arrays replace base values', () => {
    const base = {
      model: 'anthropic/claude-sonnet-4-6',
      thinking: 'off',
      allowedModels: ['a', 'b'],
      hideHistory: true,
    };
    const override = {
      thinking: 'medium',
      allowedModels: ['c'],
      hideModelSettings: true,
    };
    expect(mergeConfig(base, override)).toEqual({
      model: 'anthropic/claude-sonnet-4-6',
      thinking: 'medium',
      allowedModels: ['c'],
      hideHistory: true,
      hideModelSettings: true,
    });
  });

  it('deep-merges strings and modelDisplayNames maps per key', () => {
    const base = {
      strings: { 'New chat': 'Nuevo', Settings: 'Ajustes' },
      modelDisplayNames: { 'openai/gpt-5': 'GPT-5' },
    };
    const override = {
      strings: { Settings: 'Configuración' },
      modelDisplayNames: { 'anthropic/claude-sonnet-4-6': 'Claude' },
    };
    expect(mergeConfig(base, override)).toEqual({
      strings: { 'New chat': 'Nuevo', Settings: 'Configuración' },
      modelDisplayNames: {
        'openai/gpt-5': 'GPT-5',
        'anthropic/claude-sonnet-4-6': 'Claude',
      },
    });
  });

  it('returns a shallow copy of base when override is missing or invalid', () => {
    const base = { thinking: 'off' };
    expect(mergeConfig(base)).toEqual({ thinking: 'off' });
    expect(mergeConfig(base, null)).toEqual({ thinking: 'off' });
    expect(mergeConfig(base, [])).toEqual({ thinking: 'off' });
  });
});

// ── buildSessionRecord ────────────────────────────────────────

describe('buildSessionRecord', () => {
  let dateSpy;

  beforeEach(() => {
    dateSpy = vi.spyOn(Date.prototype, 'toISOString').mockReturnValue('2026-01-01T00:00:00.000Z');
  });

  afterEach(() => {
    dateSpy.mockRestore();
  });

  it('creates a record with the given session ID', () => {
    const record = buildSessionRecord('sess-123');
    expect(record.session_id).toBe('sess-123');
  });

  it('initializes with empty messages array', () => {
    const record = buildSessionRecord('sess-123');
    expect(record.messages).toEqual([]);
  });

  it('sets selected_submission to null', () => {
    const record = buildSessionRecord('sess-123');
    expect(record.selected_submission).toBeNull();
  });

  it('populates created_at and updated_at with ISO timestamps', () => {
    const record = buildSessionRecord('sess-123');
    expect(record.created_at).toBe('2026-01-01T00:00:00.000Z');
    expect(record.updated_at).toBe('2026-01-01T00:00:00.000Z');
  });
});

// ── filterModels ──────────────────────────────────────────────

describe('filterModels', () => {
  const rawText = [
    '# Available models',
    'openai/gpt-4o',
    'anthropic/claude-3',
    '',
    '# Legacy',
    'openai/gpt-3.5-turbo',
  ].join('\n');

  it('parses models from text, skipping comments and blank lines', () => {
    const models = filterModels(rawText);
    expect(models).toEqual([
      'openai/gpt-4o',
      'anthropic/claude-3',
      'openai/gpt-3.5-turbo',
    ]);
  });

  it('filters to allowed models when allowedModels is provided', () => {
    const models = filterModels(rawText, ['openai/gpt-4o']);
    expect(models).toEqual(['openai/gpt-4o']);
  });

  it('returns all models when allowedModels is empty array', () => {
    const models = filterModels(rawText, []);
    expect(models).toEqual([
      'openai/gpt-4o',
      'anthropic/claude-3',
      'openai/gpt-3.5-turbo',
    ]);
  });

  it('returns all models when allowedModels is undefined', () => {
    const models = filterModels(rawText, undefined);
    expect(models).toEqual([
      'openai/gpt-4o',
      'anthropic/claude-3',
      'openai/gpt-3.5-turbo',
    ]);
  });

  it('returns empty array from empty text', () => {
    expect(filterModels('')).toEqual([]);
  });

  it('returns empty when no models match the allow list', () => {
    expect(filterModels(rawText, ['nonexistent/model'])).toEqual([]);
  });

  it('trims whitespace from model names', () => {
    const models = filterModels('  openai/gpt-4o  \n  anthropic/claude-3  ');
    expect(models).toEqual(['openai/gpt-4o', 'anthropic/claude-3']);
  });

  it('filters by allowedModelFamilies prefix', () => {
    const models = filterModels(rawText, undefined, ['openai']);
    expect(models).toEqual(['openai/gpt-4o', 'openai/gpt-3.5-turbo']);
  });

  it('supports multiple families in allowedModelFamilies', () => {
    const models = filterModels(rawText, undefined, ['openai', 'anthropic']);
    expect(models).toEqual(['openai/gpt-4o', 'anthropic/claude-3', 'openai/gpt-3.5-turbo']);
  });

  it('returns all models when allowedModelFamilies is empty array', () => {
    const models = filterModels(rawText, undefined, []);
    expect(models).toEqual(['openai/gpt-4o', 'anthropic/claude-3', 'openai/gpt-3.5-turbo']);
  });

  it('returns all models when allowedModelFamilies is undefined', () => {
    const models = filterModels(rawText, undefined, undefined);
    expect(models).toEqual(['openai/gpt-4o', 'anthropic/claude-3', 'openai/gpt-3.5-turbo']);
  });

  it('handles nested families like openrouter/deepseek', () => {
    const raw = 'openrouter/deepseek/v4\nopenrouter/google/gemini\nopenai/gpt-5';
    const models = filterModels(raw, undefined, ['openrouter/deepseek']);
    expect(models).toEqual(['openrouter/deepseek/v4']);
  });

  it('applies both allowedModels and allowedModelFamilies together', () => {
    const models = filterModels(rawText, ['openai/gpt-4o', 'anthropic/claude-3'], ['openai']);
    expect(models).toEqual(['openai/gpt-4o']);
  });
});
