import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3000;

app.use(express.json());

// Serve the design system from the submodule
app.use('/design-system', express.static(path.join(__dirname, 'design-system')));

// Serve the frontend
app.use(express.static(path.join(__dirname, 'public')));

// --- API routes (stubbed for MVP shell) ---

// POST /api/chat — send a prompt, get a response
app.post('/api/chat', (req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

// POST /api/submit — mark a message as the final submission
app.post('/api/submit', (req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

// GET /api/session — return current session state
app.get('/api/session', (req, res) => {
  res.json({ messages: [], selectedSubmission: null });
});

app.listen(PORT, () => {
  console.log(`ChatCPT running at http://localhost:${PORT}`);
});
