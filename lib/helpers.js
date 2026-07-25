import fs from 'fs/promises';

export function deriveTitle(messages) {
  const first = messages?.find((m) => m.role === 'user');
  if (!first?.content) return 'New conversation';
  return first.content.length > 45 ? first.content.slice(0, 45) + '…' : first.content;
}

export async function readJsonFile(filePath, fallback = {}) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export async function writeJsonFile(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

// Maps each verbosity level to the directive appended to the system prompt.
// A `null` or absent verbosity sends no VERBOSITY_INSTRUCTIONS, so the protocol
// falls back to its own default directive (see protocol.yaml) rather than
// leaving the prompt unchanged.
export const VERBOSITY_LEVELS = {
  concise:
    'Be extremely terse. Answer in the fewest words possible — ideally a single sentence or a couple of short bullets. Give ONLY the direct answer with no preamble, no restating the question, no summary, no pleasantries, and no caveats unless absolutely critical. Never explain unless explicitly asked. Do not add examples, context, or follow-up suggestions. If a one-word answer suffices, give one word.',
  normal:
    'Keep responses short and focused — typically a few sentences or a short paragraph, and no more than one brief example only when it is truly needed. Answer the question directly without expanding into reasoning, edge cases, or follow-up suggestions. This level should be noticeably shorter than a detailed response.',
  detailed:
    'Provide a thorough, multi-paragraph response. Go well beyond a normal answer: explain your reasoning, include several relevant examples, cover important edge cases and caveats, and offer helpful follow-up suggestions. This level should be clearly longer and more comprehensive than a normal response.',
  verbose:
    'Provide an exhaustive, deep-dive response that goes well beyond a detailed answer — treat it like a comprehensive tutorial or reference article. Use clear section headings to organize a long response. Explain every concept from first principles, define terminology as you go, and assume no prior knowledge. Walk through your reasoning step by step, include many worked examples along with counter-examples and common pitfalls, and cover edge cases, caveats, trade-offs, and relevant background or history. Compare alternative approaches where applicable, and finish with a summary, practical next steps, and suggestions for further reading. Be as complete and elaborate as possible; this is the longest and most thorough level and should be substantially longer than a detailed response.',
};

// Resolves the effective verbosity: options override config. When neither
// provides a value the result is `undefined`, so no VERBOSITY_INSTRUCTIONS is
// produced and the prompt template's own default directive applies. An explicit
// `null` likewise injects nothing.
export function resolveVerbosity(options = {}, config = {}) {
  if (options.verbosity !== undefined) return options.verbosity;
  return config.verbosity;
}

// Resolves per-session generation settings from request options layered over
// chat-config.json. The SCREAMING_CASE keys double as the placeholder names in
// prompts/system.md. Temperature is dropped when extended reasoning is on,
// because Anthropic models reject a custom temperature in that mode.
export function buildSessionInput(options = {}, config = {}) {
  const input = {};
  const model = options.model || config.model;
  if (model) input.MODEL = model;
  if (config.systemPromptExtra) input.EXTRA_INSTRUCTIONS = config.systemPromptExtra;
  const verbosity = resolveVerbosity(options, config);
  if (Object.prototype.hasOwnProperty.call(VERBOSITY_LEVELS, verbosity)) {
    input.VERBOSITY_INSTRUCTIONS = VERBOSITY_LEVELS[verbosity];
  }
  const thinking = options.thinking ?? config.thinking ?? 'off';
  input.THINKING = thinking;
  if (thinking === 'off') {
    const temperature = options.temperature ?? config.temperature;
    if (temperature !== undefined) input.TEMPERATURE = temperature;
  }
  return input;
}

// Model/temperature/thinking are recorded on the session because Bedrock is
// stateless: every turn re-sends them, so they must survive a page reload.
export function buildSessionRecord(sessionId, settings = {}) {
  return {
    session_id: sessionId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    settings,
    messages: [],
    selected_submission: null,
  };
}

export function filterModels(rawText, allowedModels, allowedModelFamilies) {
  let models = rawText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  if (Array.isArray(allowedModels) && allowedModels.length > 0) {
    const allowed = new Set(allowedModels);
    models = models.filter((m) => allowed.has(m));
  }
  if (Array.isArray(allowedModelFamilies) && allowedModelFamilies.length > 0) {
    // Families match on either separator so the same config works for
    // `provider/model` ids and Bedrock's dotted `us.provider.model` ids.
    models = models.filter((m) =>
      allowedModelFamilies.some(
        (fam) => m === fam || m.startsWith(fam + '/') || m.includes('.' + fam + '.'),
      ),
    );
  }
  return models;
}
