import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import type Database from 'better-sqlite3';
import { Indexer } from '../src/indexer/indexer.js';
import type { IndexDriver } from '../src/indexer/driver.js';
import { SseHub, startServer } from '../src/server/server.js';
import { SESSION_A, SESSION_C, copyCorpus, testDb, tmpDir } from './helpers.js';

const TOKEN = 'test-token-1234567890abcdef';

let db: Database.Database;
let server: http.Server;
let port: number;

const stubDriver: IndexDriver = {
  status: () => ({ state: 'idle', filesTotal: 4, filesDone: 4, lastError: null, lastScanAt: null }),
  scan: async () => ({ filesSeen: 0, filesIndexed: 0, linesParsed: 0, errors: [] }),
  indexFile: async () => undefined,
  rebuild: async () => ({ filesSeen: 0, filesIndexed: 0, linesParsed: 0, errors: [] }),
  close: async () => undefined,
};

interface Res {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  json: () => any;
}

function request(
  reqPath: string,
  headers: Record<string, string> = {},
  method = 'GET',
  reqPort = port,
  body?: string,
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: reqPort, path: reqPath, method, headers },
      (res) => {
        let resBody = '';
        res.on('data', (chunk) => (resBody += chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: resBody,
            json: () => JSON.parse(resBody),
          }),
        );
      },
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const withToken = (p: string) => `${p}${p.includes('?') ? '&' : '?'}token=${TOKEN}`;

const hub = new SseHub();

const revealed: string[] = [];

beforeAll(async () => {
  db = testDb(tmpDir('turnlog-server-'));
  await new Indexer(db, { projectsDir: copyCorpus() }).scanAll();
  const started = await startServer({
    db,
    driver: stubDriver,
    token: TOKEN,
    events: hub,
    reveal: (p) => revealed.push(p),
  });
  server = started.server;
  port = started.port;
});

afterAll(() => {
  hub.close();
  server.close();
  db.close();
});

describe('hardening', () => {
  it('rejects a foreign Host header (DNS rebinding)', async () => {
    const res = await request(withToken('/api/sessions'), { Host: 'evil.example.com' });
    expect(res.status).toBe(403);
  });

  it('rejects a localhost Host header with the wrong port', async () => {
    const res = await request(withToken('/api/sessions'), { Host: 'localhost:9' });
    expect(res.status).toBe(403);
  });

  it('accepts localhost and 127.0.0.1 Host headers with the right port', async () => {
    for (const host of [`localhost:${port}`, `127.0.0.1:${port}`]) {
      const res = await request(withToken('/api/sessions'), { Host: host });
      expect(res.status).toBe(200);
    }
  });

  it('rejects cross-origin browser requests', async () => {
    const res = await request(withToken('/api/sessions'), { Origin: 'http://evil.example.com' });
    expect(res.status).toBe(403);
  });

  it('rejects Origin null', async () => {
    const res = await request(withToken('/api/sessions'), { Origin: 'null' });
    expect(res.status).toBe(403);
  });

  it('accepts a same-origin request', async () => {
    const res = await request(withToken('/api/sessions'), { Origin: `http://127.0.0.1:${port}` });
    expect(res.status).toBe(200);
  });

  it('requires the session token on every API request', async () => {
    expect((await request('/api/sessions')).status).toBe(401);
    expect((await request('/api/sessions?token=wrong')).status).toBe(401);
  });

  it('accepts the token as a Bearer header', async () => {
    const res = await request('/api/sessions', { Authorization: `Bearer ${TOKEN}` });
    expect(res.status).toBe(200);
  });

  it('sends no CORS headers', async () => {
    const res = await request(withToken('/api/sessions'));
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects non-GET methods outside the write allowlist', async () => {
    const res = await request(withToken('/api/sessions'), {}, 'POST');
    expect(res.status).toBe(405);
    const del = await request(withToken('/api/sessions'), {}, 'DELETE');
    expect(del.status).toBe(405);
    const status = await request(withToken('/api/status'), {}, 'POST');
    expect(status.status).toBe(405);
    const root = await request('/', {}, 'POST');
    expect(root.status).toBe(405);
  });

  it('does not serve files outside the web bundle', async () => {
    const res = await request('/..%2f..%2fpackage.json');
    expect(res.status).not.toBe(200);
  });
});

describe('write surface (session annotations + reveal)', () => {
  it('requires the token like every API route', async () => {
    const res = await request(`/api/sessions/${SESSION_A}/meta`, {}, 'POST', port, '{}');
    expect(res.status).toBe(401);
    const rev = await request(`/api/sessions/${SESSION_A}/reveal`, {}, 'POST');
    expect(rev.status).toBe(401);
  });

  it('rejects malformed and oversized bodies', async () => {
    const bad = await request(
      withToken(`/api/sessions/${SESSION_A}/meta`),
      {},
      'POST',
      port,
      'not json',
    );
    expect(bad.status).toBe(400);
    const wrongType = await request(
      withToken(`/api/sessions/${SESSION_A}/meta`),
      {},
      'POST',
      port,
      JSON.stringify({ pinned: 'yes' }),
    );
    expect(wrongType.status).toBe(400);
    const big = await request(
      withToken(`/api/sessions/${SESSION_A}/meta`),
      {},
      'POST',
      port,
      JSON.stringify({ note: 'x'.repeat(20_000) }),
    );
    expect(big.status).toBe(413);
  });

  it('annotates a session, floats pins to the top, and clears cleanly', async () => {
    const set = await request(
      withToken(`/api/sessions/${SESSION_A}/meta`),
      {},
      'POST',
      port,
      JSON.stringify({ pinned: true, customName: '  My run  ', note: 'check later' }),
    );
    expect(set.status).toBe(200);
    expect(set.json().pinned).toBe(true);
    expect(set.json().customName).toBe('My run'); // trimmed

    const list = await request(withToken('/api/sessions?sort=tokens&dir=desc'));
    expect(list.json().sessions[0].id).toBe(SESSION_A);

    const one = await request(withToken(`/api/sessions/${SESSION_A}`));
    expect(one.json().note).toBe('check later');

    const clear = await request(
      withToken(`/api/sessions/${SESSION_A}/meta`),
      {},
      'POST',
      port,
      JSON.stringify({ pinned: false, customName: null, note: null }),
    );
    expect(clear.status).toBe(200);
    expect(clear.json().pinned).toBe(false);
    expect(clear.json().customName).toBeNull();
    // The all-default row is deleted, not kept as a tombstone.
    expect(db.prepare('SELECT COUNT(*) AS n FROM session_meta').get()).toEqual({ n: 0 });
  });

  it('404s writes against unknown sessions', async () => {
    const meta = await request(withToken('/api/sessions/nope/meta'), {}, 'POST', port, '{}');
    expect(meta.status).toBe(404);
    const rev = await request(withToken('/api/sessions/nope/reveal'), {}, 'POST');
    expect(rev.status).toBe(404);
  });

  it('reveal hands the session file path to the opener, never a shell', async () => {
    const res = await request(withToken(`/api/sessions/${SESSION_A}/reveal`), {}, 'POST');
    expect(res.status).toBe(200);
    expect(revealed).toHaveLength(1);
    expect(revealed[0]).toMatch(/\.jsonl$/);
  });
});

describe('API', () => {
  it('serves the placeholder page without a token', async () => {
    const res = await request('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('Turnlog');
  });

  it('lists sessions (subagent transcripts excluded)', async () => {
    const res = await request(withToken('/api/sessions'));
    const data = res.json();
    // 5 root sessions; the subagent transcript rolls into its parent.
    expect(data.total).toBe(5);
    expect(data.sessions).toHaveLength(5);
  });

  it('filters sessions by project', async () => {
    const res = await request(withToken('/api/sessions?project=-Users-dev-projects-api'));
    expect(res.json().total).toBe(2);
  });

  it('returns one session with metadata', async () => {
    const res = await request(withToken(`/api/sessions/${SESSION_A}`));
    const data = res.json();
    expect(data.turnCount).toBe(16);
    expect(data.filesTouchedCount).toBe(2);
  });

  it('pages messages with raw JSON included', async () => {
    const res = await request(withToken(`/api/sessions/${SESSION_A}/messages?limit=5`));
    const data = res.json();
    expect(data.total).toBe(16);
    expect(data.messages).toHaveLength(5);
    expect(JSON.parse(data.messages[1].raw).uuid).toBe('u1');

    const next = await request(
      withToken(`/api/sessions/${SESSION_A}/messages?after_idx=${data.messages[4].idx}`),
    );
    expect(next.json().messages[0].idx).toBeGreaterThan(data.messages[4].idx);
  });

  it('404s an unknown session', async () => {
    const res = await request(withToken('/api/sessions/nope'));
    expect(res.status).toBe(404);
  });

  it('searches with grouped results', async () => {
    const res = await request(withToken('/api/search?q=quantum_flux_capacitor'));
    const data = res.json();
    expect(data.groups).toHaveLength(1);
    expect(data.groups[0].session.id).toBe(SESSION_C);
  });

  it('reports status and stats', async () => {
    const status = (await request(withToken('/api/status'))).json();
    expect(status.state).toBe('idle');
    expect(status.appVersion).toBeDefined();
    // No getUpdate wired on this server → no update surfaced.
    expect(status.updateAvailable).toBeNull();

    const stats = (await request(withToken('/api/stats'))).json();
    expect(stats.sessions).toBe(5);
    expect(stats.projects.length).toBe(3);
  });

  it('surfaces the CLI update check on /api/status via getUpdate', async () => {
    const { server: s, port: p } = await startServer({
      db,
      driver: stubDriver,
      token: TOKEN,
      getUpdate: () => '9.9.9',
    });
    try {
      const status = (
        await request(`/api/status?token=${TOKEN}`, {}, 'GET', p)
      ).json();
      expect(status.updateAvailable).toBe('9.9.9');
    } finally {
      s.close();
    }
  });

  it('rejects non-numeric numeric params with 400, not 500', async () => {
    const bad = [
      '/api/sessions?limit=abc',
      '/api/spend?days=abc',
      '/api/search?q=x&limit=1e999',
      `/api/sessions/${SESSION_A}/messages?after_idx=xyz`,
    ];
    for (const p of bad) {
      const res = await request(withToken(p));
      expect(res.status).toBe(400);
    }
    // Valid numbers still work.
    const ok = await request(withToken('/api/sessions?limit=5'));
    expect(ok.status).toBe(200);
  });

  it('guards the event stream with the same token as every API route', async () => {
    const res = await request('/api/events');
    expect(res.status).toBe(401);
  });

  it('streams indexed events over SSE', async () => {
    const received = await new Promise<string>((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port, path: withToken('/api/events'), method: 'GET' },
        (res) => {
          expect(res.statusCode).toBe(200);
          expect(res.headers['content-type']).toBe('text/event-stream');
          let buf = '';
          res.on('data', (chunk: Buffer) => {
            buf += chunk.toString();
            if (buf.includes('event: indexed')) {
              res.destroy();
              resolve(buf);
            }
          });
          // Connection is open — now broadcast into it.
          hub.broadcast('indexed', { sessionId: SESSION_A, at: 'now' });
        },
      );
      req.on('error', reject);
      req.end();
      setTimeout(() => reject(new Error('no SSE frame within 3s')), 3000);
    });
    expect(received).toContain(`data: {"sessionId":"${SESSION_A}","at":"now"}`);
  });

  it('404s unknown API routes', async () => {
    const res = await request(withToken('/api/nope'));
    expect(res.status).toBe(404);
  });
});
