import Database from 'better-sqlite3';

export const SCHEMA_VERSION = 6;

export function openDb(path: string): Database.Database {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  migrate(db);
  return db;
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

  db.pragma(`user_version = ${SCHEMA_VERSION}`);
}
