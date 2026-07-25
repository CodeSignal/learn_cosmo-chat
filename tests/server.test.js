import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// Mock external deps before importing server
vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    rm: vi.fn(),
  },
}));

vi.mock('@octavus/server-sdk', () => {
  return {
    OctavusClient: function () {
      this.agentSessions = {
        create: vi.fn().mockResolvedValue('new-session-id'),
        attach: vi.fn().mockReturnValue({ execute: vi.fn() }),
      };
      this.files = {
        getUploadUrls: vi.fn().mockResolvedValue({ urls: [] }),
      };
    },
    toSSEStream: vi.fn(),
  };
});

vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: function () {
    this.send = vi.fn();
  },
  ConverseStreamCommand: function (input) {
    this.input = input;
  },
}));

vi.mock('dotenv/config', () => ({}));

const fs = (await import('fs/promises')).default;

process.env.NODE_ENV = 'test';
process.env.OCTAVUS_API_URL = 'https://test.api';
process.env.OCTAVUS_API_KEY = 'test-key';
process.env.OCTAVUS_AGENT_ID = 'test-agent-id';
process.env.BEDROCK_AWS_ACCESS_KEY_ID = 'test-access-key-id';
process.env.BEDROCK_AWS_SECRET_ACCESS_KEY = 'test-secret-access-key';
process.env.BEDROCK_AWS_REGION = 'us-east-1';

const { app } = await import('../server.js');

/** Default course config: Octavus (useBedrock omitted). */
function mockOctavusConfig(extra = {}) {
  fs.readFile.mockImplementation((path) => {
    if (path.includes('chat-config')) {
      return Promise.resolve(JSON.stringify({ model: 'anthropic/claude-3', ...extra }));
    }
    if (path.includes('current-models')) {
      return Promise.resolve('openai/gpt-4o\nanthropic/claude-3\n');
    }
    if (path.includes('chat-sessions')) {
      return Promise.resolve(JSON.stringify({ sessions: [] }));
    }
    return Promise.reject(new Error('ENOENT'));
  });
}

// ── GET /api/config ───────────────────────────────────────────

describe('GET /api/config', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns parsed config and useBedrock: false by default', async () => {
    fs.readFile.mockResolvedValue(JSON.stringify({ model: 'openai/gpt-4o', temperature: 0.5 }));
    const res = await request(app).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ model: 'openai/gpt-4o', temperature: 0.5, useBedrock: false });
  });

  it('echoes useBedrock: true when the course opts in', async () => {
    fs.readFile.mockResolvedValue(JSON.stringify({ useBedrock: true, model: 'us.amazon.nova-2-lite-v1:0' }));
    const res = await request(app).get('/api/config');
    expect(res.body.useBedrock).toBe(true);
  });

  it('returns useBedrock: false when config file is missing', async () => {
    fs.readFile.mockRejectedValue(new Error('ENOENT'));
    const res = await request(app).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ useBedrock: false });
  });
});

// ── GET /api/models ───────────────────────────────────────────

describe('GET /api/models', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns parsed models from text file', async () => {
    mockOctavusConfig();
    const res = await request(app).get('/api/models');
    expect(res.status).toBe(200);
    expect(res.body.models).toEqual(['openai/gpt-4o', 'anthropic/claude-3']);
  });

  it('filters models by allowedModels config', async () => {
    mockOctavusConfig({ allowedModels: ['openai/gpt-4o'] });
    const res = await request(app).get('/api/models');
    expect(res.status).toBe(200);
    expect(res.body.models).toEqual(['openai/gpt-4o']);
  });

  it('returns empty array when models file is missing', async () => {
    fs.readFile.mockRejectedValue(new Error('ENOENT'));
    const res = await request(app).get('/api/models');
    expect(res.status).toBe(200);
    expect(res.body.models).toEqual([]);
  });
});

// ── GET /api/sessions ─────────────────────────────────────────

describe('GET /api/sessions', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns sessions sorted newest first', async () => {
    const sessions = {
      sessions: [
        { session_id: 'old', created_at: '2026-01-01', updated_at: '2026-01-01', messages: [{ role: 'user', content: 'Old chat' }] },
        { session_id: 'new', created_at: '2026-06-01', updated_at: '2026-06-01', messages: [{ role: 'user', content: 'New chat' }] },
      ],
    };
    fs.readFile.mockResolvedValue(JSON.stringify(sessions));
    const res = await request(app).get('/api/sessions');
    expect(res.status).toBe(200);
    expect(res.body.sessions).toHaveLength(2);
    expect(res.body.sessions[0].session_id).toBe('new');
    expect(res.body.sessions[1].session_id).toBe('old');
  });

  it('derives titles from the first user message', async () => {
    const sessions = {
      sessions: [
        { session_id: 's1', messages: [{ role: 'user', content: 'Help me with Python' }] },
      ],
    };
    fs.readFile.mockResolvedValue(JSON.stringify(sessions));
    const res = await request(app).get('/api/sessions');
    expect(res.body.sessions[0].title).toBe('Help me with Python');
  });

  it('returns empty list when no sessions file exists', async () => {
    fs.readFile.mockRejectedValue(new Error('ENOENT'));
    const res = await request(app).get('/api/sessions');
    expect(res.status).toBe(200);
    expect(res.body.sessions).toEqual([]);
  });
});

// ── GET /api/session ──────────────────────────────────────────

describe('GET /api/session', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns a specific session by id', async () => {
    const sessions = {
      sessions: [
        { session_id: 'target', messages: [{ role: 'user', content: 'Hello' }] },
      ],
    };
    fs.readFile.mockImplementation((path) => {
      if (path.includes('chat-config')) return Promise.resolve('{}');
      return Promise.resolve(JSON.stringify(sessions));
    });
    const res = await request(app).get('/api/session?id=target');
    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBe('target');
    expect(res.body.messages).toHaveLength(1);
  });

  it('returns 404 when requested session id is not found', async () => {
    fs.readFile.mockImplementation((path) => {
      if (path.includes('chat-config')) return Promise.resolve('{}');
      return Promise.resolve(JSON.stringify({ sessions: [] }));
    });
    const res = await request(app).get('/api/session?id=nonexistent');
    expect(res.status).toBe(404);
  });

  it('returns the most recently updated session when no id given', async () => {
    const sessions = {
      sessions: [
        { session_id: 'older', created_at: '2026-01-01', updated_at: '2026-01-01', messages: [] },
        { session_id: 'newer', created_at: '2026-06-01', updated_at: '2026-06-01', messages: [] },
      ],
    };
    fs.readFile.mockImplementation((path) => {
      if (path.includes('chat-config')) return Promise.resolve('{}');
      return Promise.resolve(JSON.stringify(sessions));
    });
    const res = await request(app).get('/api/session');
    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBe('newer');
  });
});

// ── DELETE /api/sessions/:sessionId ───────────────────────────

describe('DELETE /api/sessions/:sessionId', () => {
  beforeEach(() => vi.resetAllMocks());

  it('removes the session and writes back', async () => {
    const sessions = {
      sessions: [
        { session_id: 'keep', messages: [] },
        { session_id: 'delete-me', messages: [] },
      ],
    };
    fs.readFile.mockResolvedValue(JSON.stringify(sessions));
    fs.writeFile.mockResolvedValue(undefined);

    const res = await request(app).delete('/api/sessions/delete-me');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const written = JSON.parse(fs.writeFile.mock.calls[0][1]);
    expect(written.sessions).toHaveLength(1);
    expect(written.sessions[0].session_id).toBe('keep');
  });
});

// ── POST /api/session/save ────────────────────────────────────

describe('POST /api/session/save', () => {
  beforeEach(() => vi.resetAllMocks());

  it('updates an existing session with new messages', async () => {
    const sessions = {
      sessions: [{ session_id: 's1', created_at: '2026-01-01', messages: [] }],
    };
    fs.readFile.mockResolvedValue(JSON.stringify(sessions));
    fs.writeFile.mockResolvedValue(undefined);

    const newMessages = [{ role: 'user', content: 'Hello' }];
    const res = await request(app)
      .post('/api/session/save')
      .send({ sessionId: 's1', messages: newMessages });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const written = JSON.parse(fs.writeFile.mock.calls[0][1]);
    expect(written.sessions[0].messages).toEqual(newMessages);
    expect(written.sessions[0].updated_at).toBeDefined();
  });

  it('creates a new session entry if sessionId is not found', async () => {
    fs.readFile.mockResolvedValue(JSON.stringify({ sessions: [] }));
    fs.writeFile.mockResolvedValue(undefined);

    const res = await request(app)
      .post('/api/session/save')
      .send({ sessionId: 'brand-new', messages: [{ role: 'user', content: 'Hi' }] });

    expect(res.status).toBe(200);
    const written = JSON.parse(fs.writeFile.mock.calls[0][1]);
    expect(written.sessions).toHaveLength(1);
    expect(written.sessions[0].session_id).toBe('brand-new');
  });

  it('returns 400 when sessionId is missing', async () => {
    const res = await request(app)
      .post('/api/session/save')
      .send({ messages: [] });
    expect(res.status).toBe(400);
  });

  it('returns 400 when messages is not an array', async () => {
    const res = await request(app)
      .post('/api/session/save')
      .send({ sessionId: 's1', messages: 'not-an-array' });
    expect(res.status).toBe(400);
  });
});

// ── POST /api/upload-urls ─────────────────────────────────────

describe('POST /api/upload-urls', () => {
  it('returns 400 when sessionId is missing', async () => {
    const res = await request(app)
      .post('/api/upload-urls')
      .send({ files: [] });
    expect(res.status).toBe(400);
  });

  it('returns 400 when files is missing', async () => {
    const res = await request(app)
      .post('/api/upload-urls')
      .send({ sessionId: 's1' });
    expect(res.status).toBe(400);
  });
});

// ── POST /api/upload ──────────────────────────────────────────

describe('POST /api/upload', () => {
  it('returns 400 when sessionId is missing', async () => {
    const res = await request(app)
      .post('/api/upload')
      .send({ files: [] });
    expect(res.status).toBe(400);
  });

  it('returns 400 when files is missing', async () => {
    const res = await request(app)
      .post('/api/upload')
      .send({ sessionId: 's1' });
    expect(res.status).toBe(400);
  });
});

// ── POST /api/trigger ─────────────────────────────────────────

describe('POST /api/trigger', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns 400 when sessionId is missing', async () => {
    fs.readFile.mockResolvedValue('{}');
    const res = await request(app)
      .post('/api/trigger')
      .send({ message: 'hello' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when Bedrock mode has nothing to send', async () => {
    fs.readFile.mockImplementation((path) => {
      if (path.includes('chat-config')) {
        return Promise.resolve(JSON.stringify({
          useBedrock: true,
          model: 'us.anthropic.claude-sonnet-4-6',
        }));
      }
      if (path.includes('chat-sessions')) return Promise.resolve(JSON.stringify({ sessions: [] }));
      return Promise.resolve('system prompt');
    });
    const res = await request(app)
      .post('/api/trigger')
      .send({ sessionId: 's1', text: '   ', files: [], history: [] });
    expect(res.status).toBe(400);
  });
});
