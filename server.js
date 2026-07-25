import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import {
  deriveTitle,
  readJsonFile,
  writeJsonFile,
  buildSessionInput,
  buildSessionRecord,
  filterModels,
} from './lib/helpers.js';
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
const PROMPT_FILE   = path.join(__dirname, 'prompts', 'system.md');
const UPLOADS_DIR   = path.join(__dirname, 'uploads');
const app = express();
const PORT = Number.parseInt(process.env.PORT ?? '3000', 10) || 3000;

// ── Bedrock client ────────────────────────────────────────────
const bedrock = createBedrockClient();

// ── Middleware ────────────────────────────────────────────────
// Attachments arrive base64-encoded in the JSON body, so the limit has to allow
// for roughly 4/3 of the raw file size.
app.use(express.json({ limit: '32mb' }));
app.use('/design-system', express.static(path.join(__dirname, 'design-system')));
app.use(UPLOADS_URL_PREFIX, express.static(UPLOADS_DIR));
app.use(express.static(path.join(__dirname, 'public')));

// ── Config ────────────────────────────────────────────────────
const readConfig = () => readJsonFile(CONFIG_FILE);

app.get('/api/config', async (_req, res) => {
  res.json(await readConfig());
});

// ── Models ─────────────────────────────────────────────────────
app.get('/api/models', async (_req, res) => {
  try {
    const [raw, config] = await Promise.all([
      fs.readFile(MODELS_FILE, 'utf8'),
      readConfig(),
    ]);
    res.json({ models: filterModels(raw, config.allowedModels, config.allowedModelFamilies) });
  } catch {
    res.json({ models: [] });
  }
});

// ── Session file helpers ──────────────────────────────────────
// readJsonFile only falls back when the read or parse fails, so a file that
// parses to something without a `sessions` array still needs normalizing.
async function readSessionsFile() {
  const data = await readJsonFile(SESSIONS_FILE, { sessions: [] });
  if (!Array.isArray(data.sessions)) data.sessions = [];
  return data;
}
const writeSessionsFile = (data) => writeJsonFile(SESSIONS_FILE, data);

// Sessions are local records now: there is no remote session to create, so the
// id is minted here and the generation settings ride along on the record.
async function createNewSession(options = {}) {
  const config = await readConfig();
  const settings = buildSessionInput(options, config);
  const record = buildSessionRecord(randomUUID(), settings);
  const data = await readSessionsFile();
  // With history hidden there is only ever one conversation; drop the rest.
  data.sessions = config.hideHistory ? [record] : [...data.sessions, record];
  await writeSessionsFile(data);
  return record;
}

// ── GET /api/sessions ─────────────────────────────────────────
// Lists all sessions (id, title, timestamps) sorted newest first.
app.get('/api/sessions', async (req, res) => {
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
// Returns a specific session by ?id=, the most recently updated, or creates one.
app.get('/api/session', async (req, res) => {
  if (!isBedrockConfigured()) {
    return res.status(503).json({ error: 'Bedrock credentials are not configured' });
  }

  const data = await readSessionsFile();
  const config = await readConfig();

  // Load a specific session when ?id= is provided
  if (req.query.id) {
    const session = data.sessions.find((s) => s.session_id === req.query.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    return res.json({ sessionId: session.session_id, messages: session.messages });
  }

  // Resume the most recently updated session
  if (data.sessions.length > 0) {
    const latest = data.sessions.reduce((a, b) =>
      (a.updated_at || a.created_at) > (b.updated_at || b.created_at) ? a : b,
    );
    // With history hidden, keep only the resumed session; discard any others.
    if (config.hideHistory && data.sessions.length > 1) {
      data.sessions = [latest];
      await writeSessionsFile(data);
    }
    return res.json({ sessionId: latest.session_id, messages: latest.messages });
  }

  // No stored session — create one
  try {
    const record = await createNewSession();
    res.json({ sessionId: record.session_id, messages: [] });
  } catch (err) {
    console.error('[session] Error creating session:', err);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

// ── POST /api/sessions ────────────────────────────────────────
// Creates a brand-new local session record and adds it to the file.
app.post('/api/sessions', async (req, res) => {
  if (!isBedrockConfigured()) {
    return res.status(503).json({ error: 'Bedrock credentials are not configured' });
  }
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
  await deleteSessionAttachments(UPLOADS_DIR, sessionId).catch((err) =>
    console.warn('[sessions] Could not remove uploads:', err?.message),
  );
  res.json({ ok: true });
});

// ── POST /api/session/fork ────────────────────────────────────
// Creates a new session, seeds it with the supplied messages, and removes the
// old session record. Used by regenerate / edit-and-resend.
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
// Receives the full serialised message list and writes it into chat-sessions.json.
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

    // With history hidden, only the current conversation is ever persisted.
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

// ── POST /api/upload ──────────────────────────────────────────
// Stores base64 attachments on disk and returns the refs the client keeps in
// the transcript. Their bytes are re-read and inlined on every Converse turn.
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
// Streams one assistant turn from Bedrock as SSE.
//
// The client sends the conversation it is displaying rather than the server
// reading it back from disk: transcript writes are throttled, so the on-disk
// copy can lag the newest turn, and regenerate/edit need to replay a
// deliberately truncated history.
app.post('/api/trigger', async (req, res) => {
  const { sessionId, text = '', files = [], history = [] } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId is required' });
  }
  if (!isBedrockConfigured()) {
    return res.status(503).json({ error: 'Bedrock credentials are not configured' });
  }

  const config = await readConfig();
  const data = await readSessionsFile();
  const session = data.sessions.find((s) => s.session_id === sessionId);
  // A session created before this request should always be on disk; falling back
  // to config defaults keeps a stale client from failing outright.
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

  // Stop paying for tokens the moment the browser goes away (tab closed, or the
  // user pressed stop, which aborts the fetch).
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

  // Pull the first event before committing to a 200 + event-stream response.
  // The setup failures that matter most — bad credentials, model access not
  // granted, unknown model id, a malformed request — all surface here, and
  // they deserve a real status code rather than an error buried in the stream.
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
});

if (process.env.NODE_ENV !== 'test') {
  const server = app.listen(PORT, () => {
    console.log(`ChatCPT running at http://localhost:${PORT}`);
    console.log(`[bedrock] region=${bedrockRegion()}`);
    if (!isBedrockConfigured()) {
      console.warn(
        '[WARN] BEDROCK_AWS_ACCESS_KEY_ID / BEDROCK_AWS_SECRET_ACCESS_KEY are not set — chat will not work until they are configured (or set BEDROCK_AWS_USE_DEFAULT_CREDENTIALS=true to use an IAM role).',
      );
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
