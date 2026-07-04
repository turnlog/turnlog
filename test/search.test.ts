import { beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { Indexer } from '../src/indexer/indexer.js';
import { searchMessages, toFtsQuery } from '../src/server/api.js';
import { SNIPPET_CLOSE, SNIPPET_OPEN } from '../src/server/apiTypes.js';
import { SESSION_A, SESSION_C, copyCorpus, testDb, tmpDir } from './helpers.js';

let db: Database.Database;

beforeAll(async () => {
  db = testDb(tmpDir('turnlog-search-'));
  await new Indexer(db, { projectsDir: copyCorpus() }).scanAll();
});

describe('toFtsQuery', () => {
  it('quotes tokens so FTS syntax cannot leak through', () => {
    expect(toFtsQuery('foo bar')).toBe('"foo" "bar"');
    expect(toFtsQuery('NEAR(a b)')).toBe('"NEAR(a" "b)"');
  });

  it('preserves trailing * as a prefix query', () => {
    expect(toFtsQuery('useWeb*')).toBe('"useWeb"*');
  });

  it('returns null when nothing searchable remains', () => {
    expect(toFtsQuery('')).toBeNull();
    expect(toFtsQuery('   ')).toBeNull();
    expect(toFtsQuery('*')).toBeNull();
  });
});

describe('searchMessages', () => {
  it('finds camelCase identifiers', () => {
    const res = searchMessages(db, { query: 'useWebSocket' });
    expect(res.totalHits).toBeGreaterThan(0);
    expect(res.groups[0]!.session.id).toBe(SESSION_A);
  });

  it('finds snake_case identifiers thanks to tokenchars', () => {
    const res = searchMessages(db, { query: 'quantum_flux_capacitor' });
    expect(res.groups).toHaveLength(1);
    expect(res.groups[0]!.session.id).toBe(SESSION_C);
  });

  it('supports prefix search', () => {
    const res = searchMessages(db, { query: 'useWeb*' });
    expect(res.totalHits).toBeGreaterThan(0);
  });

  it('groups hits by session with snippet markers', () => {
    const res = searchMessages(db, { query: 'reconnect' });
    const group = res.groups.find((g) => g.session.id === SESSION_A);
    expect(group).toBeDefined();
    expect(group!.hits.length).toBeGreaterThan(1);
    const snippet = group!.hits[0]!.snippet;
    expect(snippet).toContain(SNIPPET_OPEN);
    expect(snippet).toContain(SNIPPET_CLOSE);
  });

  it('never throws on hostile input', () => {
    for (const q of ['((((', '"', 'a AND OR NOT', '-x', '"unclosed', '* * *']) {
      expect(() => searchMessages(db, { query: q })).not.toThrow();
    }
  });

  it('searches text inside tool results (file contents)', () => {
    const res = searchMessages(db, { query: 'session_id' });
    expect(res.totalHits).toBeGreaterThan(0);
  });
});
