import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'fs/promises';
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSIONS_FILE = path.join(__dirname, 'chat-sessions.json');
const CONFIG_FILE   = path.join(__dirname, 'chat-config.json');
const MODELS_FILE   = path.join(__dirname, 'current-models.txt');
const app = express();
const PORT = Number.parseInt(process.env.PORT ?? '3000', 10) || 3000;

// ── Octavus client ────────────────────────────────────────────
const octavus = new OctavusClient({
  baseUrl: process.env.OCTAVUS_API_URL,
  apiKey: process.env.OCTAVUS_API_KEY,
});

const AGENT_ID = process.env.OCTAVUS_AGENT_ID;

// ── Middleware ────────────────────────────────────────────────
app.use(express.json());
app.use('/design-system', express.static(path.join(__dirname, 'design-system')));
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
const readSessionsFile = () => readJsonFile(SESSIONS_FILE, { sessions: [] });
const writeSessionsFile = (data) => writeJsonFile(SESSIONS_FILE, data);

async function createNewSession(options = {}) {
  const config = await readConfig();
  const input = buildSessionInput(options, config);
  console.log('[session] Creating with input:', JSON.stringify(input));
  const sessionId = await octavus.agentSessions.create(AGENT_ID, input);
  const record = buildSessionRecord(sessionId);
  const data = await readSessionsFile();
  data.sessions.push(record);
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
  if (!AGENT_ID) {
    return res.status(503).json({ error: 'OCTAVUS_AGENT_ID is not configured' });
  }

  const data = await readSessionsFile();

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
// Creates a brand-new Octavus session and adds it to the file.
app.post('/api/sessions', async (req, res) => {
  if (!AGENT_ID) {
    return res.status(503).json({ error: 'OCTAVUS_AGENT_ID is not configured' });
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
  res.json({ ok: true });
});

// ── POST /api/session/fork ────────────────────────────────────
// Creates a new Octavus session, seeds it with the supplied messages, and
// removes the old session record.  Used by regenerate / edit-and-resend.
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

    await writeSessionsFile(data);
    res.json({ ok: true });
  } catch (err) {
    console.error('[session/save] Error:', err);
    res.status(500).json({ error: 'Failed to save session' });
  }
});

// ── POST /api/upload-urls ─────────────────────────────────────
// Proxies presigned S3 upload URL requests to Octavus.
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

// ── POST /api/trigger ─────────────────────────────────────────
// Attaches to an existing session and streams the agent response as SSE.
app.post('/api/trigger', async (req, res) => {
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
});

if (process.env.NODE_ENV !== 'test') {
  const server = app.listen(PORT, () => {
    console.log(`ChatCPT running at http://localhost:${PORT}`);
    if (!AGENT_ID) {
      console.warn('[WARN] OCTAVUS_AGENT_ID is not set — chat will not work until it is configured.');
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
