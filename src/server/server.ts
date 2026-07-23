import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import type { IndexDriver } from '../indexer/driver.js';
import {
  getSession,
  getSessionExport,
  getSessionFilePath,
  getSpend,
  getStats,
  isLens,
  listMessages,
  listProjects,
  listSessions,
  listTurns,
  searchMessages,
  setSessionMeta,
} from './api.js';
import type { SessionMetaPatch } from './apiTypes.js';
import type { ModelPricing } from '../cost/pricing.js';
import { placeholderHtml } from './placeholder.js';
import { APP_VERSION } from '../version.js';

export interface ServerContext {
  db: Database.Database;
  driver: IndexDriver;
  /** Random per-launch token; required on every /api request. */
  token: string;
  /** Bedrock/enterprise per-model rate overrides from settings.json. */
  pricingOverrides?: Record<string, Partial<ModelPricing>>;
  /** Append the export attribution footer (settings.json, default true). */
  exportFooter?: boolean;
  /**
   * Latest newer version from the CLI's startup registry check, or null.
   * Read live (not captured once) so /api/status reflects the result the
   * moment the async check resolves — the web UI polls status already.
   */
  getUpdate?: () => string | null;
  /** Live-update stream (`/api/events`); the CLI broadcasts after reindexes. */
  events?: SseHub;
  /** Reveal a file in the OS file manager. Injectable for tests; defaults to
   *  the platform opener (`open -R` / `explorer /select,` / `xdg-open`). */
  reveal?: (filePath: string) => void;
  /** Invoked by POST /api/shutdown (the web UI's stop button) after the
   *  response flushes; the CLI wires this to its SIGINT shutdown path.
   *  When absent the route does not exist. */
  onShutdown?: () => void;
}

const ALLOWED_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * SSE fan-out for live index updates (`GET /api/events`). Plain node:http
 * streaming — no WebSocket dependency, fits the GET-only surface, and
 * EventSource's token-in-query auth is the same credential the UI already
 * carries. The CLI broadcasts after each watcher-triggered reindex.
 */
const SSE_MAX_CLIENTS = 8;
const SSE_HEARTBEAT_MS = 25_000;

export class SseHub {
  private readonly clients = new Set<http.ServerResponse>();
  private heartbeat: NodeJS.Timeout | null = null;

  attach(res: http.ServerResponse): boolean {
    if (this.clients.size >= SSE_MAX_CLIENTS) return false;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.write(':connected\n\n');
    this.clients.add(res);
    res.on('close', () => {
      this.clients.delete(res);
      if (this.clients.size === 0 && this.heartbeat) {
        clearInterval(this.heartbeat);
        this.heartbeat = null;
      }
    });
    // Comment-only heartbeat keeps idle connections observably alive.
    this.heartbeat ??= setInterval(() => {
      for (const client of this.clients) client.write(':hb\n\n');
    }, SSE_HEARTBEAT_MS);
    return true;
  }

  broadcast(event: string, data: unknown): void {
    if (this.clients.size === 0) return;
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients) client.write(frame);
  }

  /** End every open stream (shutdown — open responses block server.close). */
  close(): void {
    for (const client of this.clients) client.end();
    this.clients.clear();
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }
}

/** Thrown by request parsing to turn into a non-500 error response. */
class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Platform "reveal this file in the file manager" — args as an array, never a shell. */
function defaultReveal(filePath: string): void {
  const [cmd, args] =
    process.platform === 'darwin'
      ? ['open', ['-R', filePath]]
      : process.platform === 'win32'
        ? ['explorer', ['/select,' + filePath]]
        : ['xdg-open', [path.dirname(filePath)]];
  spawn(cmd as string, args as string[], { stdio: 'ignore', detached: true }).unref();
}

const BODY_MAX_BYTES = 16 * 1024;

/** Read and parse a JSON request body; caps size (413) and rejects garbage (400). */
function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > BODY_MAX_BYTES) {
        // Stop reading but keep the socket alive so the 413 can be sent;
        // node closes the connection itself after an unconsumed body.
        req.removeAllListeners('data');
        req.removeAllListeners('end');
        req.pause();
        reject(new HttpError(413, 'body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'));
      } catch {
        reject(new HttpError(400, 'invalid JSON body'));
      }
    });
    req.on('error', () => reject(new HttpError(400, 'bad request')));
  });
}

/** Numeric query param: absent → undefined, non-numeric garbage → 400. */
function numParam(q: URLSearchParams, name: string): number | undefined {
  const raw = q.get(name);
  if (raw === null) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new HttpError(400, `invalid ${name}`);
  return n;
}

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
    // POST exists only for the two /api write routes below; everything else
    // on the surface stays GET/HEAD-only.
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'POST') {
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
      if (req.method === 'POST') {
        handleApiWrite(ctx, req, url, res).catch((err: unknown) => {
          const status = err instanceof HttpError ? err.status : 500;
          sendJson(res, status, {
            error: err instanceof Error ? err.message : 'internal error',
          });
        });
        return;
      }
      try {
        return handleApi(ctx, url, res);
      } catch (err) {
        const status = err instanceof HttpError ? err.status : 500;
        return sendJson(res, status, {
          error: err instanceof Error ? err.message : 'internal error',
        });
      }
    }

    if (req.method === 'POST') {
      return sendJson(res, 405, { error: 'method not allowed' });
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      return serveIndex(res);
    }
    if (serveStatic(res, url.pathname)) return;
    return sendJson(res, 404, { error: 'not found' });
  });
  return server;
}

/**
 * The write surface — the two per-session annotation routes plus shutdown,
 * all requiring the same token + Host/Origin gates every request passes
 * first. Any other POST is 405, so the hardening posture stays "GET-only
 * plus this allowlist".
 */
async function handleApiWrite(
  ctx: ServerContext,
  req: http.IncomingMessage,
  url: URL,
  res: http.ServerResponse,
): Promise<void> {
  const { db } = ctx;
  const p = url.pathname;

  const metaMatch = /^\/api\/sessions\/([^/]+)\/meta$/.exec(p);
  if (metaMatch) {
    const body = await readJsonBody(req);
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new HttpError(400, 'expected a JSON object');
    }
    const raw = body as Record<string, unknown>;
    const patch: SessionMetaPatch = {};
    if ('pinned' in raw) {
      if (typeof raw.pinned !== 'boolean') throw new HttpError(400, 'pinned must be boolean');
      patch.pinned = raw.pinned;
    }
    for (const key of ['customName', 'note'] as const) {
      if (key in raw) {
        if (raw[key] !== null && typeof raw[key] !== 'string') {
          throw new HttpError(400, `${key} must be a string or null`);
        }
        patch[key] = raw[key] as string | null;
      }
    }
    const updated = setSessionMeta(db, decodeURIComponent(metaMatch[1]!), patch);
    if (!updated) return sendJson(res, 404, { error: 'session not found' });
    return sendJson(res, 200, updated);
  }

  const revealMatch = /^\/api\/sessions\/([^/]+)\/reveal$/.exec(p);
  if (revealMatch) {
    const filePath = getSessionFilePath(db, decodeURIComponent(revealMatch[1]!));
    if (filePath === null) return sendJson(res, 404, { error: 'session not found' });
    (ctx.reveal ?? defaultReveal)(filePath);
    return sendJson(res, 200, { ok: true });
  }

  if (p === '/api/shutdown') {
    const onShutdown = ctx.onShutdown;
    if (!onShutdown) return sendJson(res, 404, { error: 'not found' });
    req.resume(); // drain the (unread) body so the socket closes cleanly
    // Fire only after the response has flushed — the handler exits the process.
    res.once('finish', () => setImmediate(onShutdown));
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 405, { error: 'method not allowed' });
}

function handleApi(ctx: ServerContext, url: URL, res: http.ServerResponse): void {
  const { db, driver } = ctx;
  const p = url.pathname;
  const q = url.searchParams;

  if (p === '/api/events') {
    if (!ctx.events) return sendJson(res, 404, { error: 'not found' });
    if (!ctx.events.attach(res)) {
      return sendJson(res, 503, { error: 'too many event streams' });
    }
    return; // response stays open — the hub owns it now
  }
  if (p === '/api/status') {
    return sendJson(res, 200, {
      ...driver.status(),
      appVersion: APP_VERSION,
      updateAvailable: ctx.getUpdate?.() ?? null,
    });
  }
  if (p === '/api/stats') {
    return sendJson(res, 200, getStats(db));
  }
  if (p === '/api/projects') {
    return sendJson(res, 200, listProjects(db));
  }
  if (p === '/api/spend') {
    return sendJson(
      res,
      200,
      getSpend(db, {
        days: numParam(q, 'days'),
        query: q.get('q') ?? undefined,
        pricingOverrides: ctx.pricingOverrides,
      }),
    );
  }
  if (p === '/api/sessions') {
    return sendJson(
      res,
      200,
      listSessions(db, {
        sort: q.get('sort') ?? undefined,
        dir: q.get('dir') ?? undefined,
        project: q.get('project') ?? undefined,
        limit: numParam(q, 'limit'),
        offset: numParam(q, 'offset'),
        since: q.get('since') ?? undefined,
        until: q.get('until') ?? undefined,
        hideEmpty: q.get('hideEmpty') === '1',
      }),
    );
  }
  if (p === '/api/search') {
    return sendJson(
      res,
      200,
      searchMessages(db, {
        query: q.get('q') ?? '',
        limit: numParam(q, 'limit'),
        sessionId: q.get('session') ?? undefined,
      }),
    );
  }

  const turnsMatch = /^\/api\/sessions\/([^/]+)\/turns$/.exec(p);
  if (turnsMatch) {
    const result = listTurns(db, decodeURIComponent(turnsMatch[1]!));
    if (!result) return sendJson(res, 404, { error: 'session not found' });
    return sendJson(res, 200, result);
  }

  const exportMatch = /^\/api\/sessions\/([^/]+)\/export$/.exec(p);
  if (exportMatch) {
    const footerParam = q.get('footer');
    const attribution =
      footerParam === '0' || footerParam === 'false' ? false : (ctx.exportFooter ?? true);
    const md = getSessionExport(db, decodeURIComponent(exportMatch[1]!), { attribution });
    if (md === null) return sendJson(res, 404, { error: 'session not found' });
    const payload = Buffer.from(md, 'utf8');
    res.writeHead(200, {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Length': payload.length,
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(payload);
    return;
  }

  const messagesMatch = /^\/api\/sessions\/([^/]+)\/messages$/.exec(p);
  if (messagesMatch) {
    const lensParam = q.get('lens') ?? undefined;
    if (lensParam !== undefined && !isLens(lensParam)) {
      return sendJson(res, 400, { error: 'unknown lens' });
    }
    const result = listMessages(db, decodeURIComponent(messagesMatch[1]!), {
      afterIdx: numParam(q, 'after_idx'),
      limit: numParam(q, 'limit'),
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
