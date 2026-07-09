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
  private readonly selById: Database.Statement;
  private readonly selMessageIds: Database.Statement;
  private readonly insMessage: Database.Statement;
  private readonly insFts: Database.Statement;
  private readonly insFileTouched: Database.Statement;
  private readonly upsertSession: Database.Statement;
  private readonly updateAggregates: Database.Statement;
  private readonly selRowsForSession: Database.Statement;
  private readonly ftsDelete: Database.Statement;
  private readonly insertBatchTx: Database.Transaction<
    (sessionId: string, entries: Array<{ rec: NormalizedRecord; idx: number; dupUsage: boolean }>) => void
  >;

  constructor(db: Database.Database, opts: IndexerOptions) {
    this.db = db;
    this.opts = opts;

    this.selByPath = db.prepare(
      `SELECT id, file_byte_offset, file_mtime_ms, file_size, line_count, adapter_version
       FROM sessions WHERE file_path = ?`,
    );
    this.selById = db.prepare(`SELECT file_path, file_mtime_ms FROM sessions WHERE id = ?`);
    this.selMessageIds = db.prepare(
      `SELECT DISTINCT message_id FROM messages WHERE session_id = ? AND message_id IS NOT NULL`,
    );
    this.insMessage = db.prepare(
      `INSERT OR IGNORE INTO messages
         (uuid, session_id, parent_uuid, idx, role, kind, tool_name, tool_use_id, ts,
          is_sidechain, is_error, tokens_in, tokens_out, cache_read_tokens, cache_write_tokens,
          cost_usd, model, message_id, text, raw_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.insFts = db.prepare(`INSERT INTO messages_fts (rowid, text) VALUES (?, ?)`);
    this.insFileTouched = db.prepare(
      `INSERT OR IGNORE INTO files_touched (session_id, path, change_kind) VALUES (?, ?, ?)`,
    );
    this.upsertSession = db.prepare(
      `INSERT INTO sessions
         (id, project_key, project_path, file_path, parent_session_id, adapter_version,
          file_byte_offset, file_mtime_ms, file_size, line_count)
       VALUES (@id, @projectKey, @projectPath, @filePath, @parentSessionId, @adapterVersion,
               @offset, @mtimeMs, @size, @lineCount)
       ON CONFLICT (id) DO UPDATE SET
         file_path         = excluded.file_path,
         parent_session_id = excluded.parent_session_id,
         adapter_version   = excluded.adapter_version,
         file_byte_offset  = excluded.file_byte_offset,
         file_mtime_ms     = excluded.file_mtime_ms,
         file_size         = excluded.file_size,
         line_count        = excluded.line_count,
         project_path      = COALESCE(sessions.project_path, excluded.project_path)`,
    );
    // Aggregates roll up the whole family: the session's own messages plus
    // its subagent transcripts (parent_session_id children) — the same totals
    // older CC versions produced when sidechains were inline records.
    // `model` stays main-file-only, and skips '<synthetic>'-style placeholders.
    this.updateAggregates = db.prepare(
      `WITH family(id) AS (SELECT id FROM sessions WHERE id = @id OR parent_session_id = @id)
       UPDATE sessions SET
         started_at = (SELECT MIN(ts) FROM messages WHERE session_id IN (SELECT id FROM family) AND ts IS NOT NULL),
         ended_at   = (SELECT MAX(ts) FROM messages WHERE session_id IN (SELECT id FROM family) AND ts IS NOT NULL),
         turn_count = (SELECT COUNT(*) FROM messages WHERE session_id IN (SELECT id FROM family)),
         input_tokens       = (SELECT COALESCE(SUM(tokens_in), 0) FROM messages WHERE session_id IN (SELECT id FROM family)),
         output_tokens      = (SELECT COALESCE(SUM(tokens_out), 0) FROM messages WHERE session_id IN (SELECT id FROM family)),
         cache_read_tokens  = (SELECT COALESCE(SUM(cache_read_tokens), 0) FROM messages WHERE session_id IN (SELECT id FROM family)),
         cache_write_tokens = (SELECT COALESCE(SUM(cache_write_tokens), 0) FROM messages WHERE session_id IN (SELECT id FROM family)),
         cost_usd = (SELECT SUM(cost_usd) FROM messages WHERE session_id IN (SELECT id FROM family)),
         model = (SELECT model FROM messages
                  WHERE session_id = @id AND model IS NOT NULL AND model NOT LIKE '<%'
                  ORDER BY idx DESC LIMIT 1),
         files_touched_count = (SELECT COUNT(DISTINCT path) FROM files_touched WHERE session_id IN (SELECT id FROM family))
       WHERE id = @id`,
    );
    this.selRowsForSession = db.prepare(
      `SELECT rowid, text FROM messages WHERE session_id = ?`,
    );
    this.ftsDelete = db.prepare(
      `INSERT INTO messages_fts (messages_fts, rowid, text) VALUES ('delete', ?, ?)`,
    );

    this.insertBatchTx = db.transaction(
      (sessionId: string, entries: Array<{ rec: NormalizedRecord; idx: number; dupUsage: boolean }>) => {
        for (const { rec, idx, dupUsage } of entries) {
          // Usage repeats verbatim on every line of a multi-block response;
          // only the first line of a messageId carries it into the index.
          const cost = dupUsage ? null : computeCost(rec, this.opts.pricingOverrides);
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
            dupUsage ? 0 : rec.tokensIn,
            dupUsage ? 0 : rec.tokensOut,
            dupUsage ? 0 : rec.cacheReadTokens,
            dupUsage ? 0 : rec.cacheWriteTokens,
            cost,
            rec.model,
            rec.messageId,
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

  /**
   * Discover all session files under the projects dir: the flat
   * `<project>/<session>.jsonl` files plus subagent transcripts newer CC
   * versions write to `<project>/<session>/subagents/<agent>.jsonl`.
   */
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
        } else if (entry.isDirectory()) {
          const subagentsDir = path.join(dir, entry.name, 'subagents');
          let subEntries: fs.Dirent[];
          try {
            subEntries = await fs.promises.readdir(subagentsDir, { withFileTypes: true });
          } catch {
            continue; // most session dirs have no subagents/
          }
          for (const sub of subEntries) {
            if (sub.isFile() && sub.name.endsWith('.jsonl')) {
              out.push(path.join(subagentsDir, sub.name));
            }
          }
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
    const dir = path.dirname(filePath);
    let projectKey = path.basename(dir);
    let parentSessionId: string | null = null;
    if (projectKey === 'subagents') {
      // <projects>/<project>/<parent-session>/subagents/<agent>.jsonl
      const sessionDir = path.dirname(dir);
      parentSessionId = path.basename(sessionDir);
      projectKey = path.basename(path.dirname(sessionDir));
    }
    const row = this.selByPath.get(filePath) as SessionFileRow | undefined;
    if (!row) {
      // Same session id under a different path — a project dir was moved or
      // its logs copied. Resumed sessions carry their history forward, so the
      // newest file supersedes older copies; stale copies are skipped instead
      // of corrupting the byte-offset bookkeeping of the tracked file.
      const other = this.selById.get(sessionId) as
        | { file_path: string; file_mtime_ms: number | null }
        | undefined;
      if (other && other.file_path !== filePath) {
        if ((other.file_mtime_ms ?? 0) >= st.mtimeMs) return -1;
        this.deleteSessionData(sessionId);
      }
    }

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

    let batch: Array<{ rec: NormalizedRecord; idx: number; dupUsage: boolean }> = [];
    let lineNo = startLine;
    let newOffset = startOffset;
    let linesParsed = 0;
    let firstCwd: string | null = null;

    // Usage dedupe: CC writes one line per content block of a response, each
    // repeating the same message.id and usage. Seed with ids already indexed
    // (incremental resume), then count usage only on a messageId's first line.
    const seenMessageIds = new Set<string>(
      startOffset > 0
        ? (this.selMessageIds.all(sessionId) as Array<{ message_id: string }>).map(
            (r) => r.message_id,
          )
        : [],
    );

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
        let dupUsage = false;
        if (rec.messageId !== null) {
          if (seenMessageIds.has(rec.messageId)) dupUsage = true;
          else seenMessageIds.add(rec.messageId);
        }
        batch.push({ rec, idx: lineNo - 1, dupUsage });
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
      parentSessionId,
      adapterVersion: ADAPTER_VERSION,
      offset: newOffset,
      mtimeMs: st.mtimeMs,
      size: st.size,
      lineCount: lineNo,
    });
    this.updateAggregates.run({ id: sessionId });
    // A subagent transcript changes its parent's rolled-up totals too. The
    // parent row may not exist yet (child indexed first) — then this is a
    // no-op and the parent's own pass picks the child messages up.
    if (parentSessionId !== null) this.updateAggregates.run({ id: parentSessionId });
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
