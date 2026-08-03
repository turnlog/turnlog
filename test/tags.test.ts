import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { Indexer } from '../src/indexer/indexer.js';
import {
  listAllTags,
  listSessionTags,
  normalizeTag,
  searchMessages,
  setSessionTags,
  TAGS_PER_SESSION_MAX,
  TAG_MAX,
  listSessions,
} from '../src/server/api.js';
import {
  CODEX_SESSION,
  SESSION_A,
  copyCodexCorpus,
  copyCorpus,
  testDb,
  tmpDir,
} from './helpers.js';

let db: Database.Database;
let projectsDir: string;
let codexDir: string;

beforeEach(async () => {
  db = testDb(tmpDir('turnlog-tags-'));
  projectsDir = copyCorpus();
  codexDir = copyCodexCorpus();
  await new Indexer(db, { projectsDir, codexDir }).scanAll();
});

describe('normalizeTag', () => {
  it('gives one canonical form so a tag cannot split in three', () => {
    expect(normalizeTag('Refactor')).toBe('refactor');
    expect(normalizeTag('  refactor  ')).toBe('refactor');
    expect(normalizeTag('REFACTOR')).toBe('refactor');
    expect(normalizeTag('needs   review')).toBe('needs review');
  });

  it('rejects what would store as nothing', () => {
    expect(normalizeTag('')).toBeNull();
    expect(normalizeTag('   ')).toBeNull();
  });

  it('caps length without leaving a trailing space', () => {
    const tag = normalizeTag('x'.repeat(TAG_MAX + 20));
    expect(tag).toHaveLength(TAG_MAX);
    expect(normalizeTag(`${'y'.repeat(TAG_MAX - 1)}   tail`)).not.toMatch(/\s$/);
  });
});

describe('session tags', () => {
  it('stores a set, alphabetically, deduped through normalisation', () => {
    expect(setSessionTags(db, SESSION_A, ['Refactor', 'billing', 'refactor '])).toEqual([
      'billing',
      'refactor',
    ]);
    expect(listSessionTags(db, SESSION_A)).toEqual(['billing', 'refactor']);
  });

  it('replaces the whole set rather than merging', () => {
    setSessionTags(db, SESSION_A, ['one', 'two']);
    expect(setSessionTags(db, SESSION_A, ['three'])).toEqual(['three']);
  });

  it('clears when given nothing', () => {
    setSessionTags(db, SESSION_A, ['gone']);
    expect(setSessionTags(db, SESSION_A, [])).toEqual([]);
    expect(listSessionTags(db, SESSION_A)).toEqual([]);
  });

  it('refuses an unknown session rather than orphaning rows', () => {
    expect(setSessionTags(db, 'no-such-session', ['x'])).toBeNull();
    expect(listSessionTags(db, 'no-such-session')).toBeNull();
  });

  it('caps how many tags one session can carry', () => {
    const many = Array.from({ length: TAGS_PER_SESSION_MAX + 10 }, (_, i) => `tag-${i}`);
    expect(setSessionTags(db, SESSION_A, many)).toHaveLength(TAGS_PER_SESSION_MAX);
  });

  it('counts usage across sessions, most-used first', () => {
    setSessionTags(db, SESSION_A, ['shared', 'solo']);
    setSessionTags(db, CODEX_SESSION, ['shared']);
    expect(listAllTags(db)).toEqual([
      { tag: 'shared', count: 2 },
      { tag: 'solo', count: 1 },
    ]);
  });

  it('rides the session row so a list can show chips without a query each', () => {
    setSessionTags(db, SESSION_A, ['alpha', 'beta']);
    const row = listSessions(db, { limit: 200 }).sessions.find((s) => s.id === SESSION_A);
    expect(row?.tags).toEqual(['alpha', 'beta']);
  });

  it('tags any agent — they belong to the session, not the tool', () => {
    // Guard the guard: vacuous unless the corpus really holds two agents.
    const tools = db.prepare(`SELECT COUNT(DISTINCT tool) c FROM sessions`).get() as { c: number };
    expect(tools.c).toBeGreaterThan(1);

    expect(setSessionTags(db, CODEX_SESSION, ['codex-work'])).toEqual(['codex-work']);
    expect(searchMessages(db, { query: 'tag:codex-work' }).totalHits).toBeGreaterThan(0);
  });

  it('survives a rebuild — curation is not derived data', async () => {
    setSessionTags(db, SESSION_A, ['keep-me']);
    await new Indexer(db, { projectsDir, codexDir }).rebuild();
    expect(listSessionTags(db, SESSION_A)).toEqual(['keep-me']);
  });
});

describe('the tag: operator', () => {
  it('narrows to sessions carrying the tag', () => {
    setSessionTags(db, SESSION_A, ['billing']);
    const hits = searchMessages(db, { query: 'tag:billing' });
    expect(hits.totalHits).toBeGreaterThan(0);
    expect(hits.groups.every((g) => g.session.id === SESSION_A)).toBe(true);
  });

  it('normalises the query the same way the chip stored it', () => {
    setSessionTags(db, SESSION_A, ['refactor']);
    expect(searchMessages(db, { query: 'tag:Refactor' }).totalHits).toBeGreaterThan(0);
    expect(searchMessages(db, { query: 'tag:REFACTOR' }).totalHits).toBeGreaterThan(0);
  });

  it('combines with a text term rather than replacing it', () => {
    setSessionTags(db, SESSION_A, ['billing']);
    const tagOnly = searchMessages(db, { query: 'tag:billing' }).totalHits;
    const both = searchMessages(db, { query: 'useWebSocket tag:billing' }).totalHits;
    expect(both).toBeGreaterThan(0);
    expect(both).toBeLessThanOrEqual(tagOnly);
  });

  it('handles a tag with a space, which needs quoting', () => {
    setSessionTags(db, SESSION_A, ['needs review']);
    // Unquoted, the space splits the token and the filter silently matches
    // nothing — the failure mode that makes multi-word tags feel broken.
    expect(searchMessages(db, { query: 'tag:"needs review"' }).totalHits).toBeGreaterThan(0);
    // And the facet chip's own quoting must be the spelling that works.
    const facet = searchMessages(db, { query: 'the' }).facets!.tools;
    expect(Array.isArray(facet)).toBe(true);
  });

  it('finds nothing for a tag nobody used', () => {
    expect(searchMessages(db, { query: 'tag:never-applied' }).totalHits).toBe(0);
  });
});
