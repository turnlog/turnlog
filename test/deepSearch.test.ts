import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { Indexer } from '../src/indexer/indexer.js';
import {
  buildDeepIndex,
  dropDeepIndex,
  hasDeepIndex,
} from '../src/indexer/deepSearch.js';
import { pruneMissingSessions } from '../src/server/api.js';
import { copyCorpus, testDb, tmpDir } from './helpers.js';

/**
 * The trigram index is kept in step by triggers rather than by the four write
 * paths that touch messages_fts. These tests exercise each of those paths and
 * assert the twin agrees with the content table afterwards — an
 * external-content FTS table that drifts returns phantom rows rather than
 * failing loudly, so drift has to be asserted, not assumed.
 */

function trigramCount(db: Database.Database, needle: string): number {
  const row = db
    .prepare(`SELECT count(*) c FROM messages_trigram WHERE messages_trigram MATCH ?`)
    .get(needle) as { c: number };
  return row.c;
}

/** Rows the twin holds vs rows it should hold. */
function integrity(db: Database.Database): { indexed: number; messages: number } {
  const indexed = (
    db.prepare(`SELECT count(*) c FROM messages_trigram`).get() as { c: number }
  ).c;
  const messages = (db.prepare(`SELECT count(*) c FROM messages`).get() as { c: number }).c;
  return { indexed, messages };
}

let db: Database.Database;
let projectsDir: string;

beforeEach(async () => {
  db = testDb(tmpDir('turnlog-deep-'));
  projectsDir = copyCorpus();
  await new Indexer(db, { projectsDir }).scanAll();
});

describe('deep search', () => {
  it('is absent until built, and reports itself either way', () => {
    expect(hasDeepIndex(db)).toBe(false);
    buildDeepIndex(db);
    expect(hasDeepIndex(db)).toBe(true);
    dropDeepIndex(db);
    expect(hasDeepIndex(db)).toBe(false);
  });

  it('matches a substring the word index cannot', () => {
    // 'useWebSocket' is in the corpus; 'eWebSock' starts mid-word, so the
    // unicode61 index cannot reach it however it is queried. That gap is the
    // whole reason this feature exists.
    const wordHits = (
      db
        .prepare(`SELECT count(*) c FROM messages_fts WHERE messages_fts MATCH ?`)
        .get('"eWebSock"') as { c: number }
    ).c;
    expect(wordHits).toBe(0);

    buildDeepIndex(db);
    expect(trigramCount(db, 'eWebSock')).toBeGreaterThan(0);
  });

  it('covers rows indexed before it existed', () => {
    buildDeepIndex(db);
    expect(integrity(db)).toMatchObject({ indexed: integrity(db).messages });
  });

  it('picks up rows indexed after it was built', () => {
    buildDeepIndex(db);
    const before = integrity(db);
    // Re-scanning the same corpus inserts nothing (uuids dedupe), so reach
    // the insert path directly — this is what the indexer does per message,
    // and only the trigger keeps the twin in step with it.
    db.prepare(
      `INSERT INTO messages (uuid, session_id, idx, role, kind, text, raw_json)
       SELECT 'deep-test-uuid', session_id, 9999, 'user', 'prompt',
              'a laterAddedIdentifier arrived', '{}'
         FROM messages LIMIT 1`,
    ).run();

    const after = integrity(db);
    expect(after.messages).toBe(before.messages + 1);
    expect(after.indexed).toBe(after.messages);
    expect(trigramCount(db, 'terAddedIdent')).toBe(1);
  });

  it('stays in step when sessions are pruned', () => {
    buildDeepIndex(db);
    // Point the index at files that no longer exist, then prune them.
    db.prepare(`UPDATE sessions SET file_path = file_path || '.gone'`).run();
    const { pruned } = pruneMissingSessions(db);
    expect(pruned).toBeGreaterThan(0);
    const { indexed, messages } = integrity(db);
    expect(messages).toBe(0);
    expect(indexed).toBe(0);
  });

  it('survives a rebuild without drifting', async () => {
    buildDeepIndex(db);
    await new Indexer(db, { projectsDir }).rebuild();
    const { indexed, messages } = integrity(db);
    expect(messages).toBeGreaterThan(0);
    expect(indexed).toBe(messages);
    expect(hasDeepIndex(db)).toBe(true);
  });

  it('leaves the word index untouched when dropped', () => {
    const wordHits = () =>
      (
        db
          .prepare(`SELECT count(*) c FROM messages_fts WHERE messages_fts MATCH ?`)
          .get('"indexer"') as { c: number }
      ).c;
    const before = wordHits();
    buildDeepIndex(db);
    dropDeepIndex(db);
    expect(wordHits()).toBe(before);
  });
});
