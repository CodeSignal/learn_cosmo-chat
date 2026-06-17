import { describe, it, expect } from 'vitest';
import {
  MAX_CONCURRENT_STREAMS,
  streamingCount,
  isStreamCapReached,
  canSendMessage,
  nextSaveAction,
} from '../lib/stream-registry.js';

// Minimal runtime factory: only the fields the pure logic reads.
const rt = (status) => ({ chat: status === null ? null : { status } });

// ── streamingCount ────────────────────────────────────────────

describe('streamingCount', () => {
  it('returns 0 for an empty iterable', () => {
    expect(streamingCount([])).toBe(0);
  });

  it('returns 0 when nothing is undefined/null', () => {
    expect(streamingCount(undefined)).toBe(0);
    expect(streamingCount(null)).toBe(0);
  });

  it('counts only runtimes whose chat status is "streaming"', () => {
    const runtimes = [rt('streaming'), rt('idle'), rt('streaming'), rt('error')];
    expect(streamingCount(runtimes)).toBe(2);
  });

  it('ignores runtimes with a null chat or missing status', () => {
    const runtimes = [rt(null), rt('streaming'), { chat: {} }, {}];
    expect(streamingCount(runtimes)).toBe(1);
  });

  it('works with a Map values() iterator (the real call site)', () => {
    const map = new Map([
      ['a', rt('streaming')],
      ['b', rt('idle')],
      ['c', rt('streaming')],
    ]);
    expect(streamingCount(map.values())).toBe(2);
  });
});

// ── isStreamCapReached ────────────────────────────────────────

describe('isStreamCapReached', () => {
  it('is false below the cap', () => {
    const runtimes = Array.from({ length: 4 }, () => rt('streaming'));
    expect(isStreamCapReached(runtimes, 5)).toBe(false);
  });

  it('is true at the cap', () => {
    const runtimes = Array.from({ length: 5 }, () => rt('streaming'));
    expect(isStreamCapReached(runtimes, 5)).toBe(true);
  });

  it('is true above the cap', () => {
    const runtimes = Array.from({ length: 6 }, () => rt('streaming'));
    expect(isStreamCapReached(runtimes, 5)).toBe(true);
  });

  it('defaults to MAX_CONCURRENT_STREAMS when no max is given', () => {
    const atDefault = Array.from({ length: MAX_CONCURRENT_STREAMS }, () => rt('streaming'));
    expect(isStreamCapReached(atDefault)).toBe(true);
    expect(isStreamCapReached(atDefault.slice(1))).toBe(false);
  });
});

// ── canSendMessage ────────────────────────────────────────────

describe('canSendMessage', () => {
  const base = {
    hasActiveChat: true,
    isUploading: false,
    activeStatus: 'idle',
    streamingCount: 0,
    maxStreams: 5,
    hasText: true,
    hasReadyFile: false,
  };

  it('allows sending with text and an idle active chat', () => {
    expect(canSendMessage(base)).toBe(true);
  });

  it('allows sending with a ready file but no text', () => {
    expect(canSendMessage({ ...base, hasText: false, hasReadyFile: true })).toBe(true);
  });

  it('blocks when there is no active chat', () => {
    expect(canSendMessage({ ...base, hasActiveChat: false })).toBe(false);
  });

  it('blocks while an upload is in flight', () => {
    expect(canSendMessage({ ...base, isUploading: true })).toBe(false);
  });

  it('blocks when the active chat is streaming', () => {
    expect(canSendMessage({ ...base, activeStatus: 'streaming' })).toBe(false);
  });

  it('blocks when nothing to send (no text, no file)', () => {
    expect(canSendMessage({ ...base, hasText: false, hasReadyFile: false })).toBe(false);
  });

  it('blocks at the concurrency cap even with valid content', () => {
    expect(canSendMessage({ ...base, streamingCount: 5 })).toBe(false);
  });

  it('allows sending one below the cap', () => {
    expect(canSendMessage({ ...base, streamingCount: 4 })).toBe(true);
  });

  it('uses MAX_CONCURRENT_STREAMS when maxStreams is omitted', () => {
    const { maxStreams, ...noMax } = base;
    expect(canSendMessage({ ...noMax, streamingCount: MAX_CONCURRENT_STREAMS })).toBe(false);
    expect(canSendMessage({ ...noMax, streamingCount: MAX_CONCURRENT_STREAMS - 1 })).toBe(true);
  });
});

// ── nextSaveAction ────────────────────────────────────────────

describe('nextSaveAction', () => {
  it('flushes when entering streaming (durable user message)', () => {
    expect(nextSaveAction('streaming', 'idle')).toBe('flush');
    expect(nextSaveAction('streaming', null)).toBe('flush');
  });

  it('throttles mid-stream (streaming → streaming)', () => {
    expect(nextSaveAction('streaming', 'streaming')).toBe('throttle');
  });

  it('flushes when leaving streaming (final complete save)', () => {
    expect(nextSaveAction('idle', 'streaming')).toBe('flush');
    expect(nextSaveAction('error', 'streaming')).toBe('flush');
  });

  it('does nothing when idle and previously idle', () => {
    expect(nextSaveAction('idle', 'idle')).toBe('none');
    expect(nextSaveAction('idle', null)).toBe('none');
  });
});
