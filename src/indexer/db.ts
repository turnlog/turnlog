import Database from 'better-sqlite3';

export const SCHEMA_VERSION = 1;

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

  db.pragma(`user_version = ${SCHEMA_VERSION}`);
}
