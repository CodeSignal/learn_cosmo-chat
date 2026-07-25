/**
 * Minimal streaming chat store.
 *
 * Replaces the hosted platform's client SDK with the smallest surface the UI
 * actually consumes: an observable message list plus a status string. Messages
 * are shaped as `{ role, status, stopped, parts }` where each part is one of
 * `{ type: 'text', text }`, `{ type: 'reasoning', text }`, or
 * `{ type: 'file', filename, mediaType, url }`.
 *
 * The server holds no conversation state, so `getHistory()` supplies the
 * transcript to replay with each turn. It is read before the outgoing message is
 * appended, so it never contains the turn being sent.
 */

/** Read a File as base64 (without the data-URL prefix) for JSON upload. */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

export class ChatStore {
  /**
   * @param {object} options
   * @param {string} options.sessionId
   * @param {() => Array<object>} [options.getHistory] - Transcript to replay, in stored message shape.
   */
  constructor({ sessionId, getHistory }) {
    this.sessionId = sessionId;
    this.getHistory = getHistory ?? (() => []);
    this.messages = [];
    this.status = 'idle';
    this.error = null;
    this._listeners = new Set();
    this._controller = null;
  }

  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  _notify() {
    for (const listener of this._listeners) listener();
  }

  /** Abort an in-flight turn. The partial assistant message is left in place. */
  abort() {
    this._controller?.abort();
    this._controller = null;
  }

  /**
   * Upload attachments and return the refs to attach to the next message.
   * @param {File[]} files
   * @returns {Promise<Array<{ filename: string, mediaType: string, url: string }>>}
   */
  async uploadFiles(files) {
    const payload = await Promise.all(
      files.map(async (file) => ({
        filename: file.name,
        mediaType: file.type || 'application/octet-stream',
        data: await fileToBase64(file),
      })),
    );

    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: this.sessionId, files: payload }),
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      throw new Error(detail.error || `Upload failed (HTTP ${res.status})`);
    }
    const data = await res.json();
    return data.files ?? [];
  }

  /** Append text to the trailing part of `type`, creating it when absent. */
  _appendDelta(message, type, text) {
    const last = message.parts[message.parts.length - 1];
    if (last?.type === type) last.text += text;
    else message.parts.push({ type, text });
  }

  /**
   * Send one user turn and stream the reply.
   * @param {{ text?: string, files?: Array<object> }} input
   */
  async send({ text = '', files = [] } = {}) {
    if (this.status === 'streaming') return;

    // Captured before the outgoing turn is appended below.
    const history = this.getHistory();

    this.messages.push({
      role: 'user',
      status: 'done',
      stopped: false,
      parts: [
        ...files.map((f) => ({ type: 'file', ...f })),
        ...(text ? [{ type: 'text', text }] : []),
      ],
    });

    const assistant = { role: 'assistant', status: 'streaming', stopped: false, parts: [] };
    this.messages.push(assistant);

    this.status = 'streaming';
    this.error = null;
    this._notify();

    this._controller = new AbortController();

    try {
      const res = await fetch('/api/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: this.sessionId, text, files, history }),
        signal: this._controller.signal,
      });

      if (!res.ok || !res.body) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.error || `Request failed (HTTP ${res.status})`);
      }

      await this._consumeStream(res.body, assistant);
    } catch (err) {
      if (err.name !== 'AbortError') {
        this.error = err;
        this._appendDelta(assistant, 'text', `\n\n**Error:** ${err.message}`);
      }
    } finally {
      assistant.status = 'done';
      this.status = 'idle';
      this._controller = null;
      this._notify();
    }
  }

  /** Parse the SSE body and fold each event into the assistant message. */
  async _consumeStream(body, assistant) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line; keep any partial tail.
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';

      for (const frame of frames) {
        const data = frame
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('');
        if (!data) continue;

        let event;
        try {
          event = JSON.parse(data);
        } catch {
          continue;
        }
        this._applyEvent(event, assistant);
      }
    }
  }

  _applyEvent(event, assistant) {
    switch (event.type) {
      case 'text-delta':
        this._appendDelta(assistant, 'text', event.text);
        this._notify();
        break;
      case 'reasoning-delta':
        this._appendDelta(assistant, 'reasoning', event.text);
        this._notify();
        break;
      case 'error':
        this.error = new Error(event.message);
        this._appendDelta(assistant, 'text', `\n\n**Error:** ${event.message}`);
        this._notify();
        break;
      case 'done':
        this.usage = event.usage;
        break;
      default:
        break;
    }
  }
}
