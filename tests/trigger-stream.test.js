/**
 * End-to-end coverage for POST /api/trigger: a stubbed ConverseStream response
 * in, server-sent events out.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

const { bedrockSend, capturedCommands } = vi.hoisted(() => ({
  bedrockSend: vi.fn(),
  capturedCommands: [],
}));

vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: function () {
    this.send = bedrockSend;
  },
  ConverseStreamCommand: function (input) {
    this.input = input;
    capturedCommands.push(input);
  },
}));

vi.mock('fs/promises', () => ({
  default: { readFile: vi.fn(), writeFile: vi.fn(), mkdir: vi.fn(), rm: vi.fn() },
}));

vi.mock('dotenv/config', () => ({}));

const fs = (await import('fs/promises')).default;

process.env.NODE_ENV = 'test';
process.env.BEDROCK_AWS_ACCESS_KEY_ID = 'test-access-key-id';
process.env.BEDROCK_AWS_SECRET_ACCESS_KEY = 'test-secret-access-key';

const { app } = await import('../server.js');

/** Build an async-iterable stand-in for the ConverseStream response stream. */
function fakeStream(events) {
  return {
    stream: {
      async *[Symbol.asyncIterator]() {
        for (const event of events) yield event;
      },
    },
  };
}

/** Parse the SSE body back into the event objects the browser store would see. */
function parseSSE(body) {
  return body
    .split('\n\n')
    .filter(Boolean)
    .map((frame) => JSON.parse(frame.replace(/^data:\s*/, '')));
}

const SESSION = {
  session_id: 's1',
  settings: { MODEL: 'us.anthropic.claude-sonnet-4-6', THINKING: 'off', TEMPERATURE: 0.4 },
  messages: [],
};

function mockFiles({ session = SESSION, config = {} } = {}) {
  fs.readFile.mockImplementation((p) => {
    if (p.includes('chat-config')) return Promise.resolve(JSON.stringify(config));
    if (p.includes('chat-sessions')) {
      return Promise.resolve(JSON.stringify({ sessions: session ? [session] : [] }));
    }
    if (p.includes('system.md')) {
      return Promise.resolve('Base prompt.\n{{VERBOSITY_INSTRUCTIONS}}\n{{EXTRA_INSTRUCTIONS}}');
    }
    return Promise.reject(new Error('ENOENT'));
  });
  fs.writeFile.mockResolvedValue(undefined);
}

describe('POST /api/trigger streaming', () => {
  beforeEach(() => {
    bedrockSend.mockReset();
    capturedCommands.length = 0;
    mockFiles();
  });

  it('streams text deltas followed by a done event', async () => {
    bedrockSend.mockResolvedValue(fakeStream([
      { messageStart: { role: 'assistant' } },
      { contentBlockDelta: { delta: { text: 'Hello' } } },
      { contentBlockDelta: { delta: { text: ' world' } } },
      { messageStop: { stopReason: 'end_turn' } },
      { metadata: { usage: { inputTokens: 10, outputTokens: 2 } } },
    ]));

    const res = await request(app)
      .post('/api/trigger')
      .send({ sessionId: 's1', text: 'hi', history: [] });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');

    expect(parseSSE(res.text)).toEqual([
      { type: 'text-delta', text: 'Hello' },
      { type: 'text-delta', text: ' world' },
      { type: 'done', stopReason: 'end_turn', usage: { inputTokens: 10, outputTokens: 2 } },
    ]);
  });

  it('emits reasoning deltas separately from visible text', async () => {
    bedrockSend.mockResolvedValue(fakeStream([
      { contentBlockDelta: { delta: { reasoningContent: { text: 'thinking...' } } } },
      { contentBlockDelta: { delta: { text: 'answer' } } },
      { messageStop: { stopReason: 'end_turn' } },
    ]));

    const res = await request(app)
      .post('/api/trigger')
      .send({ sessionId: 's1', text: 'hi', history: [] });

    const events = parseSSE(res.text);
    expect(events[0]).toEqual({ type: 'reasoning-delta', text: 'thinking...' });
    expect(events[1]).toEqual({ type: 'text-delta', text: 'answer' });
  });

  it('sends the session settings and rendered system prompt to Bedrock', async () => {
    bedrockSend.mockResolvedValue(fakeStream([{ messageStop: { stopReason: 'end_turn' } }]));

    await request(app)
      .post('/api/trigger')
      .send({ sessionId: 's1', text: 'hi', history: [] });

    const [command] = capturedCommands;
    expect(command.modelId).toBe('us.anthropic.claude-sonnet-4-6');
    expect(command.inferenceConfig.temperature).toBe(0.4);
    expect(command.inferenceConfig.maxTokens).toBeGreaterThan(0);
    expect(command.additionalModelRequestFields).toBeUndefined();
    expect(command.system[0].text).toContain('Base prompt.');
    // Unset placeholders must never reach the model verbatim.
    expect(command.system[0].text).not.toContain('{{');
  });

  it('replays client-supplied history ahead of the new turn', async () => {
    bedrockSend.mockResolvedValue(fakeStream([{ messageStop: { stopReason: 'end_turn' } }]));

    await request(app).post('/api/trigger').send({
      sessionId: 's1',
      text: 'and then?',
      history: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'second' },
      ],
    });

    expect(capturedCommands[0].messages).toEqual([
      { role: 'user', content: [{ text: 'first' }] },
      { role: 'assistant', content: [{ text: 'second' }] },
      { role: 'user', content: [{ text: 'and then?' }] },
    ]);
  });

  it('enables reasoning and drops temperature when thinking is on', async () => {
    mockFiles({
      session: {
        ...SESSION,
        settings: { MODEL: 'us.anthropic.claude-sonnet-4-6', THINKING: 'high', TEMPERATURE: 0.4 },
      },
    });
    bedrockSend.mockResolvedValue(fakeStream([{ messageStop: { stopReason: 'end_turn' } }]));

    await request(app).post('/api/trigger').send({ sessionId: 's1', text: 'hi', history: [] });

    const [command] = capturedCommands;
    expect(command.additionalModelRequestFields.reasoning_config.type).toBe('enabled');
    expect(command.inferenceConfig).not.toHaveProperty('temperature');
  });

  it('reports a Bedrock failure before headers as a JSON error', async () => {
    const err = new Error('No access to model');
    err.name = 'AccessDeniedException';
    bedrockSend.mockRejectedValue(err);

    const res = await request(app)
      .post('/api/trigger')
      .send({ sessionId: 's1', text: 'hi', history: [] });

    expect(res.status).toBe(500);
    expect(res.body.error).toContain('bedrock:InvokeModelWithResponseStream');
  });

  it('reports a mid-stream exception as an error event', async () => {
    bedrockSend.mockResolvedValue(fakeStream([
      { contentBlockDelta: { delta: { text: 'partial' } } },
      { throttlingException: { message: 'Too many requests' } },
    ]));

    const res = await request(app)
      .post('/api/trigger')
      .send({ sessionId: 's1', text: 'hi', history: [] });

    const events = parseSSE(res.text);
    expect(events[0]).toEqual({ type: 'text-delta', text: 'partial' });
    expect(events[1].type).toBe('error');
    expect(events[1].message).toContain('throttling');
  });

  it('falls back to the configured model when the session is unknown', async () => {
    mockFiles({ session: null, config: { model: 'us.amazon.nova-2-lite-v1:0' } });
    bedrockSend.mockResolvedValue(fakeStream([{ messageStop: { stopReason: 'end_turn' } }]));

    await request(app).post('/api/trigger').send({ sessionId: 'gone', text: 'hi', history: [] });

    expect(capturedCommands[0].modelId).toBe('us.amazon.nova-2-lite-v1:0');
  });
});
