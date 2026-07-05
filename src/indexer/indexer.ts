import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { readLines } from '../parser/lineReader.js';
import { normalizeLine } from '../parser/normalize.js';
import type { NormalizedRecord } from '../parser/types.js';
import { computeCost, type ModelPricing } from '../cost/pricing.js';
import { ADAPTER_VERSION } from '../version.js';

export interface IndexProgress {
  filesTotal: number;
  filesDone: number;
  currentFile: string;
}

export interface ScanSummary {
  filesSeen: number;
  filesIndexed: number;
  linesParsed: number;
  errors: Array<{ file: string; message: string }>;
}

export interface IndexerOptions {
  projectsDir: string;
  pricingOverrides?: Record<string, Partial<ModelPricing>>;
}

interface SessionFileRow {
  id: string;
  file_byte_offset: number;
  file_mtime_ms: number | null;
  file_size: number | null;
  line_count: number;
  adapter_version: number;
}

const BATCH_SIZE = 500;

export class Indexer {
  private readonly db: Database.Database;
  private readonly opts: IndexerOptions;

  private readonly selByPath: Database.Statement;
  private readonly insMessage: Database.Statement;
  private readonly insFts: Database.Statement;
  private readonly insFileTouched: Database.Statement;
  private readonly upsertSession: Database.Statement;
  private readonly updateAggregates: Database.Statement;
  private readonly selRowsForSession: Database.Statement;
  private readonly ftsDelete: Database.Statement;
  private readonly insertBatchTx: Database.Transaction<
    (sessionId: string, entries: Array<{ rec: NormalizedRecord; idx: number }>) => void
  >;

  constructor(db: Database.Database, opts: IndexerOptions) {
    this.db = db;
    this.opts = opts;

    this.selByPath = db.prepare(
      `SELECT id, file_byte_offset, file_mtime_ms, file_size, line_count, adapter_version
       FROM sessions WHERE file_path = ?`,
    );
    this.insMessage = db.prepare(
      `INSERT OR IGNORE INTO messages
         (uuid, session_id, parent_uuid, idx, role, kind, tool_name, tool_use_id, ts,
          is_sidechain, is_error, tokens_in, tokens_out, cache_read_tokens, cache_write_tokens,
          cost_usd, model, text, raw_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.insFts = db.prepare(`INSERT INTO messages_fts (rowid, text) VALUES (?, ?)`);
    this.insFileTouched = db.prepare(
      `INSERT OR IGNORE INTO files_touched (session_id, path, change_kind) VALUES (?, ?, ?)`,
    );
    this.upsertSession = db.prepare(
      `INSERT INTO sessions
         (id, project_key, project_path, file_path, adapter_version,
          file_byte_offset, file_mtime_ms, file_size, line_count)
       VALUES (@id, @projectKey, @projectPath, @filePath, @adapterVersion,
               @offset, @mtimeMs, @size, @lineCount)
       ON CONFLICT (id) DO UPDATE SET
         adapter_version  = excluded.adapter_version,
         file_byte_offset = excluded.file_byte_offset,
         file_mtime_ms    = excluded.file_mtime_ms,
         file_size        = excluded.file_size,
         line_count       = excluded.line_count,
         project_path     = COALESCE(sessions.project_path, excluded.project_path)`,
    );
    this.updateAggregates = db.prepare(
      `UPDATE sessions SET
         started_at = (SELECT MIN(ts) FROM messages WHERE session_id = @id AND ts IS NOT NULL),
         ended_at   = (SELECT MAX(ts) FROM messages WHERE session_id = @id AND ts IS NOT NULL),
         turn_count = (SELECT COUNT(*) FROM messages WHERE session_id = @id),
         input_tokens       = (SELECT COALESCE(SUM(tokens_in), 0) FROM messages WHERE session_id = @id),
         output_tokens      = (SELECT COALESCE(SUM(tokens_out), 0) FROM messages WHERE session_id = @id),
         cache_read_tokens  = (SELECT COALESCE(SUM(cache_read_tokens), 0) FROM messages WHERE session_id = @id),
         cache_write_tokens = (SELECT COALESCE(SUM(cache_write_tokens), 0) FROM messages WHERE session_id = @id),
         cost_usd = (SELECT SUM(cost_usd) FROM messages WHERE session_id = @id),
         model = (SELECT model FROM messages
                  WHERE session_id = @id AND model IS NOT NULL ORDER BY idx DESC LIMIT 1),
         files_touched_count = (SELECT COUNT(DISTINCT path) FROM files_touched WHERE session_id = @id)
       WHERE id = @id`,
    );
    this.selRowsForSession = db.prepare(
      `SELECT rowid, text FROM messages WHERE session_id = ?`,
    );
    this.ftsDelete = db.prepare(
      `INSERT INTO messages_fts (messages_fts, rowid, text) VALUES ('delete', ?, ?)`,
    );

    this.insertBatchTx = db.transaction(
      (sessionId: string, entries: Array<{ rec: NormalizedRecord; idx: number }>) => {
        for (const { rec, idx } of entries) {
          const cost = computeCost(rec, this.opts.pricingOverrides);
          const info = this.insMessage.run(
            rec.uuid,
            sessionId,
            rec.parentUuid,
            idx,
            rec.role,
            rec.kind,
            rec.toolName,
            rec.toolUseId,
            rec.ts,
            rec.isSidechain ? 1 : 0,
            rec.isError ? 1 : 0,
            rec.tokensIn,
            rec.tokensOut,
            rec.cacheReadTokens,
            rec.cacheWriteTokens,
            cost,
            rec.model,
            rec.text,
            rec.raw,
          );
          if (info.changes === 1) {
            this.insFts.run(info.lastInsertRowid, rec.text);
          }
          for (const touch of rec.filesTouched) {
            this.insFileTouched.run(sessionId, touch.path, touch.changeKind);
          }
        }
      },
    );
  }

  /** Discover all session files under the projects dir. */
  async listFiles(): Promise<string[]> {
    const out: string[] = [];
    let projectDirs: fs.Dirent[];
    try {
      projectDirs = await fs.promises.readdir(this.opts.projectsDir, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const dirent of projectDirs) {
      if (!dirent.isDirectory() || dirent.name.startsWith('.')) continue;
      const dir = path.join(this.opts.projectsDir, dirent.name);
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch {
        continue; // permissions, races — crash-free
      }
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          out.push(path.join(dir, entry.name));
        }
      }
    }
    return out.sort();
  }

  async scanAll(onProgress?: (p: IndexProgress) => void): Promise<ScanSummary> {
    const files = await this.listFiles();
    const summary: ScanSummary = {
      filesSeen: files.length,
      filesIndexed: 0,
      linesParsed: 0,
      errors: [],
    };
    let done = 0;
    for (const file of files) {
      onProgress?.({ filesTotal: files.length, filesDone: done, currentFile: file });
      try {
        const lines = await this.indexFile(file);
        if (lines >= 0) {
          summary.filesIndexed += 1;
          summary.linesParsed += lines;
        }
      } catch (err) {
        summary.errors.push({ file, message: err instanceof Error ? err.message : String(err) });
      }
      done += 1;
    }
    onProgress?.({ filesTotal: files.length, filesDone: done, currentFile: '' });
    return summary;
  }

  /**
   * Index one session file incrementally. Returns the number of lines parsed
   * in this pass, or -1 if the file was already up to date.
   */
  async indexFile(filePath: string): Promise<number> {
    let st: fs.Stats;
    try {
      st = await fs.promises.stat(filePath);
    } catch {
      return -1; // deleted or unreadable; keep whatever we already indexed
    }

    const sessionId = path.basename(filePath, '.jsonl');
    const projectKey = path.basename(path.dirname(filePath));
    const row = this.selByPath.get(filePath) as SessionFileRow | undefined;

    let startOffset = 0;
    let startLine = 0;
    if (row) {
      const upToDate =
        row.adapter_version === ADAPTER_VERSION &&
        row.file_size === st.size &&
        row.file_mtime_ms === st.mtimeMs &&
        row.file_byte_offset === st.size;
      if (upToDate) return -1;

      if (st.size < row.file_byte_offset || row.adapter_version !== ADAPTER_VERSION) {
        this.deleteSessionData(row.id);
      } else {
        startOffset = row.file_byte_offset;
        startLine = row.line_count;
      }
    }

    let batch: Array<{ rec: NormalizedRecord; idx: number }> = [];
    let lineNo = startLine;
    let newOffset = startOffset;
    let linesParsed = 0;
    let firstCwd: string | null = null;

    const flush = () => {
      if (batch.length === 0) return;
      this.insertBatchTx(sessionId, batch);
      batch = [];
    };

    for await (const chunk of readLines(filePath, startOffset)) {
      if (!chunk.complete) {
        // Trailing line without a newline. JSON objects are self-delimiting,
        // so if it parses it's a whole record; otherwise it's mid-write —
        // leave it for the next pass by not advancing the offset.
        try {
          JSON.parse(chunk.text);
        } catch {
          break;
        }
      }
      const rec = normalizeLine(chunk.text, `${sessionId}:${lineNo}`);
      lineNo += 1;
      newOffset = chunk.end;
      if (rec) {
        if (firstCwd === null && rec.cwd) firstCwd = rec.cwd;
        batch.push({ rec, idx: lineNo - 1 });
        linesParsed += 1;
        if (batch.length >= BATCH_SIZE) flush();
      }
    }
    flush();

    this.upsertSession.run({
      id: sessionId,
      projectKey,
      projectPath: firstCwd,
      filePath,
      adapterVersion: ADAPTER_VERSION,
      offset: newOffset,
      mtimeMs: st.mtimeMs,
      size: st.size,
      lineCount: lineNo,
    });
    this.updateAggregates.run({ id: sessionId });
    return linesParsed;
  }

  /** Full-reindex helper: drop everything derived from one session file. */
  private deleteSessionData(sessionId: string): void {
    const tx = this.db.transaction(() => {
      const rows = this.selRowsForSession.all(sessionId) as Array<{ rowid: number; text: string }>;
      for (const r of rows) this.ftsDelete.run(r.rowid, r.text);
      this.db.prepare(`DELETE FROM messages WHERE session_id = ?`).run(sessionId);
      this.db.prepare(`DELETE FROM files_touched WHERE session_id = ?`).run(sessionId);
      this.db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId);
    });
    tx();
  }

  /** Wipe the index and re-scan everything from byte zero. */
  async rebuild(onProgress?: (p: IndexProgress) => void): Promise<ScanSummary> {
    this.db.exec(`
      INSERT INTO messages_fts (messages_fts) VALUES ('delete-all');
      DELETE FROM messages;
      DELETE FROM files_touched;
      DELETE FROM sessions;
    `);
    return this.scanAll(onProgress);
  }
}
