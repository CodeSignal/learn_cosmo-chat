import { describe, it, expect } from 'vitest';
import {
  normalizeModelId,
  supportsThinking,
  supportsThinkingFromMap,
  openRouterEntrySupportsThinking,
  providerHeuristicSupportsThinking,
  buildCapabilitiesPayload,
  loadCapabilities,
} from '../lib/model-capabilities.js';

describe('normalizeModelId', () => {
  it('strips the openrouter/ prefix', () => {
    expect(normalizeModelId('openrouter/deepseek/deepseek-r1')).toBe('deepseek/deepseek-r1');
  });

  it('leaves direct provider ids unchanged', () => {
    expect(normalizeModelId('anthropic/claude-sonnet-4-6')).toBe('anthropic/claude-sonnet-4-6');
  });
});

describe('openRouterEntrySupportsThinking', () => {
  it('detects reasoning / include_reasoning in supported_parameters', () => {
    expect(openRouterEntrySupportsThinking({ supported_parameters: ['reasoning'] })).toBe(true);
    expect(openRouterEntrySupportsThinking({ supported_parameters: ['include_reasoning'] })).toBe(true);
    expect(openRouterEntrySupportsThinking({ supported_parameters: ['temperature'] })).toBe(false);
  });

  it('detects a non-null reasoning object', () => {
    expect(openRouterEntrySupportsThinking({ reasoning: { max_tokens: 1024 } })).toBe(true);
    expect(openRouterEntrySupportsThinking({ reasoning: null })).toBe(false);
  });
});

describe('providerHeuristicSupportsThinking', () => {
  it('matches Octavus-aligned Anthropic / OpenAI / Google families', () => {
    expect(providerHeuristicSupportsThinking('anthropic/claude-sonnet-4-6')).toBe(true);
    expect(providerHeuristicSupportsThinking('openai/o3')).toBe(true);
    expect(providerHeuristicSupportsThinking('openai/gpt-5')).toBe(true);
    expect(providerHeuristicSupportsThinking('google/gemini-2.5-flash')).toBe(true);
    expect(providerHeuristicSupportsThinking('google/gemini-3-pro-preview')).toBe(true);
  });

  it('does not treat Amazon Nova or plain GPT-4o as thinking by heuristic', () => {
    expect(providerHeuristicSupportsThinking('openrouter/amazon/nova-premier-v1')).toBe(false);
    expect(providerHeuristicSupportsThinking('openai/gpt-4o')).toBe(false);
    expect(providerHeuristicSupportsThinking('openrouter/meta-llama/llama-4-maverick')).toBe(false);
  });
});

describe('supportsThinkingFromMap', () => {
  const map = {
    'openrouter/deepseek/deepseek-r1': { supportsThinking: true },
    'openrouter/amazon/nova-premier-v1': { supportsThinking: false },
    'anthropic/claude-sonnet-4-6': { supportsThinking: true },
  };

  it('looks up by raw id and openrouter-stripped id', () => {
    expect(supportsThinkingFromMap('openrouter/deepseek/deepseek-r1', map)).toBe(true);
    expect(supportsThinkingFromMap('deepseek/deepseek-r1', map)).toBe(true);
    expect(supportsThinkingFromMap('openrouter/amazon/nova-premier-v1', map)).toBe(false);
    expect(supportsThinkingFromMap('anthropic/claude-sonnet-4-6', map)).toBe(true);
  });

  it('returns undefined when the model is absent', () => {
    expect(supportsThinkingFromMap('openai/gpt-4o', map)).toBeUndefined();
  });
});

describe('supportsThinking', () => {
  const openRouterStyleMap = {
    'openrouter/deepseek/deepseek-r1': { supportsThinking: true },
    'openrouter/amazon/nova-premier-v1': { supportsThinking: false },
    'openrouter/meta-llama/llama-4-maverick': { supportsThinking: false },
    'anthropic/claude-sonnet-4-6': { supportsThinking: true },
    'openai/o3': { supportsThinking: true },
    'openai/gpt-4o': { supportsThinking: false },
  };

  it('prefers the capabilities map over heuristics', () => {
    expect(supportsThinking('openrouter/deepseek/deepseek-r1', {}, openRouterStyleMap)).toBe(true);
    expect(supportsThinking('openrouter/amazon/nova-premier-v1', {}, openRouterStyleMap)).toBe(false);
    expect(supportsThinking('openrouter/meta-llama/llama-4-maverick', {}, openRouterStyleMap)).toBe(false);
  });

  it('falls back to provider heuristics when the map has no entry', () => {
    expect(supportsThinking('anthropic/claude-haiku-4-5', {}, {})).toBe(true);
    expect(supportsThinking('openai/gpt-4o', {}, {})).toBe(false);
  });

  it('honors thinkingModels allowlist and noThinkingModels denylist over the map', () => {
    expect(
      supportsThinking(
        'openrouter/amazon/nova-premier-v1',
        { thinkingModels: ['openrouter/amazon/nova-premier-v1'] },
        openRouterStyleMap,
      ),
    ).toBe(true);
    expect(
      supportsThinking(
        'openrouter/meta-llama/llama-4-maverick',
        { thinkingModels: ['openrouter/meta-llama/llama-4-maverick'] },
        openRouterStyleMap,
      ),
    ).toBe(true);
    expect(
      supportsThinking(
        'anthropic/claude-sonnet-4-6',
        { noThinkingModels: ['anthropic/claude-sonnet-4-6'] },
        openRouterStyleMap,
      ),
    ).toBe(false);
  });

  it('denylist wins over allowlist', () => {
    expect(
      supportsThinking('anthropic/claude-sonnet-4-6', {
        thinkingModels: ['anthropic/claude-sonnet-4-6'],
        noThinkingModels: ['anthropic/claude-sonnet-4-6'],
      }),
    ).toBe(false);
  });
});

describe('buildCapabilitiesPayload', () => {
  it('builds a per-id map with overrides applied', () => {
    const payload = buildCapabilitiesPayload(
      ['openrouter/amazon/nova-premier-v1', 'anthropic/claude-sonnet-4-6'],
      { thinkingModels: ['openrouter/amazon/nova-premier-v1'] },
      {
        'openrouter/amazon/nova-premier-v1': { supportsThinking: false },
        'anthropic/claude-sonnet-4-6': { supportsThinking: true },
      },
    );
    expect(payload).toEqual({
      'openrouter/amazon/nova-premier-v1': { supportsThinking: true },
      'anthropic/claude-sonnet-4-6': { supportsThinking: true },
    });
  });
});

describe('loadCapabilities', () => {
  it('parses a capabilities file via injected reader', async () => {
    const data = await loadCapabilities('/fake/path.json', {
      readFile: async () =>
        JSON.stringify({
          generatedAt: '2026-07-29T00:00:00.000Z',
          source: 'openrouter+octavus-provider-rules',
          models: { 'openai/o3': { supportsThinking: true } },
        }),
    });
    expect(data.source).toBe('openrouter+octavus-provider-rules');
    expect(data.models['openai/o3']).toEqual({ supportsThinking: true });
  });

  it('returns an empty map when the file is missing', async () => {
    const data = await loadCapabilities('/missing.json', {
      readFile: async () => {
        throw new Error('ENOENT');
      },
    });
    expect(data).toEqual({ generatedAt: null, source: 'missing', models: {} });
  });
});
