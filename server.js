import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { OctavusClient, toSSEStream } from '@octavus/server-sdk';
import {
  deriveTitle,
  readJsonFile,
  writeJsonFile,
  buildSessionInput,
  buildSessionRecord,
  filterModels,
} from './lib/helpers.js';
import { usesBedrock } from './lib/provider.js';
import {
  createBedrockClient,
  isBedrockConfigured,
  bedrockRegion,
} from './lib/bedrock-client.js';
import {
  toConverseMessages,
  buildInferenceConfig,
  buildAdditionalModelRequestFields,
} from './lib/bedrock-messages.js';
import { streamAssistantReply, describeBedrockError } from './lib/bedrock-stream.js';
import { loadSystemPrompt } from './lib/system-prompt.js';
import {
  saveAttachment,
  readAttachmentBytes,
  deleteSessionAttachments,
  UPLOADS_URL_PREFIX,
} from './lib/attachments.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSIONS_FILE = path.join(__dirname, 'chat-sessions.json');
const CONFIG_FILE   = path.join(__dirname, 'chat-config.json');
const MODELS_FILE   = path.join(__dirname, 'current-models.txt');
const BEDROCK_MODELS_FILE = path.join(__dirname, 'current-models.bedrock.txt');
const PROMPT_FILE   = path.join(__dirname, 'prompts', 'system.md');
const UPLOADS_DIR   = path.join(__dirname, 'uploads');
const app = express();
const PORT = Number.parseInt(process.env.PORT ?? '3000', 10) || 3000;

// ── Octavus client ────────────────────────────────────────────
const octavus = new OctavusClient({
  baseUrl: process.env.OCTAVUS_API_URL,
  apiKey: process.env.OCTAVUS_API_KEY,
});

// Which deployed agent the server talks to. Defaults to "prod" so existing
// deployments that only set the legacy OCTAVUS_AGENT_ID keep hitting their
// production agent with no .env changes. Local development opts into the dev
// agent via `npm run dev` (which sets AGENT_TARGET=dev). When a target-specific
// ID is missing we fall back to the legacy OCTAVUS_AGENT_ID.
const AGENT_TARGET = (process.env.AGENT_TARGET ?? 'prod').toLowerCase();
if (AGENT_TARGET !== 'prod' && AGENT_TARGET !== 'dev') {
  throw new Error(
    `Invalid AGENT_TARGET "${process.env.AGENT_TARGET}". Expected "prod" or "dev".`,
  );
}
const AGENT_ID =
  (AGENT_TARGET === 'prod'
    ? process.env.OCTAVUS_AGENT_ID_PROD
    : process.env.OCTAVUS_AGENT_ID_DEV) ?? process.env.OCTAVUS_AGENT_ID;

// ── Bedrock client (only used when chat-config has useBedrock: true) ──
const bedrock = createBedrockClient();

// ── Middleware ────────────────────────────────────────────────
// Attachments for Bedrock arrive base64-encoded in the JSON body, so the limit
// has to allow for roughly 4/3 of the raw file size. Octavus uploads use
// presigned URLs and never hit this ceiling.
app.use(express.json({ limit: '32mb' }));
app.use('/design-system', express.static(path.join(__dirname, 'design-system')));
app.use(UPLOADS_URL_PREFIX, express.static(UPLOADS_DIR));
app.use(express.static(path.join(__dirname, 'public')));

// ── Config ────────────────────────────────────────────────────
const readConfig = () => readJsonFile(CONFIG_FILE);

app.get('/api/config', async (_req, res) => {
  const config = await readConfig();
  // Echo the resolved flag so the client can pick OctavusChat vs ChatStore
  // without re-deriving truthiness rules.
  res.json({ ...config, useBedrock: usesBedrock(config) });
});

// ── Models ─────────────────────────────────────────────────────
app.get('/api/models', async (_req, res) => {
  try {
    const config = await readConfig();
    const modelsPath = usesBedrock(config) ? BEDROCK_MODELS_FILE : MODELS_FILE;
    let raw;
    try {
      raw = await fs.readFile(modelsPath, 'utf8');
    } catch {
      // Bedrock courses without a synced list can still fall back to the
      // Octavus file; filterModels + allowedModels then decide what shows.
      raw = await fs.readFile(MODELS_FILE, 'utf8');
    }
    res.json({ models: filterModels(raw, config.allowedModels, config.allowedModelFamilies) });
  } catch {
    res.json({ models: [] });
  }
});

// ── Session file helpers ──────────────────────────────────────
async function readSessionsFile() {
  const data = await readJsonFile(SESSIONS_FILE, { sessions: [] });
  if (!Array.isArray(data.sessions)) data.sessions = [];
  return data;
}
const writeSessionsFile = (data) => writeJsonFile(SESSIONS_FILE, data);

async function createNewSession(options = {}) {
  const config = await readConfig();
  const input = buildSessionInput(options, config);

  let sessionId;
  if (usesBedrock(config)) {
    // Bedrock is stateless — mint a local id and persist generation settings
    // on the record so later turns can rebuild the Converse request.
    sessionId = randomUUID();
    console.log('[session] Creating Bedrock session with settings:', JSON.stringify(input));
  } else {
    console.log('[session] Creating Octavus session with input:', JSON.stringify(input));
    sessionId = await octavus.agentSessions.create(AGENT_ID, input);
  }

  const record = usesBedrock(config)
    ? buildSessionRecord(sessionId, input)
    : buildSessionRecord(sessionId);
  const data = await readSessionsFile();
  // With history hidden there is only ever one conversation; drop the rest.
  data.sessions = config.hideHistory ? [record] : [...data.sessions, record];
  await writeSessionsFile(data);
  return record;
}

function providerReady(config) {
  if (usesBedrock(config)) {
    return isBedrockConfigured()
      ? { ok: true }
      : { ok: false, error: 'Bedrock credentials are not configured' };
  }
  return AGENT_ID
    ? { ok: true }
    : { ok: false, error: 'OCTAVUS_AGENT_ID is not configured' };
}

// ── GET /api/sessions ─────────────────────────────────────────
app.get('/api/sessions', async (_req, res) => {
  const data = await readSessionsFile();
  const list = data.sessions
    .map((s) => ({
      session_id: s.session_id,
      title: deriveTitle(s.messages),
      created_at: s.created_at,
      updated_at: s.updated_at,
    }))
    .sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
  res.json({ sessions: list });
});

// ── GET /api/session ──────────────────────────────────────────
app.get('/api/session', async (req, res) => {
  const config = await readConfig();
  const ready = providerReady(config);
  if (!ready.ok) return res.status(503).json({ error: ready.error });

  const data = await readSessionsFile();

  if (req.query.id) {
    const session = data.sessions.find((s) => s.session_id === req.query.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    return res.json({ sessionId: session.session_id, messages: session.messages });
  }

  if (data.sessions.length > 0) {
    const latest = data.sessions.reduce((a, b) =>
      (a.updated_at || a.created_at) > (b.updated_at || b.created_at) ? a : b,
    );
    if (config.hideHistory && data.sessions.length > 1) {
      data.sessions = [latest];
      await writeSessionsFile(data);
    }
    return res.json({ sessionId: latest.session_id, messages: latest.messages });
  }

  try {
    const record = await createNewSession();
    res.json({ sessionId: record.session_id, messages: [] });
  } catch (err) {
    console.error('[session] Error creating session:', err);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

// ── POST /api/sessions ────────────────────────────────────────
app.post('/api/sessions', async (req, res) => {
  const config = await readConfig();
  const ready = providerReady(config);
  if (!ready.ok) return res.status(503).json({ error: ready.error });

  try {
    const record = await createNewSession({
      model: req.body.model,
      temperature: req.body.temperature,
      thinking: req.body.thinking,
    });
    res.json({ sessionId: record.session_id, messages: [] });
  } catch (err) {
    console.error('[sessions] Error creating session:', err);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

// ── DELETE /api/sessions/:sessionId ──────────────────────────
app.delete('/api/sessions/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const data = await readSessionsFile();
  data.sessions = data.sessions.filter((s) => s.session_id !== sessionId);
  await writeSessionsFile(data);
  // Local uploads only exist in Bedrock mode; force:true makes this a no-op otherwise.
  await deleteSessionAttachments(UPLOADS_DIR, sessionId).catch((err) =>
    console.warn('[sessions] Could not remove uploads:', err?.message),
  );
  res.json({ ok: true });
});

// ── POST /api/session/fork ────────────────────────────────────
app.post('/api/session/fork', async (req, res) => {
  const { oldSessionId, messages, model, temperature, thinking } = req.body;
  if (!oldSessionId || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'oldSessionId and messages[] are required' });
  }

  try {
    const record = await createNewSession({ model, temperature, thinking });
    const data = await readSessionsFile();

    const idx = data.sessions.findIndex((s) => s.session_id === record.session_id);
    if (idx >= 0) {
      data.sessions[idx].messages = messages;
      data.sessions[idx].updated_at = new Date().toISOString();
    }

    data.sessions = data.sessions.filter((s) => s.session_id !== oldSessionId);
    await writeSessionsFile(data);
    res.json({ sessionId: record.session_id });
  } catch (err) {
    console.error('[session/fork] Error:', err);
    res.status(500).json({ error: 'Failed to fork session' });
  }
});

// ── POST /api/session/save ────────────────────────────────────
app.post('/api/session/save', async (req, res) => {
  const { sessionId, messages } = req.body;
  if (!sessionId || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'sessionId and messages[] are required' });
  }

  try {
    const data = await readSessionsFile();
    const config = await readConfig();
    const idx = data.sessions.findIndex((s) => s.session_id === sessionId);
    const now = new Date().toISOString();

    if (idx >= 0) {
      data.sessions[idx].messages = messages;
      data.sessions[idx].updated_at = now;
    } else {
      data.sessions.push({
        session_id: sessionId,
        created_at: now,
        updated_at: now,
        messages,
        selected_submission: null,
      });
    }

    if (config.hideHistory) {
      data.sessions = data.sessions.filter((s) => s.session_id === sessionId);
    }

    await writeSessionsFile(data);
    res.json({ ok: true });
  } catch (err) {
    console.error('[session/save] Error:', err);
    res.status(500).json({ error: 'Failed to save session' });
  }
});

// ── POST /api/upload-urls (Octavus) ───────────────────────────
app.post('/api/upload-urls', async (req, res) => {
  const { sessionId, files } = req.body;
  if (!sessionId || !Array.isArray(files)) {
    return res.status(400).json({ error: 'sessionId and files[] are required' });
  }
  try {
    const result = await octavus.files.getUploadUrls(sessionId, files);
    res.json(result);
  } catch (err) {
    console.error('[upload-urls] Error:', err);
    res.status(500).json({ error: 'Failed to get upload URLs' });
  }
});

// ── POST /api/upload (Bedrock) ────────────────────────────────
app.post('/api/upload', async (req, res) => {
  const { sessionId, files } = req.body;
  if (!sessionId || !Array.isArray(files)) {
    return res.status(400).json({ error: 'sessionId and files[] are required' });
  }
  try {
    const refs = [];
    for (const file of files) {
      refs.push(await saveAttachment(UPLOADS_DIR, sessionId, file));
    }
    res.json({ files: refs });
  } catch (err) {
    console.error('[upload] Error:', err);
    res.status(500).json({ error: err.message || 'Failed to store attachments' });
  }
});

// ── POST /api/trigger ─────────────────────────────────────────
app.post('/api/trigger', async (req, res) => {
  const config = await readConfig();
  if (usesBedrock(config)) {
    return triggerBedrock(req, res, config);
  }
  return triggerOctavus(req, res);
});

async function triggerOctavus(req, res) {
  const { sessionId, ...payload } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId is required' });
  }

  const session = octavus.agentSessions.attach(sessionId);
  const events = session.execute(payload);
  const stream = toSSEStream(events);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } catch (err) {
    console.error('[trigger] Stream error:', err);
  } finally {
    reader.releaseLock();
    res.end();
  }
}

async function triggerBedrock(req, res, config) {
  const { sessionId, text = '', files = [], history = [] } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId is required' });
  }
  if (!isBedrockConfigured()) {
    return res.status(503).json({ error: 'Bedrock credentials are not configured' });
  }

  const data = await readSessionsFile();
  const session = data.sessions.find((s) => s.session_id === sessionId);
  const settings = session?.settings ?? buildSessionInput({}, config);

  const modelId = settings.MODEL || config.model;
  if (!modelId) {
    return res.status(500).json({ error: 'No model configured' });
  }

  const system = await loadSystemPrompt(PROMPT_FILE, {
    EXTRA_INSTRUCTIONS: settings.EXTRA_INSTRUCTIONS,
    VERBOSITY_INSTRUCTIONS: settings.VERBOSITY_INSTRUCTIONS,
  });

  const messages = await toConverseMessages(
    [...history, { role: 'user', content: text, files }],
    (file) => readAttachmentBytes(UPLOADS_DIR, file),
  );

  if (messages.length === 0) {
    return res.status(400).json({ error: 'Nothing to send' });
  }

  const controller = new AbortController();
  res.on('close', () => controller.abort());

  const events = streamAssistantReply(bedrock, {
    modelId,
    messages,
    system,
    inferenceConfig: buildInferenceConfig({
      temperature: settings.TEMPERATURE,
      thinking: settings.THINKING,
    }),
    additionalModelRequestFields: buildAdditionalModelRequestFields(settings.THINKING),
    abortSignal: controller.signal,
  })[Symbol.asyncIterator]();

  let first;
  try {
    first = await events.next();
  } catch (err) {
    if (controller.signal.aborted) return res.end();
    console.error('[trigger] Bedrock error:', err);
    return res.status(500).json({ error: describeBedrockError(err) });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);

  try {
    if (!first.done) {
      send(first.value);
      for await (const event of { [Symbol.asyncIterator]: () => events }) send(event);
    }
  } catch (err) {
    if (!controller.signal.aborted) {
      console.error('[trigger] Bedrock stream error:', err);
      send({ type: 'error', message: describeBedrockError(err) });
    }
  } finally {
    res.end();
  }
}

if (process.env.NODE_ENV !== 'test') {
  const server = app.listen(PORT, async () => {
    console.log(`ChatCPT running at http://localhost:${PORT}`);
    const config = await readConfig();
    if (usesBedrock(config)) {
      console.log(`[provider] bedrock (region=${bedrockRegion()})`);
      if (!isBedrockConfigured()) {
        console.warn(
          '[WARN] useBedrock is true but BEDROCK_AWS_ACCESS_KEY_ID / BEDROCK_AWS_SECRET_ACCESS_KEY are not set — chat will not work until they are configured (or set BEDROCK_AWS_USE_DEFAULT_CREDENTIALS=true).',
        );
      }
    } else {
      console.log(`[provider] octavus target=${AGENT_TARGET}${AGENT_ID ? ` (agent ${AGENT_ID})` : ''}`);
      if (!AGENT_ID) {
        const expected = `OCTAVUS_AGENT_ID_${AGENT_TARGET.toUpperCase()}`;
        console.warn(`[WARN] ${expected} is not set — chat will not work until it is configured.`);
      }
    }
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `Port ${PORT} is already in use. Stop the other dev server (or any app on that port), or run with a different port, e.g. PORT=3001 npm run dev`,
      );
    } else {
      console.error(err);
    }
    process.exit(1);
  });
}

export { app };
