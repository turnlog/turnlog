import { beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { renderSearch } from '../src/cli/search.js';
import { Indexer } from '../src/indexer/indexer.js';
import { SESSION_A, copyCorpus, testDb, tmpDir } from './helpers.js';

let db: Database.Database;

beforeAll(async () => {
  db = testDb(tmpDir('turnlog-searchcli-'));
  await new Indexer(db, { projectsDir: copyCorpus() }).scanAll();
});

describe('turnlog search rendering', () => {
  it('groups hits by session with plain-text match markers', () => {
    const out = renderSearch(db, 'useWebSocket', { color: false });
    expect(out).toContain(SESSION_A.slice(0, 8));
    expect(out).toContain('«useWebSocket»');
    expect(out).toMatch(/\d+ hits? in \d+ sessions?/);
    // No raw FTS marker chars leak into the output.
    expect(out).not.toContain('');
    expect(out).not.toContain('');
  });

  it('supports operators and honors the limit', () => {
    const out = renderSearch(db, 'is:error', { color: false, limit: 1 });
    expect(out).toContain('1 hit in 1 session');
  });

  it('prints deep links when a server URL is known, a hint otherwise', () => {
    const url = 'http://127.0.0.1:4483/?token=abc';
    const withServer = renderSearch(db, 'useWebSocket', { color: false, serverUrl: url });
    expect(withServer).toContain(`${url}#/session/${SESSION_A}?m=`);
    expect(withServer).toContain(`&q=useWebSocket`);
    expect(withServer).not.toContain('run `turnlog` to open');

    const without = renderSearch(db, 'useWebSocket', { color: false, serverUrl: null });
    expect(without).toContain('run `turnlog` to open');
  });

  it('json mode emits the raw SearchResponse', () => {
    const out = renderSearch(db, 'useWebSocket', { json: true });
    const parsed = JSON.parse(out);
    expect(parsed.totalHits).toBeGreaterThan(0);
    expect(parsed.groups[0].session.id).toBe(SESSION_A);
  });

  it('says so when nothing matches', () => {
    expect(renderSearch(db, 'zz-never-in-corpus-zz', {})).toBe('no matches\n');
  });
});
