/**
 * Local attachment storage.
 *
 * Uploads previously went to platform-managed S3 via presigned URLs. Bedrock has
 * no file service — Converse carries attachment bytes inline in the request — so
 * files are kept on disk here and re-read when a turn is sent. Storing them on
 * disk (rather than base64 inside the transcript) keeps chat-sessions.json small
 * and gives the UI a plain URL it can already render.
 */

import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';

export const UPLOADS_URL_PREFIX = '/uploads';

/** Guard against oversized inline payloads; Converse caps a request at 25 MB. */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

/** Only ids and filenames of this shape are ever written or resolved. */
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

/** Reduce a user-supplied filename to something safe to use as a path segment. */
export function safeFileName(filename, fallback = 'file') {
  const base = path
    .basename(String(filename ?? ''))
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 120);
  return base || fallback;
}

/**
 * Persist one uploaded file and return the reference stored in the transcript.
 * @param {string} uploadsDir - Absolute path to the uploads root.
 * @param {string} sessionId
 * @param {{ filename?: string, mediaType?: string, data: string }} file - `data` is base64.
 * @returns {Promise<{ filename: string, mediaType: string, url: string }>}
 */
export async function saveAttachment(uploadsDir, sessionId, file) {
  const bytes = Buffer.from(file.data ?? '', 'base64');
  if (bytes.length === 0) throw new Error('Attachment is empty');
  if (bytes.length > MAX_ATTACHMENT_BYTES) {
    throw new Error(`Attachment exceeds the ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB limit`);
  }

  const sessionSegment = safeFileName(sessionId, 'session');
  const name = `${randomUUID()}-${safeFileName(file.filename)}`;
  const dir = path.join(uploadsDir, sessionSegment);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, name), bytes);

  return {
    filename: safeFileName(file.filename),
    mediaType: file.mediaType ?? 'application/octet-stream',
    url: `${UPLOADS_URL_PREFIX}/${sessionSegment}/${name}`,
  };
}

/**
 * Resolve a stored attachment URL back to an absolute path inside `uploadsDir`,
 * or null when the URL is not one this server issued.
 * @param {string} uploadsDir
 * @param {string} url
 * @returns {string|null}
 */
export function resolveAttachmentPath(uploadsDir, url) {
  if (typeof url !== 'string' || !url.startsWith(`${UPLOADS_URL_PREFIX}/`)) return null;

  const segments = url.slice(UPLOADS_URL_PREFIX.length + 1).split('/');
  if (segments.length !== 2 || !segments.every((s) => SAFE_SEGMENT.test(s))) return null;

  const resolved = path.resolve(uploadsDir, ...segments);
  // Belt-and-braces: the segment allowlist already excludes '/' and '..'.
  if (!resolved.startsWith(path.resolve(uploadsDir) + path.sep)) return null;
  return resolved;
}

/**
 * Read an attachment's bytes for inlining into a Converse request. Returns null
 * when the file is unknown or has been removed, so a missing upload degrades to
 * a text-only turn instead of failing it.
 * @param {string} uploadsDir
 * @param {{ url?: string }} file
 * @returns {Promise<Uint8Array|null>}
 */
export async function readAttachmentBytes(uploadsDir, file) {
  const filePath = resolveAttachmentPath(uploadsDir, file?.url);
  if (!filePath) return null;
  try {
    return await fs.readFile(filePath);
  } catch {
    return null;
  }
}

/** Remove a session's uploads when its conversation is deleted. */
export async function deleteSessionAttachments(uploadsDir, sessionId) {
  const segment = safeFileName(sessionId, '');
  if (!segment) return;
  await fs.rm(path.join(uploadsDir, segment), { recursive: true, force: true });
}
