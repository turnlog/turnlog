import { beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { Indexer } from '../src/indexer/indexer.js';
import {
  getFileHistory,
  parseSearchQuery,
  searchFiles,
  searchMessages,
  toFtsQuery,
} from '../src/server/api.js';
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

describe('parseSearchQuery (operators)', () => {
  it('extracts operators and keeps the rest as terms', () => {
    const p = parseSearchQuery('tool:Bash is:error retry logic');
    expect(p.filters).toEqual({ tool: 'Bash', isError: true });
    expect(p.terms).toBe('retry logic');
    expect(p.hasFilters).toBe(true);
  });

  it('treats unknown operators and malformed values as plain terms', () => {
    const p = parseSearchQuery('file.ts:12 https://example.com is:banana before:soon');
    expect(p.hasFilters).toBe(false);
    expect(p.terms).toBe('file.ts:12 https://example.com is:banana before:soon');
  });

  it('accepts ISO date prefixes on before/after', () => {
    const p = parseSearchQuery('before:2026-07 after:2025');
    expect(p.filters).toEqual({ before: '2026-07', after: '2025' });
    expect(p.terms).toBe('');
  });
});

describe('search operators', () => {
  it('tool: narrows FTS hits to one tool', () => {
    const res = searchMessages(db, { query: 'tool:Bash flux' });
    expect(res.totalHits).toBeGreaterThan(0);
    for (const g of res.groups) {
      for (const h of g.hits) expect(h.toolName).toBe('Bash');
    }
  });

  it('operator-only queries work without any FTS terms', () => {
    const res = searchMessages(db, { query: 'is:error' });
    expect(res.totalHits).toBeGreaterThan(0);
    // Failing results in the corpus live in SESSION_C's Bash failure.
    expect(res.groups.some((g) => g.session.id === SESSION_C)).toBe(true);
    expect(res.aggregates).not.toBeNull();
  });

  it('kind: filters to prompts', () => {
    const res = searchMessages(db, { query: 'kind:prompt' });
    expect(res.totalHits).toBeGreaterThan(0);
    for (const g of res.groups) {
      for (const h of g.hits) expect(h.kind).toBe('prompt');
    }
  });

  it('an impossible date range matches nothing', () => {
    const res = searchMessages(db, { query: 'before:1990' });
    expect(res.totalHits).toBe(0);
  });
});

describe('cross-session file history', () => {
  it('lists touched files with session counts', () => {
    const files = searchFiles(db, {});
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(f.path.length).toBeGreaterThan(0);
      expect(f.sessions).toBeGreaterThan(0);
    }
  });

  it('narrows by path fragment and resolves sessions for one file', () => {
    const files = searchFiles(db, {});
    const target = files[0]!;
    const narrowed = searchFiles(db, { query: target.path.slice(-8) });
    expect(narrowed.some((f) => f.path === target.path)).toBe(true);

    const history = getFileHistory(db, target.path);
    expect(history.path).toBe(target.path);
    expect(history.sessions.length).toBeGreaterThan(0);
    // Subagent hits resolve to roots — no child sessions in the timeline.
    for (const s of history.sessions) expect(s.parentSessionId).toBeNull();
  });

  it('unknown paths return an empty timeline, never an error', () => {
    expect(getFileHistory(db, '/nope/never.ts').sessions).toHaveLength(0);
  });
});

describe('session-scoped search (in-session find)', () => {
  it('filters to one session and orders hits by position', () => {
    const res = searchMessages(db, { query: 'flux', sessionId: SESSION_C });
    expect(res.groups).toHaveLength(1);
    expect(res.groups[0]!.session.id).toBe(SESSION_C);
    const idxs = res.groups[0]!.hits.map((h) => h.idx);
    expect([...idxs].sort((a, b) => a - b)).toEqual(idxs);
  });

  it('returns nothing for a session without the term', () => {
    const res = searchMessages(db, { query: 'useWebSocket', sessionId: SESSION_C });
    expect(res.totalHits).toBe(0);
  });
});
