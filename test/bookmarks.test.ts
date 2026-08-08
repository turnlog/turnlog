import { beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { Indexer } from '../src/indexer/indexer.js';
import {
  exportAnnotations,
  importAnnotations,
  listAllBookmarks,
  listBookmarkCaptions,
  listBookmarks,
  setBookmark,
} from '../src/server/api.js';
import { SESSION_A, copyCorpus, testDb, tmpDir } from './helpers.js';

let db: Database.Database;

beforeAll(async () => {
  db = testDb(tmpDir('turnlog-bookmarks-'));
  await new Indexer(db, { projectsDir: copyCorpus() }).scanAll();
});

describe('bookmark captions', () => {
  it('sets, edits, and clears a caption without disturbing the mark', () => {
    expect(setBookmark(db, SESSION_A, 3, true)).toContain(3);
    expect(listBookmarkCaptions(db, SESSION_A)[3]).toBeUndefined();

    setBookmark(db, SESSION_A, 3, true, 'the fix that finally worked');
    expect(listBookmarkCaptions(db, SESSION_A)[3]).toBe('the fix that finally worked');

    setBookmark(db, SESSION_A, 3, true, 'actually the root cause');
    expect(listBookmarkCaptions(db, SESSION_A)[3]).toBe('actually the root cause');

    setBookmark(db, SESSION_A, 3, true, '');
    expect(listBookmarkCaptions(db, SESSION_A)[3]).toBeUndefined();
    expect(listBookmarks(db, SESSION_A)).toContain(3); // still bookmarked
  });

  it('leaves an existing caption alone when none is supplied', () => {
    setBookmark(db, SESSION_A, 4, true, 'keep me');
    // The plain toggle path (no caption argument) must not wipe it — the
    // replay re-marks with on:true when writing other fields.
    setBookmark(db, SESSION_A, 4, true);
    expect(listBookmarkCaptions(db, SESSION_A)[4]).toBe('keep me');
  });

  it('drops the caption with the bookmark', () => {
    setBookmark(db, SESSION_A, 5, true, 'temporary');
    setBookmark(db, SESSION_A, 5, false);
    expect(listBookmarks(db, SESSION_A)).not.toContain(5);
    setBookmark(db, SESSION_A, 5, true);
    expect(listBookmarkCaptions(db, SESSION_A)[5]).toBeUndefined();
  });

  it('never bookmarks thin air', () => {
    expect(setBookmark(db, SESSION_A, 99999, true, 'nope')).toBeNull();
  });
});

describe('the bookmarks page query', () => {
  it('lists every marked moment with what it needs to be recognised', () => {
    setBookmark(db, SESSION_A, 6, true, 'the websocket insight');
    const { bookmarks } = listAllBookmarks(db);
    const entry = bookmarks.find((b) => b.sessionId === SESSION_A && b.idx === 6)!;
    expect(entry.caption).toBe('the websocket insight');
    expect(entry.text.length).toBeGreaterThan(0); // the marked message itself
    expect(entry.tool).toBe('claude-code');
    expect(entry.projectKey).toBe('-Users-dev-projects-webapp');
  });

  it('keeps a bookmark whose message is no longer indexed', () => {
    // A log rewritten between runs can strand a bookmark. It must still list
    // (caption and jump intact) rather than vanishing silently.
    db.prepare(
      `INSERT INTO message_bookmarks (session_id, idx, created_at, caption)
       VALUES (?, 424242, ?, ?)`,
    ).run(SESSION_A, new Date().toISOString(), 'orphan');
    const { bookmarks } = listAllBookmarks(db);
    const orphan = bookmarks.find((b) => b.idx === 424242)!;
    expect(orphan.caption).toBe('orphan');
    expect(orphan.text).toBe('');
  });
});

describe('captions in the annotations dump', () => {
  it('round-trips through export and import', () => {
    setBookmark(db, SESSION_A, 7, true, 'survives a restore');
    const dump = exportAnnotations(db);
    const carried = dump.bookmarks.find((b) => b.idx === 7)!;
    expect(carried.caption).toBe('survives a restore');

    const fresh = testDb(tmpDir('turnlog-bm-import-'));
    importAnnotations(fresh, dump);
    expect(listBookmarkCaptions(fresh, SESSION_A)[7]).toBe('survives a restore');
  });

  it('re-importing reports nothing new but still lets the file win', () => {
    const fresh = testDb(tmpDir('turnlog-bm-twice-'));
    const dump = {
      version: 1 as const,
      sessionMeta: [],
      bookmarks: [{ sessionId: SESSION_A, idx: 9, createdAt: null, caption: 'first' }],
      savedSearches: [],
    };
    expect(importAnnotations(fresh, dump).bookmarks).toBe(1);
    // Same file again: additive, so nothing is new.
    expect(importAnnotations(fresh, dump).bookmarks).toBe(0);
    // A newer caption in the file still wins, without counting as a bookmark.
    dump.bookmarks[0]!.caption = 'second';
    expect(importAnnotations(fresh, dump).bookmarks).toBe(0);
    expect(listBookmarkCaptions(fresh, SESSION_A)[9]).toBe('second');
  });

  it('imports a pre-caption export unchanged', () => {
    const fresh = testDb(tmpDir('turnlog-bm-old-'));
    const old = {
      version: 1 as const,
      sessionMeta: [],
      bookmarks: [{ sessionId: SESSION_A, idx: 2, createdAt: null }],
      savedSearches: [],
    };
    expect(() => importAnnotations(fresh, old)).not.toThrow();
    expect(listBookmarks(fresh, SESSION_A)).toBeNull(); // session not indexed here
  });
});
