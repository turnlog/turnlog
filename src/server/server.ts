import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import type { IndexDriver } from '../indexer/driver.js';
import {
  getSession,
  getStats,
  isLens,
  listMessages,
  listProjects,
  listSessions,
  listTurns,
  searchMessages,
} from './api.js';
import { placeholderHtml } from './placeholder.js';
import { APP_VERSION } from '../version.js';

export interface ServerContext {
  db: Database.Database;
  driver: IndexDriver;
  /** Random per-launch token; required on every /api request. */
  token: string;
}

const ALLOWED_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
};

const webDistDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'web',
  'dist',
);

/**
 * Host header validation — the DNS-rebinding defense. A malicious site can
 * make a victim's browser send requests to 127.0.0.1, but it cannot forge a
 * localhost Host header for its own origin.
 */
function hostAllowed(hostHeader: string | undefined, serverPort: number): boolean {
  if (!hostHeader) return false;
  let hostname = hostHeader;
  let port: string | null = null;
  if (hostHeader.startsWith('[')) {
    const end = hostHeader.indexOf(']');
    if (end === -1) return false;
    hostname = hostHeader.slice(0, end + 1);
    const rest = hostHeader.slice(end + 1);
    if (rest.startsWith(':')) port = rest.slice(1);
    else if (rest !== '') return false;
  } else {
    const colon = hostHeader.indexOf(':');
    if (colon !== -1) {
      hostname = hostHeader.slice(0, colon);
      port = hostHeader.slice(colon + 1);
    }
  }
  if (!ALLOWED_HOSTNAMES.has(hostname)) return false;
  if (port !== null && Number(port) !== serverPort) return false;
  return true;
}

/** Origin validation — reject any cross-origin browser request outright. */
function originAllowed(origin: string | undefined, serverPort: number): boolean {
  if (origin === undefined) return true; // non-browser clients send no Origin
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false; // includes Origin: null
  }
  if (url.protocol !== 'http:') return false;
  const hostname = url.hostname === '::1' ? '[::1]' : url.hostname;
  if (!ALLOWED_HOSTNAMES.has(hostname)) return false;
  const originPort = url.port === '' ? 80 : Number(url.port);
  return originPort === serverPort;
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(payload);
}

function serveStatic(res: http.ServerResponse, urlPath: string): boolean {
  const rel = path.posix.normalize(urlPath).replace(/^\/+/, '');
  if (rel === '' || rel === '.') return false;
  const abs = path.resolve(webDistDir, rel);
  if (abs !== webDistDir && !abs.startsWith(webDistDir + path.sep)) return false;
  let content: Buffer;
  try {
    content = fs.readFileSync(abs);
  } catch {
    return false;
  }
  const type = CONTENT_TYPES[path.extname(abs)] ?? 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': content.length });
  res.end(content);
  return true;
}

function serveIndex(res: http.ServerResponse): void {
  const indexPath = path.join(webDistDir, 'index.html');
  let html: string;
  try {
    html = fs.readFileSync(indexPath, 'utf8');
  } catch {
    html = placeholderHtml();
  }
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(html);
}

export function createServer(ctx: ServerContext): http.Server {
  const server = http.createServer((req, res) => {
    const address = server.address();
    const serverPort = typeof address === 'object' && address !== null ? address.port : 0;

    if (!hostAllowed(req.headers.host, serverPort)) {
      return sendJson(res, 403, { error: 'forbidden: bad Host header' });
    }
    if (!originAllowed(req.headers.origin, serverPort)) {
      return sendJson(res, 403, { error: 'forbidden: bad Origin' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendJson(res, 405, { error: 'method not allowed' });
    }

    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://127.0.0.1');
    } catch {
      return sendJson(res, 400, { error: 'bad request' });
    }

    if (url.pathname.startsWith('/api/')) {
      const auth = req.headers.authorization;
      const bearer = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
      const supplied = bearer ?? url.searchParams.get('token');
      if (supplied !== ctx.token) {
        return sendJson(res, 401, { error: 'unauthorized' });
      }
      try {
        return handleApi(ctx, url, res);
      } catch (err) {
        return sendJson(res, 500, {
          error: err instanceof Error ? err.message : 'internal error',
        });
      }
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      return serveIndex(res);
    }
    if (serveStatic(res, url.pathname)) return;
    return sendJson(res, 404, { error: 'not found' });
  });
  return server;
}

function handleApi(ctx: ServerContext, url: URL, res: http.ServerResponse): void {
  const { db, driver } = ctx;
  const p = url.pathname;
  const q = url.searchParams;

  if (p === '/api/status') {
    return sendJson(res, 200, {
      ...driver.status(),
      appVersion: APP_VERSION,
      licensed: process.env.TURNLOG_UNLICENSED !== '1',
    });
  }
  if (p === '/api/stats') {
    return sendJson(res, 200, getStats(db));
  }
  if (p === '/api/projects') {
    return sendJson(res, 200, listProjects(db));
  }
  if (p === '/api/sessions') {
    return sendJson(
      res,
      200,
      listSessions(db, {
        sort: q.get('sort') ?? undefined,
        dir: q.get('dir') ?? undefined,
        project: q.get('project') ?? undefined,
        limit: q.has('limit') ? Number(q.get('limit')) : undefined,
        offset: q.has('offset') ? Number(q.get('offset')) : undefined,
      }),
    );
  }
  if (p === '/api/search') {
    return sendJson(
      res,
      200,
      searchMessages(db, {
        query: q.get('q') ?? '',
        limit: q.has('limit') ? Number(q.get('limit')) : undefined,
      }),
    );
  }

  const turnsMatch = /^\/api\/sessions\/([^/]+)\/turns$/.exec(p);
  if (turnsMatch) {
    const result = listTurns(db, decodeURIComponent(turnsMatch[1]!));
    if (!result) return sendJson(res, 404, { error: 'session not found' });
    return sendJson(res, 200, result);
  }

  const messagesMatch = /^\/api\/sessions\/([^/]+)\/messages$/.exec(p);
  if (messagesMatch) {
    const lensParam = q.get('lens') ?? undefined;
    if (lensParam !== undefined && !isLens(lensParam)) {
      return sendJson(res, 400, { error: 'unknown lens' });
    }
    const result = listMessages(db, decodeURIComponent(messagesMatch[1]!), {
      afterIdx: q.has('after_idx') ? Number(q.get('after_idx')) : undefined,
      limit: q.has('limit') ? Number(q.get('limit')) : undefined,
      lens: lensParam,
    });
    if (!result) return sendJson(res, 404, { error: 'session not found' });
    return sendJson(res, 200, result);
  }

  const sessionMatch = /^\/api\/sessions\/([^/]+)$/.exec(p);
  if (sessionMatch) {
    const session = getSession(db, decodeURIComponent(sessionMatch[1]!));
    if (!session) return sendJson(res, 404, { error: 'session not found' });
    return sendJson(res, 200, session);
  }

  return sendJson(res, 404, { error: 'not found' });
}

export function startServer(
  ctx: ServerContext,
  opts: { port?: number } = {},
): Promise<{ server: http.Server; port: number; url: string }> {
  const server = createServer(ctx);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    // Loopback only — never 0.0.0.0. Port 0 = random high port.
    server.listen(opts.port ?? 0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve({
        server,
        port,
        url: `http://127.0.0.1:${port}/?token=${ctx.token}`,
      });
    });
  });
}
