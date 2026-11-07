import fs from 'node:fs';
import type http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

/**
 * Local images and videos a session's records point at by path — a file the
 * agent sent you, a screen recording you dragged into a prompt, a screenshot
 * a tool saved to disk. The bytes were never in the log, so the replay asks
 * for them here.
 *
 * This reads files outside Turnlog's index, so every gate must pass: the
 * reference must appear verbatim in the named message's raw record, the
 * resolved file must carry a media extension, and its leading bytes must be
 * that media type. SVG is excluded — it can carry script.
 */

type Kind = 'image' | 'video';

const BY_EXT: Record<string, { kind: Kind; mime: string }> = {
  '.png': { kind: 'image', mime: 'image/png' },
  '.jpg': { kind: 'image', mime: 'image/jpeg' },
  '.jpeg': { kind: 'image', mime: 'image/jpeg' },
  '.gif': { kind: 'image', mime: 'image/gif' },
  '.webp': { kind: 'image', mime: 'image/webp' },
  '.mp4': { kind: 'video', mime: 'video/mp4' },
  '.m4v': { kind: 'video', mime: 'video/mp4' },
  '.mov': { kind: 'video', mime: 'video/quicktime' },
  '.webm': { kind: 'video', mime: 'video/webm' },
};

const MAX_REF = 4096;

/** The leading bytes' media type, or null — the extension alone proves nothing. */
export function sniffMedia(head: Buffer): string | null {
  const at = (i: number, bytes: number[]) => bytes.every((b, j) => head[i + j] === b);
  if (at(0, [0x89, 0x50, 0x4e, 0x47])) return 'image/png';
  if (at(0, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (at(0, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return 'image/webp';
  if (at(0, [0x1a, 0x45, 0xdf, 0xa3])) return 'video/webm';
  if (at(4, [0x66, 0x74, 0x79, 0x70])) {
    // ISO base media: QuickTime brands play as .mov, the rest as mp4.
    return head.subarray(8, 12).toString('latin1') === 'qt  ' ? 'video/quicktime' : 'video/mp4';
  }
  return null;
}

/**
 * Undo a POSIX shell's escaping (`Screen\ Recording.mov`). Only a backslash
 * before a shell metacharacter is an escape — on Windows the backslash is the
 * separator, and stripping every one turned `C:\Users\me` into `C:Usersme`.
 */
export function unescapeShell(ref: string): string {
  if (/^(?:[A-Za-z]:[\\/]|\\\\)/.test(ref)) return ref; // drive or UNC path
  return ref.replace(/\\([ ()'"&!$;,[\]{}#])/g, '$1');
}

/**
 * A reference as written in a log → an absolute path, or null. Shell-escaped
 * spaces (`Screen\ Recording.mov`, what a terminal drag-and-drop inserts)
 * are unescaped, `~` expands, and a relative path resolves against the cwd
 * the record was written in.
 */
export function resolveMediaRef(ref: string, cwd: string | null): string | null {
  let p = unescapeShell(ref);
  if (p === '~' || p.startsWith('~/')) p = path.join(os.homedir(), p.slice(1));
  if (!path.isAbsolute(p)) {
    if (cwd === null || !path.isAbsolute(cwd)) return null;
    p = path.resolve(cwd, p);
  }
  return path.normalize(p);
}

export interface MediaFile {
  path: string;
  mime: string;
  size: number;
}

/**
 * Locate a referenced media file, or explain why not. `idx` names the message
 * whose raw record must contain `ref` — a check against one row, not a scan
 * of the whole session.
 */
export function findMedia(
  db: DatabaseSync,
  sessionId: string,
  idx: number,
  ref: string,
): { ok: true; file: MediaFile } | { ok: false; status: number; error: string } {
  if (ref === '' || ref.length > MAX_REF || ref.includes('\0')) {
    return { ok: false, status: 400, error: 'bad media reference' };
  }
  const row = db
    .prepare(
      `SELECT m.raw_json AS raw, s.project_path AS projectPath
       FROM messages m JOIN sessions s ON s.id = m.session_id
       WHERE m.session_id = ? AND m.idx = ?`,
    )
    .get(sessionId, idx) as { raw: string; projectPath: string | null } | undefined;
  // JSON-escaped, so a path with quotes or backslashes matches its own spelling.
  const needle = JSON.stringify(ref).slice(1, -1);
  if (!row || !row.raw.includes(needle)) {
    return { ok: false, status: 404, error: 'not referenced by this message' };
  }
  let cwd: string | null = row.projectPath;
  try {
    const parsed = JSON.parse(row.raw) as { cwd?: unknown };
    if (typeof parsed.cwd === 'string') cwd = parsed.cwd;
  } catch {
    /* unparseable record — the session's project path stands in */
  }
  const resolved = resolveMediaRef(ref, cwd);
  if (resolved === null) return { ok: false, status: 404, error: 'unresolvable path' };
  const ext = BY_EXT[path.extname(resolved).toLowerCase()];
  if (!ext) return { ok: false, status: 415, error: 'not an image or video' };

  let real: string;
  let size: number;
  try {
    real = fs.realpathSync(resolved);
    const st = fs.statSync(real);
    if (!st.isFile()) return { ok: false, status: 404, error: 'not a file' };
    size = st.size;
  } catch {
    return { ok: false, status: 404, error: 'file not on disk' };
  }
  const head = Buffer.alloc(16);
  try {
    const fd = fs.openSync(real, 'r');
    try {
      fs.readSync(fd, head, 0, 16, 0);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return { ok: false, status: 404, error: 'file not readable' };
  }
  // A symlink's target must pass too, and the bytes must agree with both.
  const sniffed = sniffMedia(head);
  const realExt = BY_EXT[path.extname(real).toLowerCase()];
  if (realExt?.kind !== ext.kind || sniffed === null || !sniffed.startsWith(`${ext.kind}/`)) {
    return { ok: false, status: 415, error: 'not an image or video' };
  }
  return { ok: true, file: { path: real, mime: sniffed, size } };
}

/** Stream a media file, honouring a single byte range — video seeking needs it. */
export function sendMedia(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  file: MediaFile,
): void {
  const headers: http.OutgoingHttpHeaders = {
    'Content-Type': file.mime,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=600',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cross-Origin-Resource-Policy': 'same-origin',
  };
  let start = 0;
  let end = file.size - 1;
  let status = 200;
  const range = req.headers.range;
  if (typeof range === 'string') {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (m && (m[1] !== '' || m[2] !== '')) {
      if (m[1] === '') {
        start = Math.max(0, file.size - Number(m[2]));
      } else {
        start = Number(m[1]);
        if (m[2] !== '') end = Math.min(end, Number(m[2]));
      }
      if (start > end || start >= file.size) {
        res.writeHead(416, { ...headers, 'Content-Range': `bytes */${file.size}` });
        res.end();
        return;
      }
      status = 206;
      headers['Content-Range'] = `bytes ${start}-${end}/${file.size}`;
    }
  }
  headers['Content-Length'] = file.size === 0 ? 0 : end - start + 1;
  res.writeHead(status, headers);
  if (req.method === 'HEAD' || file.size === 0) {
    res.end();
    return;
  }
  const stream = fs.createReadStream(file.path, { start, end });
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}
