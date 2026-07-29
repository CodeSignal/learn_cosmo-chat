#!/usr/bin/env node
/**
 * Refresh model-capabilities.json from OpenRouter + Octavus provider heuristics.
 *
 * Usage:
 *   node scripts/refresh-model-capabilities.mjs
 *
 * Reads current-models.txt, fetches https://openrouter.ai/api/v1/models, and
 * writes model-capabilities.json. On network failure, falls back to provider
 * heuristics only (with a console warning).
 *
 * Note: OpenRouter under-reports some models (e.g. Amazon Nova Premier has no
 * `reasoning` flag but still emits tagged <thinking> CoT when Octavus THINKING
 * is on). Override those with `thinkingModels` in chat-config.json.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizeModelId,
  openRouterEntrySupportsThinking,
  providerHeuristicSupportsThinking,
} from '../lib/model-capabilities.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MODELS_FILE = path.join(ROOT, 'current-models.txt');
const OUT_FILE = path.join(ROOT, 'model-capabilities.json');
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

function parseModelIds(raw) {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

async function fetchOpenRouterModels() {
  const res = await fetch(OPENROUTER_MODELS_URL, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`OpenRouter HTTP ${res.status}`);
  }
  const body = await res.json();
  const list = Array.isArray(body?.data) ? body.data : [];
  const byId = new Map();
  for (const entry of list) {
    if (entry?.id) byId.set(entry.id, entry);
  }
  return byId;
}

function computeSupportsThinking(modelId, openRouterById) {
  const openRouterId = normalizeModelId(modelId);
  const entry = openRouterById?.get(openRouterId);
  if (entry && openRouterEntrySupportsThinking(entry)) return true;
  if (providerHeuristicSupportsThinking(modelId)) return true;
  return false;
}

async function main() {
  const raw = await fs.readFile(MODELS_FILE, 'utf8');
  const modelIds = parseModelIds(raw);

  let openRouterById = null;
  let source = 'openrouter+octavus-provider-rules';
  try {
    openRouterById = await fetchOpenRouterModels();
    console.log(`Fetched ${openRouterById.size} OpenRouter models`);
  } catch (err) {
    console.warn(
      `[refresh-model-capabilities] OpenRouter fetch failed (${err.message}); falling back to provider heuristics only`,
    );
    source = 'octavus-provider-rules-fallback';
    openRouterById = new Map();
  }

  const models = {};
  let thinkingCount = 0;
  for (const id of modelIds) {
    const supportsThinking = computeSupportsThinking(id, openRouterById);
    models[id] = { supportsThinking };
    if (supportsThinking) thinkingCount += 1;
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    source,
    models,
  };

  await fs.writeFile(OUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(
    `Wrote ${OUT_FILE} (${modelIds.length} models, ${thinkingCount} with supportsThinking=true, source=${source})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
