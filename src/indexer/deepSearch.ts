import type Database from 'better-sqlite3';

/**
 * Deep search — the opt-in trigram index.
 *
 * The default `messages_fts` tokenizes with `unicode61`, so it matches whole
 * words: `ssionContext`, a UUID fragment, or half an error string find
 * nothing. FTS5's trigram tokenizer matches true substrings, which is the
 * one thing grep still did better than Turnlog.
 *
 * It is a SECOND external-content table over the same `messages` rows rather
 * than a replacement, because a trigram index costs several times the space
 * of a word index — so this is opt-in forever and the default stays lean.
 *
 * **The whole feature is this file.** Rather than teaching all four of the
 * existing write paths (insert, per-file re-scan delete, prune, rebuild)
 * about a table that usually does not exist, the build installs triggers on
 * `messages` and the drop removes them. `messages` rows are insert/delete
 * only — nothing ever updates `text` — so two triggers cover every path, and
 * code elsewhere stays unaware. The one exception is `rebuild()`, which wipes
 * in bulk and calls `resetDeepIndex` to avoid firing a trigger per row.
 */

/** Trigram matching needs three characters; shorter queries can't be served. */
export const DEEP_MIN_CHARS = 3;

export function hasDeepIndex(db: Database.Database): boolean {
  const row = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'messages_trigram'`)
    .get();
  return row !== undefined;
}

function createTriggers(db: Database.Database): void {
  db.exec(`
    CREATE TRIGGER messages_trigram_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_trigram (rowid, text) VALUES (new.rowid, new.text);
    END;
    CREATE TRIGGER messages_trigram_ad AFTER DELETE ON messages BEGIN
      INSERT INTO messages_trigram (messages_trigram, rowid, text)
        VALUES ('delete', old.rowid, old.text);
    END;
  `);
}

function dropTriggers(db: Database.Database): void {
  db.exec(`
    DROP TRIGGER IF EXISTS messages_trigram_ai;
    DROP TRIGGER IF EXISTS messages_trigram_ad;
  `);
}

/**
 * Build the trigram index from the messages already indexed, then keep it in
 * step via triggers. Safe to call when it already exists — it rebuilds.
 */
export function buildDeepIndex(db: Database.Database): void {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_trigram USING fts5(
      text,
      content='messages',
      tokenize='trigram'
    );
  `);
  dropTriggers(db);
  // 'rebuild' repopulates an external-content table from its content table —
  // no manual backfill, and it is the one command that cannot leave the two
  // out of step.
  db.exec(`INSERT INTO messages_trigram (messages_trigram) VALUES ('rebuild');`);
  createTriggers(db);
}

export function dropDeepIndex(db: Database.Database): void {
  dropTriggers(db);
  db.exec(`DROP TABLE IF EXISTS messages_trigram;`);
}

/**
 * Take the triggers down and empty the twin, for `rebuild()`'s bulk wipe.
 *
 * The triggers must be *inactive* across the wipe, not merely bypassed: a
 * `DELETE FROM messages` with the delete trigger live would issue one FTS
 * 'delete' per row against an index those rows are no longer in, and an
 * external-content table given a mismatched delete does not complain — it
 * corrupts, and the next query fails with "database disk image is malformed".
 *
 * Returns whether deep search was on, to hand back to `resumeDeepIndex`.
 */
export function suspendDeepIndex(db: Database.Database): boolean {
  if (!hasDeepIndex(db)) return false;
  dropTriggers(db);
  db.exec(`INSERT INTO messages_trigram (messages_trigram) VALUES ('delete-all');`);
  return true;
}

/** Reinstate the triggers after a bulk wipe; the re-scan then repopulates. */
export function resumeDeepIndex(db: Database.Database, wasActive: boolean): void {
  if (wasActive) createTriggers(db);
}
