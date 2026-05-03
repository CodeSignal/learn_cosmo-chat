import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { OctavusClient, toSSEStream } from '@octavus/server-sdk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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

// ── POST /api/sessions ────────────────────────────────────────
// Creates a new Octavus session and returns { sessionId }
app.post('/api/sessions', async (req, res) => {
  if (!AGENT_ID) {
    return res.status(503).json({ error: 'OCTAVUS_AGENT_ID is not configured' });
  }
  try {
    const sessionId = await octavus.agentSessions.create(AGENT_ID);
    res.json({ sessionId });
  } catch (err) {
    console.error('[sessions] Error creating session:', err);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

// ── POST /api/trigger ─────────────────────────────────────────
// Attaches to an existing session and streams the agent response as SSE
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
