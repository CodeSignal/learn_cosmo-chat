import { describe, it, expect } from 'vitest';
import path from 'path';
import { resolveAttachmentPath, safeFileName } from '../lib/attachments.js';

const UPLOADS = '/srv/app/uploads';

// ── safeFileName ──────────────────────────────────────────────

describe('safeFileName', () => {
  it('keeps a normal filename intact', () => {
    expect(safeFileName('report.pdf')).toBe('report.pdf');
  });

  it('strips directory components', () => {
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
  });

  it('replaces characters outside the allowlist', () => {
    expect(safeFileName('my file (1).png')).toBe('my_file__1_.png');
  });

  it('does not produce a dotfile', () => {
    expect(safeFileName('.bashrc')).toBe('bashrc');
  });

  it('falls back when nothing usable remains', () => {
    expect(safeFileName('')).toBe('file');
    expect(safeFileName(undefined)).toBe('file');
  });
});

// ── resolveAttachmentPath ─────────────────────────────────────

describe('resolveAttachmentPath', () => {
  it('resolves a well-formed upload URL', () => {
    const resolved = resolveAttachmentPath(UPLOADS, '/uploads/session-1/abc-file.png');
    expect(resolved).toBe(path.resolve(UPLOADS, 'session-1', 'abc-file.png'));
  });

  it('rejects URLs outside the uploads prefix', () => {
    expect(resolveAttachmentPath(UPLOADS, '/etc/passwd')).toBeNull();
    expect(resolveAttachmentPath(UPLOADS, 'https://example.com/x.png')).toBeNull();
  });

  it('rejects traversal attempts', () => {
    expect(resolveAttachmentPath(UPLOADS, '/uploads/../../etc/passwd')).toBeNull();
    expect(resolveAttachmentPath(UPLOADS, '/uploads/session-1/../../../etc/passwd')).toBeNull();
    expect(resolveAttachmentPath(UPLOADS, '/uploads/./session-1/a.png')).toBeNull();
  });

  it('rejects the wrong number of path segments', () => {
    expect(resolveAttachmentPath(UPLOADS, '/uploads/only-one')).toBeNull();
    expect(resolveAttachmentPath(UPLOADS, '/uploads/a/b/c.png')).toBeNull();
  });

  it('rejects non-string input', () => {
    expect(resolveAttachmentPath(UPLOADS, undefined)).toBeNull();
    expect(resolveAttachmentPath(UPLOADS, 42)).toBeNull();
  });
});
