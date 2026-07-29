import { beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { Indexer } from '../src/indexer/indexer.js';
import {
  getFileHistory,
  parseSearchQuery,
  searchFiles,
  searchMessages,
  searchTimeline,
  toFtsQuery,
} from '../src/server/api.js';
import { SNIPPET_CLOSE, SNIPPET_OPEN } from '../src/server/apiTypes.js';
import { SESSION_A, SESSION_C, SESSION_D, copyCorpus, testDb, tmpDir } from './helpers.js';

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

  it('parses annotation operators; unknown has: values stay terms', () => {
    const p = parseSearchQuery('is:pinned has:note has:bookmark auth');
    expect(p.filters).toEqual({ pinned: true, hasNote: true, hasBookmark: true });
    expect(p.terms).toBe('auth');
    expect(parseSearchQuery('has:banana').hasFilters).toBe(false);
  });
});

describe('annotation operators against user data', () => {
  it('is:pinned and has:note narrow to annotated sessions', async () => {
    const { setSessionMeta } = await import('../src/server/api.js');
    setSessionMeta(db, SESSION_A, { pinned: true, note: 'the reconnect saga' });
    const pinned = searchMessages(db, { query: 'is:pinned' });
    expect(pinned.groups.map((g) => g.session.id)).toEqual([SESSION_A]);
    const noted = searchMessages(db, { query: 'has:note useWebSocket' });
    expect(noted.groups.map((g) => g.session.id)).toEqual([SESSION_A]);
    // No session in the corpus DB is pinned AND in project "api".
    expect(searchMessages(db, { query: 'is:pinned quantum_flux_capacitor' }).totalHits).toBe(0);
    setSessionMeta(db, SESSION_A, { pinned: false, note: null });
  });

  it('has:bookmark matches the bookmarked moments themselves', async () => {
    const { setBookmark } = await import('../src/server/api.js');
    setBookmark(db, SESSION_C, 2, true);
    const res = searchMessages(db, { query: 'has:bookmark' });
    expect(res.totalHits).toBe(1);
    expect(res.groups[0]!.session.id).toBe(SESSION_C);
    expect(res.groups[0]!.hits[0]!.idx).toBe(2);
    setBookmark(db, SESSION_C, 2, false);
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

describe('searchTimeline (search-anchored timeline)', () => {
  it('groups the full match set per root session, oldest first', () => {
    const res = searchTimeline(db, { query: 'useWebSocket' });
    expect(res.sessions.length).toBeGreaterThan(0);
    const starts = res.sessions.map((t) => t.session.startedAt ?? '');
    expect([...starts].sort()).toEqual(starts);
    for (const t of res.sessions) {
      expect(t.session.parentSessionId).toBeNull();
      expect(t.hits).toBeGreaterThan(0);
    }
    expect(res.sessions.some((t) => t.session.id === SESSION_A)).toBe(true);
  });

  it("firstIdx is the session's earliest in-root hit — the jump target", () => {
    const timeline = searchTimeline(db, { query: 'useWebSocket' });
    const entry = timeline.sessions.find((t) => t.session.id === SESSION_A)!;
    const scoped = searchMessages(db, { query: 'useWebSocket', sessionId: SESSION_A });
    const minIdx = Math.min(...scoped.groups[0]!.hits.map((h) => h.idx));
    expect(entry.firstIdx).toBe(minIdx);
  });

  it('resolves subagent hits to the root, with firstIdx null for child-only matches', () => {
    // todo_sweep_gamma exists only inside the subagent transcript.
    const res = searchTimeline(db, { query: 'todo_sweep_gamma' });
    expect(res.sessions).toHaveLength(1);
    expect(res.sessions[0]!.session.id).toBe(SESSION_D);
    expect(res.sessions[0]!.firstIdx).toBeNull();
  });

  it('counts parent and child hits as one session', () => {
    // FIXME appears in both the parent session and its subagent transcript.
    const res = searchTimeline(db, { query: 'FIXME' });
    const ids = res.sessions.map((t) => t.session.id);
    expect(ids).toContain(SESSION_D);
    expect(new Set(ids).size).toBe(ids.length);
    const d = res.sessions.find((t) => t.session.id === SESSION_D)!;
    expect(d.firstIdx).not.toBeNull();
    const scoped = searchMessages(db, { query: 'FIXME', sessionId: SESSION_D });
    expect(d.hits).toBeGreaterThan(scoped.groups[0]!.hits.length);
  });

  it('supports operator-only queries and returns empty for empty input', () => {
    const res = searchTimeline(db, { query: 'kind:prompt' });
    expect(res.sessions.length).toBeGreaterThan(0);
    expect(searchTimeline(db, { query: '' }).sessions).toHaveLength(0);
    expect(searchTimeline(db, { query: '   ' }).sessions).toHaveLength(0);
  });
});

describe('path: operator (files join the query language)', () => {
  it('parses path: onto filters', () => {
    const parsed = parseSearchQuery('reconnect path:useWebSocket.ts');
    expect(parsed.terms).toBe('reconnect');
    expect(parsed.filters.path).toBe('useWebSocket.ts');
  });

  it('narrows hits to sessions whose family touched the file', () => {
    const res = searchMessages(db, { query: 'path:useWebSocket.ts' });
    expect(res.totalHits).toBeGreaterThan(0);
    for (const g of res.groups) expect(g.session.id).toBe(SESSION_A);
    // Combined with text: still only the touching session.
    const combined = searchMessages(db, { query: 'reconnect path:useWebSocket.ts' });
    expect(combined.groups.length).toBe(1);
    expect(combined.groups[0]!.session.id).toBe(SESSION_A);
    // A path nothing touched matches nothing.
    expect(searchMessages(db, { query: 'path:no-such-file.xyz' }).totalHits).toBe(0);
  });
});

describe('relative date sugar', () => {
  it('resolves Nd, today, and yesterday to ISO timestamps', () => {
    const after = parseSearchQuery('after:7d').filters.after!;
    expect(after).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const age = Date.now() - new Date(after).getTime();
    expect(age).toBeGreaterThan(6.9 * 86_400_000);
    expect(age).toBeLessThan(7.1 * 86_400_000);

    const today = new Date(parseSearchQuery('before:today').filters.before!);
    const yesterday = new Date(parseSearchQuery('after:yesterday').filters.after!);
    expect(today.getTime() - yesterday.getTime()).toBe(86_400_000);
  });

  it('keeps ISO prefixes verbatim and non-dates as text', () => {
    expect(parseSearchQuery('after:2026-07').filters.after).toBe('2026-07');
    const junk = parseSearchQuery('after:banana');
    expect(junk.filters.after).toBeUndefined();
    expect(junk.terms).toBe('after:banana');
  });
});
