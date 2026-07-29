import { describe, it, expect } from 'vitest';
import { extractEmbeddedThinking } from '../lib/thinking.js';

describe('extractEmbeddedThinking', () => {
  it('returns empty parts for blank input', () => {
    expect(extractEmbeddedThinking('')).toEqual({
      reasoning: '',
      answer: '',
      thinkingOpen: false,
    });
  });

  it('leaves plain answers untouched', () => {
    expect(extractEmbeddedThinking('Hello!\n\nHere is the answer.')).toEqual({
      reasoning: '',
      answer: 'Hello!\n\nHere is the answer.',
      thinkingOpen: false,
    });
  });

  it('splits complete <thinking> blocks from the answer', () => {
    const text = `<thinking>
Plan the reply.
</thinking>

Hi there! Here is the challenge.`;
    expect(extractEmbeddedThinking(text)).toEqual({
      reasoning: 'Plan the reply.',
      answer: 'Hi there! Here is the challenge.',
      thinkingOpen: false,
    });
  });

  it('supports DeepSeek-style <think> tags', () => {
    const text = `<think>step one</think>\n\nFinal answer.`;
    expect(extractEmbeddedThinking(text)).toEqual({
      reasoning: 'step one',
      answer: 'Final answer.',
      thinkingOpen: false,
    });
  });

  it('treats an unclosed thinking tag as still streaming', () => {
    const text = `<thinking>\nStill reasoning about the prompt`;
    expect(extractEmbeddedThinking(text)).toEqual({
      reasoning: 'Still reasoning about the prompt',
      answer: '',
      thinkingOpen: true,
    });
  });

  it('joins multiple thinking blocks', () => {
    const text = `<thinking>a</thinking>\nmid\n<think>b</think>\nend`;
    expect(extractEmbeddedThinking(text)).toEqual({
      reasoning: 'a\n\nb',
      answer: 'mid\n\nend',
      thinkingOpen: false,
    });
  });
});
