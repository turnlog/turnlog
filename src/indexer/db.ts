import fs from 'node:fs';
import Database from 'better-sqlite3';

export const SCHEMA_VERSION = 14;

export function openDb(path: string): Database.Database {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  migrate(db);
  return db;
}

/**
 * Truncate the write-ahead log. SQLite's automatic checkpoints are passive:
 * they never shrink the file, and they give up whenever a reader is mid-query
 * — so under a long-lived server the WAL grows without bound (seen in the
 * wild: a 782MB WAL beside a 780MB database). Never throws; a checkpoint that
 * loses the race with a reader is a no-op the next scan retries.
 */
export function checkpointWal(db: Database.Database): void {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch {
    // Busy: readers hold the WAL open. Nothing is wrong, and nothing is lost.
  }
}

/**
 * The index's real footprint — the database plus its `-wal` and `-shm`
 * sidecars. Page math (`page_count × page_size`) measures the main file only,
 * which can be half the bytes actually on disk. Falls back to it for
 * in-memory databases, which have no files to stat.
 */
export function indexBytes(db: Database.Database): number {
  const pageBytes = () =>
    (db.pragma('page_count', { simple: true }) as number) *
    (db.pragma('page_size', { simple: true }) as number);
  const main = db.name;
  if (!main || main === ':memory:') return pageBytes();
  let total = 0;
  for (const p of [main, `${main}-wal`, `${main}-shm`]) {
    try {
      total += fs.statSync(p).size;
    } catch {
      // The sidecars exist only while a WAL connection is open.
    }
  }
  return total > 0 ? total : pageBytes();
}

function migrate(db: Database.Database): void {
  const version = db.pragma('user_version', { simple: true }) as number;
  if (version >= SCHEMA_VERSION) return;

  if (version < 1) {
    db.exec(`
      CREATE TABLE sessions (
        id                  TEXT PRIMARY KEY,
        project_path        TEXT,
        project_key         TEXT,
        file_path           TEXT NOT NULL UNIQUE,
        started_at          TEXT,
        ended_at            TEXT,
        model               TEXT,
        turn_count          INTEGER NOT NULL DEFAULT 0,
        input_tokens        INTEGER NOT NULL DEFAULT 0,
        output_tokens       INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens   INTEGER NOT NULL DEFAULT 0,
        cache_write_tokens  INTEGER NOT NULL DEFAULT 0,
        cost_usd            REAL,
        files_touched_count INTEGER NOT NULL DEFAULT 0,
        adapter_version     INTEGER NOT NULL,
        file_byte_offset    INTEGER NOT NULL DEFAULT 0,
        file_mtime_ms       REAL,
        file_size           INTEGER,
        line_count          INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_sessions_started ON sessions(started_at);
      CREATE INDEX idx_sessions_project ON sessions(project_key);

      CREATE TABLE messages (
        uuid               TEXT NOT NULL,
        session_id         TEXT NOT NULL,
        parent_uuid        TEXT,
        idx                INTEGER NOT NULL,
        role               TEXT,
        kind               TEXT NOT NULL,
        tool_name          TEXT,
        tool_use_id        TEXT,
        ts                 TEXT,
        is_sidechain       INTEGER NOT NULL DEFAULT 0,
        tokens_in          INTEGER NOT NULL DEFAULT 0,
        tokens_out         INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
        cache_write_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd           REAL,
        model              TEXT,
        text               TEXT NOT NULL DEFAULT '',
        raw_json           TEXT NOT NULL,
        UNIQUE (session_id, uuid)
      );
      CREATE INDEX idx_messages_session ON messages(session_id, idx);

      CREATE TABLE files_touched (
        session_id  TEXT NOT NULL,
        path        TEXT NOT NULL,
        change_kind TEXT NOT NULL,
        UNIQUE (session_id, path, change_kind)
      );
      CREATE INDEX idx_files_touched_session ON files_touched(session_id);

      CREATE VIRTUAL TABLE messages_fts USING fts5(
        text,
        content='messages',
        tokenize="unicode61 tokenchars '_$.'",
        prefix='2 3'
      );
    `);
  }

  if (version < 2) {
    // Failure flag normalized out of raw JSON; backfill happens via the
    // ADAPTER_VERSION bump that ships alongside (forces a full reindex).
    db.exec(`ALTER TABLE messages ADD COLUMN is_error INTEGER NOT NULL DEFAULT 0;`);
  }

  if (version < 3) {
    // message_id: API response id, for counting usage once per response.
    // parent_session_id: subagent transcripts (<session>/subagents/*.jsonl)
    // link to the session that spawned them. Backfill via the ADAPTER_VERSION
    // bump shipped alongside (forces a full reindex).
    db.exec(`
      ALTER TABLE messages ADD COLUMN message_id TEXT;
      ALTER TABLE sessions ADD COLUMN parent_session_id TEXT;
    `);
  }

  if (version < 4) {
    // User annotations (pin/name/note), written by the UI. Deliberately a
    // separate table: rebuild() wipes the derived index tables, this one
    // survives. No ADAPTER_VERSION bump — normalization is unchanged.
    db.exec(`
      CREATE TABLE session_meta (
        session_id  TEXT PRIMARY KEY,
        pinned      INTEGER NOT NULL DEFAULT 0,
        custom_name TEXT,
        note        TEXT,
        updated_at  TEXT
      );
    `);
  }

  if (version < 5) {
    // Saved searches, written by the UI. Like session_meta: user data, not
    // derived from logs — rebuild() leaves it alone. No ADAPTER_VERSION bump.
    db.exec(`
      CREATE TABLE saved_searches (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL,
        query      TEXT NOT NULL,
        created_at TEXT
      );
    `);
  }

  if (version < 6) {
    // Message-level bookmarks ("mark this moment"), written by the UI.
    // User data like session_meta: rebuild() leaves it alone, and (session,
    // idx) stays valid across reindexes — idx is line-ordered and the logs
    // are append-only. No ADAPTER_VERSION bump.
    db.exec(`
      CREATE TABLE message_bookmarks (
        session_id TEXT NOT NULL,
        idx        INTEGER NOT NULL,
        created_at TEXT,
        PRIMARY KEY (session_id, idx)
      );
    `);
  }

  if (version < 7) {
    // ui_prefs: server-side UI preferences, written by the web UI. The random
    // per-launch port gives the browser a fresh origin every run, so
    // localStorage resets — the index dir is the stable home. User data like
    // session_meta: rebuild() leaves it alone.
    //
    // root_uuid: the uuid of a session's first real message. Resuming into a
    // new session id copies the whole history forward (same message uuids,
    // rewritten sessionId), so files sharing a root_uuid are one logical
    // conversation — the resume-chain linkage. Backfilled here from messages
    // (fallback uuids are '<sessionId>:<line>', never shared across files),
    // computed by the indexer from now on; no reindex needed.
    db.exec(`
      CREATE TABLE ui_prefs (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at TEXT
      );
      ALTER TABLE sessions ADD COLUMN root_uuid TEXT;
      UPDATE sessions SET root_uuid = (
        SELECT m.uuid FROM messages m
        WHERE m.session_id = sessions.id
          AND m.role IN ('user', 'assistant')
          AND m.uuid NOT LIKE sessions.id || ':%'
        ORDER BY m.idx LIMIT 1
      );
      CREATE INDEX idx_sessions_root ON sessions(root_uuid);
    `);
  }

  if (version < 8) {
    // CC's own session titles, lifted off 'ai-title' / 'custom-title' records
    // (kind 'title' since adapter v4). cc_title is the user-set one and wins
    // over ai_title in display; Turnlog's session_meta.custom_name outranks
    // both. Backfill rides the ADAPTER_VERSION bump's full reindex.
    db.exec(`
      ALTER TABLE sessions ADD COLUMN ai_title TEXT;
      ALTER TABLE sessions ADD COLUMN cc_title TEXT;
    `);
  }

  if (version < 9) {
    // Multi-tool groundwork (Phase 5): which agent wrote the session.
    // Existing rows are all Claude Code, so the default backfills them —
    // no reindex needed.
    db.exec(`
      ALTER TABLE sessions ADD COLUMN tool TEXT NOT NULL DEFAULT 'claude-code';
    `);
  }

  if (version < 10) {
    // Session tags. User data, like session_meta and saved searches: rebuild()
    // wipes the derived tables and leaves this one alone, so re-indexing never
    // costs you your organisation. Free-form and lower-cased on the way in, so
    // `Refactor` and `refactor` are one tag rather than two.
    db.exec(`
      CREATE TABLE session_tags (
        session_id TEXT NOT NULL,
        tag        TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (session_id, tag)
      );
      CREATE INDEX idx_session_tags_tag ON session_tags(tag);
    `);
  }

  if (version < 11) {
    // turn_count never counted turns — it is COUNT(*) over a session's
    // messages, so a 38-turn session read as "2,786 turns". The number was
    // always right and the word always wrong; `events` is what the rest of
    // the codebase already calls this quantity (IndexFacts.events, the
    // subagent row's "N events"). Renaming the column keeps the lie from
    // being re-learned. No reindex: the values are unchanged.
    db.exec(`ALTER TABLE sessions RENAME COLUMN turn_count TO event_count;`);
  }

  if (version < 12) {
    // A caption per bookmark. Thirty bare marks are thirty 240-character
    // prefixes to re-read; a note ("the fix that finally worked") is what
    // makes a collection of moments usable. Nullable, so every existing
    // bookmark stays exactly as valid as it was.
    db.exec(`ALTER TABLE message_bookmarks ADD COLUMN caption TEXT;`);
  }

  if (version < 13) {
    // How many messages each term appears in, straight from the FTS index —
    // what makes `like:` able to tell a distinctive word from a common one
    // without a stopword list. A view over messages_fts, not a copy: no
    // storage, never stale, and rebuild()'s 'delete-all' leaves it valid.
    db.exec(`CREATE VIRTUAL TABLE messages_vocab USING fts5vocab(messages_fts, 'row');`);
  }

  if (version < 14) {
    // The branch a record was written on. Per message, not per session: a long
    // session can cross branches, and "what did we do on feature/auth" should
    // mean the work done there, not every session that ever touched it. The
    // session column is the last-seen value, for the header and the facets.
    // Backfilled by the ADAPTER_VERSION bumps shipping alongside.
    db.exec(`
      ALTER TABLE messages ADD COLUMN git_branch TEXT;
      ALTER TABLE sessions ADD COLUMN branch TEXT;
      CREATE INDEX idx_messages_branch ON messages(git_branch) WHERE git_branch IS NOT NULL;
    `);
  }

  db.pragma(`user_version = ${SCHEMA_VERSION}`);
}
