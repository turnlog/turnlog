import { beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { Indexer } from '../src/indexer/indexer.js';
import {
  distinctiveTerms,
  getFileHistory,
  getSession,
  parseSearchQuery,
  relatedSessions,
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

describe('quoted operator values', () => {
  it('keeps a quoted value whole instead of splitting on its space', () => {
    const parsed = parseSearchQuery('tag:"needs review" hello');
    expect(parsed.filters.tag).toBe('needs review');
    expect(parsed.terms).toBe('hello');
  });

  it('leaves a bare value alone', () => {
    expect(parseSearchQuery('tag:refactor').filters.tag).toBe('refactor');
  });

  it('still treats a quoted phrase with no operator as search text', () => {
    const parsed = parseSearchQuery('"web socket"');
    expect(parsed.hasFilters).toBe(false);
    expect(parsed.terms).toContain('web socket');
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

describe('like: — related sessions', () => {
  it('builds its terms from the session and excludes its own chain family', () => {
    const terms = distinctiveTerms(db, SESSION_A);
    expect(terms.length).toBeGreaterThan(0);
    // Rarity ranking, not a stopword list: nothing generic survives.
    expect(terms).not.toContain('the');

    const res = searchMessages(db, { query: `like:${SESSION_A}` });
    expect(res.groups.length).toBeGreaterThan(0);
    // The source conversation is not "related" to itself.
    expect(res.groups.map((g) => g.session.id)).not.toContain(SESSION_A);
  });

  it('accepts a unique id prefix, like every other place ids are typed', () => {
    const full = searchMessages(db, { query: `like:${SESSION_A}` });
    const prefix = searchMessages(db, { query: `like:${SESSION_A.slice(0, 8)}` });
    expect(prefix.groups.map((g) => g.session.id)).toEqual(full.groups.map((g) => g.session.id));
  });

  it('narrows rather than widens when text is typed alongside it', () => {
    const alone = searchMessages(db, { query: `like:${SESSION_A}` }).totalHits;
    const narrowed = searchMessages(db, {
      query: `like:${SESSION_A} zzzznotinthecorpus`,
    }).totalHits;
    expect(narrowed).toBeLessThanOrEqual(alone);
    expect(narrowed).toBe(0);
  });

  it('returns nothing for an unknown session rather than everything', () => {
    // The failure that matters: a bad id must not fall through to an
    // unfiltered match set.
    expect(searchMessages(db, { query: 'like:no-such-session' }).totalHits).toBe(0);
    expect(relatedSessions(db, 'no-such-session').sessions).toEqual([]);
  });

  it('credits a subagent transcript to the run it belongs to', () => {
    // Children are hidden from every list; a match inside one means the
    // PARENT session is related, not some transcript the user never sees.
    const related = relatedSessions(db, SESSION_A, 10);
    for (const r of related.sessions) {
      expect(r.session.parentSessionId).toBeNull();
    }
  });

  it('surfaces the same answer through relatedSessions, with its terms', () => {
    const related = relatedSessions(db, SESSION_A, 3);
    expect(related.terms.length).toBeGreaterThan(0);
    expect(related.sessions.length).toBeGreaterThan(0);
    expect(related.sessions.length).toBeLessThanOrEqual(3);
    for (const r of related.sessions) {
      expect(r.session.id).not.toBe(SESSION_A);
      expect(r.hits).toBeGreaterThan(0);
    }
  });
});

describe('branch: — git branch as a search dimension', () => {
  it('narrows to the work done on one branch, exactly', () => {
    const onFeature = searchMessages(db, { query: 'branch:feature/auth' });
    expect(onFeature.totalHits).toBeGreaterThan(0);
    expect(onFeature.groups.map((g) => g.session.id)).toEqual([SESSION_C]);

    // Exact, not a substring: a prefix of a real branch matches nothing,
    // so `branch:main` can never drag in `main-experiment`.
    expect(searchMessages(db, { query: 'branch:feature' }).totalHits).toBe(0);
  });

  it('is case-insensitive, the way branch names are typed', () => {
    const exact = searchMessages(db, { query: 'branch:feature/auth' }).totalHits;
    expect(searchMessages(db, { query: 'branch:FEATURE/Auth' }).totalHits).toBe(exact);
  });

  it('composes with text and with the rest of the grammar', () => {
    const all = searchMessages(db, { query: 'branch:main' }).totalHits;
    expect(all).toBeGreaterThan(0);
    const narrowed = searchMessages(db, { query: 'branch:main is:error' }).totalHits;
    expect(narrowed).toBeLessThan(all);
    // A branch that exists AND a term that does not still yields nothing.
    expect(searchMessages(db, { query: 'branch:main zzzznotinthecorpus' }).totalHits).toBe(0);
  });

  it('offers branches as a refine dimension, counted per message', () => {
    const facets = searchMessages(db, { query: 'kind:prompt' }).facets;
    const values = (facets?.branches ?? []).map((f) => f.value).sort();
    expect(values).toContain('main');
    expect(values).toContain('feature/auth');
    for (const f of facets?.branches ?? []) {
      expect(f.operator).toBe(`branch:${f.value}`);
    }
  });

  it('puts the last branch seen on the session row', () => {
    const s = getSession(db, SESSION_C);
    expect(s?.branch).toBe('feature/auth');
    expect(getSession(db, SESSION_A)?.branch).toBe('main');
  });
});

describe('MCP calls — parsed, not mangled', () => {
  it('tool: matches the bare tool half of an mcp__server__tool name', () => {
    const res = searchMessages(db, { query: 'tool:browser_navigate' });
    expect(res.totalHits).toBeGreaterThan(0);
    // The raw mangled string still matches exactly — nothing breaks.
    const raw = searchMessages(db, { query: 'tool:mcp__Playwright__browser_navigate' });
    expect(raw.totalHits).toBe(res.totalHits);
    // And a non-MCP tool is untouched by the widened clause.
    expect(searchMessages(db, { query: 'tool:Bash' }).totalHits).toBeGreaterThan(0);
  });

  it("tool: + is:error finds the failing runs of a tool — the grammar's own example", () => {
    // Pre-existing hole: the error flag lives on the result row, the tool
    // name on the use row — requiring both on one row matched nothing, ever.
    expect(searchMessages(db, { query: 'tool:Bash is:error' }).totalHits).toBeGreaterThan(0);
    expect(
      searchMessages(db, { query: 'is:error tool:Bash project:api' }).totalHits,
    ).toBeGreaterThan(0);
    // Alone, is:error still counts failing RESULTS only — one per failure.
    const alone = searchMessages(db, { query: 'is:error' }).totalHits;
    expect(alone).toBeGreaterThan(0);
  });

  it('server: narrows to one MCP server, by fragment', () => {
    const hits = searchMessages(db, { query: 'server:playwright' });
    expect(hits.totalHits).toBeGreaterThan(0);
    expect(searchMessages(db, { query: 'server:context7' }).totalHits).toBeGreaterThan(0);
    expect(searchMessages(db, { query: 'server:nosuchserver' }).totalHits).toBe(0);
    // Composes with the rest of the grammar.
    expect(
      searchMessages(db, { query: 'server:context7 is:error' }).totalHits,
    ).toBeGreaterThan(0);
  });

  it('offers MCP servers as a refine dimension with readable tool labels', () => {
    // The servers dimension only ever holds MCP rows, so both appear no
    // matter how many plain tools share the match set.
    const facets = searchMessages(db, { query: 'kind:tool_use' }).facets;
    const servers = (facets?.servers ?? []).map((f) => f.value).sort();
    expect(servers).toEqual(['Context7', 'Playwright']);
    // The tools dimension is capped at 6; the Context7 call is the MCP name
    // that makes the cut (BINARY tie order), and one is all a label needs.
    const mcpTool = (facets?.tools ?? []).find(
      (f) => f.value === 'mcp__Context7__resolve_library_id',
    );
    expect(mcpTool?.label).toBe('Context7 · resolve_library_id');
    // The operator keeps the raw string, so the chip's count is exact.
    expect(mcpTool?.operator).toBe('tool:mcp__Context7__resolve_library_id');
  });
});
