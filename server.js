import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { OctavusClient, toSSEStream } from '@octavus/server-sdk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSIONS_FILE = path.join(__dirname, 'chat-sessions.json');
const app = express();
const PORT = 3000;

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

// ── Session file helpers ──────────────────────────────────────
async function readSessionsFile() {
  try {
    const raw = await fs.readFile(SESSIONS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { sessions: [] };
  }
}

async function writeSessionsFile(data) {
  await fs.writeFile(SESSIONS_FILE, JSON.stringify(data, null, 2));
}

function deriveTitle(messages) {
  const first = messages?.find((m) => m.role === 'user');
  if (!first?.content) return 'New conversation';
  return first.content.length > 45 ? first.content.slice(0, 45) + '…' : first.content;
}

async function createNewSession() {
  const sessionId = await octavus.agentSessions.create(AGENT_ID);
  const record = {
    session_id: sessionId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    messages: [],
    selected_submission: null,
  };
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
    const record = await createNewSession();
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

app.listen(PORT, () => {
  console.log(`ChatCPT running at http://localhost:${PORT}`);
  if (!AGENT_ID) {
    console.warn('⚠  OCTAVUS_AGENT_ID is not set — chat will not work until it is configured.');
  }
});
