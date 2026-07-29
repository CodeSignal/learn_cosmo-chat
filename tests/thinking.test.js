import { describe, it, expect } from 'vitest';
import {
  extractEmbeddedThinking,
  resolveAssistantContent,
  splitMarkdownCodeSegments,
} from '../lib/thinking.js';

describe('splitMarkdownCodeSegments', () => {
  it('keeps fenced and inline code as code segments', () => {
    const text = 'See `<thinking>` and:\n\n```xml\n<thinking>demo</thinking>\n```\n\ndone';
    const segs = splitMarkdownCodeSegments(text);
    expect(segs.filter((s) => s.type === 'code').map((s) => s.value)).toEqual([
      '`<thinking>`',
      '```xml\n<thinking>demo</thinking>\n```',
    ]);
  });
});

describe('extractEmbeddedThinking', () => {
  it('returns empty parts for blank input', () => {
    expect(extractEmbeddedThinking('')).toEqual({
      reasoning: '',
      answer: '',
      thinkingOpen: false,
    });
  });

  it('leaves plain answers untouched, including leading indentation', () => {
    expect(extractEmbeddedThinking('    code')).toEqual({
      reasoning: '',
      answer: '    code',
      thinkingOpen: false,
    });
  });

  it('splits complete <thinking> blocks from the answer (Nova-style)', () => {
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

  it('does not peel tags inside fenced or inline code (Brian educational case)', () => {
    const text = `Models stream thinking like this:

\`\`\`
<thinking>
internal plan
</thinking>
\`\`\`

Also inline: \`<think>secret</think>\`.

Then the real answer.`;
    const result = extractEmbeddedThinking(text);
    expect(result.reasoning).toBe('');
    expect(result.thinkingOpen).toBe(false);
    expect(result.answer).toContain('<thinking>');
    expect(result.answer).toContain('internal plan');
    expect(result.answer).toContain('`<think>secret</think>`');
    expect(result.answer).toContain('Then the real answer.');
  });

  it('peels leading tags but keeps tags that only appear inside code later', () => {
    const text = `<thinking>real cot</thinking>

Here is an example:

\`\`\`
<thinking>example only</thinking>
\`\`\`
`;
    const result = extractEmbeddedThinking(text);
    expect(result.reasoning).toBe('real cot');
    expect(result.answer).toContain('```\n<thinking>example only</thinking>\n```');
    expect(result.answer).not.toContain('real cot');
  });
});

describe('resolveAssistantContent', () => {
  it('prefers Octavus reasoning parts and leaves text alone', () => {
    const text = `<thinking>should not peel</thinking>\n\nAnswer`;
    expect(
      resolveAssistantContent({
        text,
        reasoningFromParts: 'structured cot',
      }),
    ).toEqual({
      reasoning: 'structured cot',
      answer: text,
      thinkingOpen: false,
      source: 'octavus',
    });
  });

  it('falls back to embedded peel when there are no reasoning parts', () => {
    const text = `<thinking>nova cot</thinking>\n\nHi there!`;
    expect(resolveAssistantContent({ text })).toEqual({
      reasoning: 'nova cot',
      answer: 'Hi there!',
      thinkingOpen: false,
      source: 'embedded',
    });
  });

  it('uses octavus source while reasoning is still streaming even if text is empty', () => {
    expect(
      resolveAssistantContent({
        text: '',
        reasoningFromParts: '',
        reasoningStreaming: true,
      }),
    ).toEqual({
      reasoning: '',
      answer: '',
      thinkingOpen: false,
      source: 'octavus',
    });
  });
});
