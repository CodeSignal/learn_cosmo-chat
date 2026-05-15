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

export function buildSessionInput(options = {}, config = {}) {
  const input = {};
  const model = options.model || config.model;
  if (model) input.MODEL = model;
  if (config.systemPromptExtra) input.EXTRA_INSTRUCTIONS = config.systemPromptExtra;
  const thinking = options.thinking ?? config.thinking ?? 'off';
  input.THINKING = thinking;
  if (thinking === 'off') {
    const temperature = options.temperature ?? config.temperature;
    if (temperature !== undefined) input.TEMPERATURE = temperature;
  }
  return input;
}

export function buildSessionRecord(sessionId) {
  return {
    session_id: sessionId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
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
    models = models.filter((m) =>
      allowedModelFamilies.some((fam) => m.startsWith(fam + '/') || m === fam),
    );
  }
  return models;
}
