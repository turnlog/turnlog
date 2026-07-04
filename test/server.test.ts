import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import type Database from 'better-sqlite3';
import { Indexer } from '../src/indexer/indexer.js';
import type { IndexDriver } from '../src/indexer/driver.js';
import { startServer } from '../src/server/server.js';
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

function request(reqPath: string, headers: Record<string, string> = {}, method = 'GET'): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: reqPath, method, headers },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body,
            json: () => JSON.parse(body),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

const withToken = (p: string) => `${p}${p.includes('?') ? '&' : '?'}token=${TOKEN}`;

beforeAll(async () => {
  db = testDb(tmpDir('turnlog-server-'));
  await new Indexer(db, { projectsDir: copyCorpus() }).scanAll();
  const started = await startServer({ db, driver: stubDriver, token: TOKEN });
  server = started.server;
  port = started.port;
});

afterAll(() => {
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

  it('rejects non-GET methods', async () => {
    const res = await request(withToken('/api/sessions'), {}, 'POST');
    expect(res.status).toBe(405);
  });

  it('does not serve files outside the web bundle', async () => {
    const res = await request('/..%2f..%2fpackage.json');
    expect(res.status).not.toBe(200);
  });
});

describe('API', () => {
  it('serves the placeholder page without a token', async () => {
    const res = await request('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('Turnlog');
  });

  it('lists sessions', async () => {
    const res = await request(withToken('/api/sessions'));
    const data = res.json();
    expect(data.total).toBe(4);
    expect(data.sessions).toHaveLength(4);
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

    const stats = (await request(withToken('/api/stats'))).json();
    expect(stats.sessions).toBe(4);
    expect(stats.projects.length).toBe(2);
  });

  it('404s unknown API routes', async () => {
    const res = await request(withToken('/api/nope'));
    expect(res.status).toBe(404);
  });
});
