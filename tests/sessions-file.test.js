import { describe, it, expect } from 'vitest';
import { enqueueSessionsWrite } from '../lib/sessions-file.js';

describe('enqueueSessionsWrite', () => {
  it('runs operations in order even when started concurrently', async () => {
    const state = { chain: Promise.resolve() };
    const order = [];

    const slow = enqueueSessionsWrite(async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push('a');
      return 'a';
    }, state);

    const fast = enqueueSessionsWrite(async () => {
      order.push('b');
      return 'b';
    }, state);

    await expect(Promise.all([slow, fast])).resolves.toEqual(['a', 'b']);
    expect(order).toEqual(['a', 'b']);
  });

  it('continues the queue after a rejected operation', async () => {
    const state = { chain: Promise.resolve() };

    const failed = enqueueSessionsWrite(async () => {
      throw new Error('boom');
    }, state);

    const next = enqueueSessionsWrite(async () => 'ok', state);

    await expect(failed).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ok');
  });
});
