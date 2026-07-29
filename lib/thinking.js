/**
 * Split assistant text that embeds chain-of-thought in tags
 * (`<thinking>…</thinking>` / `<think>…</think>`) instead of (or in addition
 * to) Octavus `reasoning` parts. Browsers treat those as unknown HTML elements,
 * so the tags vanish and thoughts look like the answer.
 *
 * Handles an unclosed open tag while the thought is still streaming.
 *
 * @param {string} text
 * @returns {{ reasoning: string, answer: string, thinkingOpen: boolean }}
 */
export function extractEmbeddedThinking(text) {
  if (!text) return { reasoning: '', answer: '', thinkingOpen: false };

  const completeRe = /<(thinking|think)>([\s\S]*?)<\/\1>/gi;
  const parts = [];
  let lastIndex = 0;
  let match;
  while ((match = completeRe.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    parts.push({ type: 'thinking', value: match[2] });
    lastIndex = match.index + match[0].length;
  }

  const rest = text.slice(lastIndex);
  const openMatch = /<(thinking|think)>([\s\S]*)$/i.exec(rest);
  let thinkingOpen = false;
  if (openMatch) {
    if (openMatch.index > 0) {
      parts.push({ type: 'text', value: rest.slice(0, openMatch.index) });
    }
    parts.push({ type: 'thinking', value: openMatch[2] });
    thinkingOpen = true;
  } else if (rest) {
    parts.push({ type: 'text', value: rest });
  }

  return {
    reasoning: parts
      .filter((p) => p.type === 'thinking')
      .map((p) => p.value)
      .join('\n\n')
      .trim(),
    answer: parts
      .filter((p) => p.type === 'text')
      .map((p) => p.value)
      .join('')
      .replace(/^\s+/, ''),
    thinkingOpen,
  };
}
