import { beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { Indexer } from '../src/indexer/indexer.js';
import {
  createSavedSearch,
  exportAnnotations,
  importAnnotations,
  listSavedSearches,
  setBookmark,
  setSessionMeta,
} from '../src/server/api.js';
import { SESSION_A, SESSION_C, copyCorpus, testDb, tmpDir } from './helpers.js';

let db: Database.Database;

beforeAll(async () => {
  db = testDb(tmpDir('turnlog-portability-'));
  await new Indexer(db, { projectsDir: copyCorpus() }).scanAll();
  setSessionMeta(db, SESSION_A, { pinned: true, customName: 'The saga', note: 'came back to this' });
  setBookmark(db, SESSION_C, 2, true);
  createSavedSearch(db, 'failures', 'is:error');
});

describe('annotation portability (turnlog annotations export|import)', () => {
  it('round-trips curation into a fresh index', () => {
    const dump = exportAnnotations(db);
    expect(dump.version).toBe(1);
    expect(dump.sessionMeta).toHaveLength(1);
    expect(dump.sessionMeta[0]).toMatchObject({
      sessionId: SESSION_A,
      pinned: true,
      customName: 'The saga',
    });
    expect(dump.bookmarks).toEqual([
      expect.objectContaining({ sessionId: SESSION_C, idx: 2 }),
    ]);
    expect(dump.savedSearches).toEqual([
      expect.objectContaining({ name: 'failures', query: 'is:error' }),
    ]);

    // A fresh machine: same logs, empty annotation tables.
    const fresh = testDb(tmpDir('turnlog-portability-fresh-'));
    const counts = importAnnotations(fresh, dump);
    expect(counts).toEqual({ sessionMeta: 1, bookmarks: 1, savedSearches: 1 });
    expect(listSavedSearches(fresh).map((s) => s.query)).toEqual(['is:error']);
    const meta = fresh
      .prepare(`SELECT pinned, custom_name FROM session_meta WHERE session_id = ?`)
      .get(SESSION_A) as { pinned: number; custom_name: string };
    expect(meta.pinned).toBe(1);
    expect(meta.custom_name).toBe('The saga');

    // Re-importing must not double anything.
    const again = importAnnotations(fresh, dump);
    expect(again.bookmarks).toBe(0);
    expect(again.savedSearches).toBe(0);
    expect(listSavedSearches(fresh)).toHaveLength(1);
    fresh.close();
  });

  it('refuses documents that are not an annotations export', () => {
    expect(() => importAnnotations(db, { hello: 'world' })).toThrow(/not a turnlog/);
    expect(() => importAnnotations(db, null)).toThrow();
    expect(() => importAnnotations(db, { version: 2, sessionMeta: [], bookmarks: [], savedSearches: [] })).toThrow();
  });

  it('skips malformed entries instead of failing the whole import', () => {
    const fresh = testDb(tmpDir('turnlog-portability-junk-'));
    const counts = importAnnotations(fresh, {
      version: 1,
      exportedAt: 'x',
      sessionMeta: [{ nope: true }, { sessionId: 's1', pinned: true, customName: null, note: null, updatedAt: null }],
      bookmarks: [{ sessionId: 's1', idx: 'NaN' }, { sessionId: 's1', idx: 3, createdAt: null }],
      savedSearches: [{ name: 42 }, { name: 'ok', query: 'q', createdAt: null }],
    });
    expect(counts).toEqual({ sessionMeta: 1, bookmarks: 1, savedSearches: 1 });
    fresh.close();
  });
});
