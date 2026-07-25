/**
 * System prompt assembly.
 *
 * The prompt template used to be interpolated by the hosted agent platform;
 * it is now rendered here and passed to Converse as the `system` field.
 */

import fs from 'fs/promises';

/** Placeholders the template may contain, mapped to session input keys. */
const PLACEHOLDERS = {
  VERBOSITY_INSTRUCTIONS: 'Be clear, concise, and conversational',
  EXTRA_INSTRUCTIONS: '',
};

/**
 * Substitute `{{PLACEHOLDER}}` markers with session values, falling back to the
 * template defaults so an unset value never leaves a literal marker in the
 * prompt the model sees.
 * @param {string} template
 * @param {Record<string, string|undefined>} [values]
 * @returns {string}
 */
export function renderSystemPrompt(template, values = {}) {
  return Object.entries(PLACEHOLDERS).reduce((rendered, [key, fallback]) => {
    const value = values[key] ?? fallback;
    return rendered.replaceAll(`{{${key}}}`, value);
  }, template);
}

/**
 * Read and render the system prompt. Returns null when the template is missing
 * so the caller can fall back to sending no system prompt at all.
 * @param {string} templatePath
 * @param {Record<string, string|undefined>} [values]
 * @returns {Promise<string|null>}
 */
export async function loadSystemPrompt(templatePath, values = {}) {
  let template;
  try {
    template = await fs.readFile(templatePath, 'utf8');
  } catch {
    return null;
  }
  return renderSystemPrompt(template, values).trim();
}
