import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { readLines } from '../parser/lineReader.js';
import {
  normalizeCodexLine,
  normalizeCursorCliLine,
  normalizeCursorIdeEnvelope,
  normalizeLine,
} from '../parser/normalize.js';
import { newCodexState } from '../parser/adapters/codex.js';
import type { NormalizedRecord } from '../parser/types.js';
import { computeCost, type ModelPricing } from '../cost/pricing.js';
import {
  ADAPTER_VERSION,
  CODEX_ADAPTER_VERSION,
  CURSOR_ADAPTER_VERSION,
  CURSOR_IDE_ADAPTER_VERSION,
} from '../version.js';
import { extractCursorIdeComposers } from './cursorIde.js';
import { resumeDeepIndex, suspendDeepIndex } from './deepSearch.js';

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
  /**
   * Codex rollout root (`~/.codex/sessions`), date-nested
   * `YYYY/MM/DD/rollout-*.jsonl`. Absent or missing dir = Codex indexing
   * simply off. Read-only, exactly like `~/.claude/projects`.
   */
  codexDir?: string;
  /**
   * Cursor CLI transcript root (`~/.cursor/projects`), holding
   * `<dir-id>/agent-transcripts/<uuid>/<uuid>.jsonl` (+ subagents/).
   * Same posture: absent = off, read-only always.
   */
  cursorCliDir?: string;
  /**
   * Cursor IDE user dir (state.vscdb trees). Composers are extracted via
   * copy-then-read — the originals are never opened — and indexed as virtual
   * sessions whose file_path is `<vscdb path>#<composerId>`.
   */
  cursorIdeUserDir?: string;
  pricingOverrides?: Record<string, Partial<ModelPricing>>;
}

/** 'cursor' covers both Cursor sources — the CLI transcripts and the IDE's
 *  composers. One agent to the user; the file_path tells them apart. */
export type SessionTool = 'claude-code' | 'codex' | 'cursor';

/** `/Users/dev/projects/webapp` → `-Users-dev-projects-webapp` — the same
 *  munging CC uses for its project dir names, so a Codex session in the same
 *  cwd lands in the SAME Turnlog project as the CC sessions. */
export function mungeCwd(cwd: string): string {
  return '-' + cwd.replace(/^[/\\]+/, '').replace(/[/\\.:]/g, '-');
}

const ROLLOUT_ID_RE = /rollout-.*-([0-9a-fA-F]{8}-[0-9a-fA-F-]{27,})\.jsonl$/;

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
  private readonly selCodexSeed: Database.Statement;
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
    this.selCodexSeed = db.prepare(`SELECT model, project_path FROM sessions WHERE id = ?`);
    this.selMessageIds = db.prepare(
      `SELECT DISTINCT message_id FROM messages WHERE session_id = ? AND message_id IS NOT NULL`,
    );
    this.insMessage = db.prepare(
      `INSERT OR IGNORE INTO messages
         (uuid, session_id, parent_uuid, idx, role, kind, tool_name, tool_use_id, ts,
          is_sidechain, is_error, tokens_in, tokens_out, cache_read_tokens, cache_write_tokens,
          cost_usd, model, message_id, git_branch, command, text, raw_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.insFts = db.prepare(`INSERT INTO messages_fts (rowid, text) VALUES (?, ?)`);
    this.insFileTouched = db.prepare(
      `INSERT OR IGNORE INTO files_touched (session_id, path, change_kind) VALUES (?, ?, ?)`,
    );
    // root_uuid identifies the logical conversation: resuming into a new
    // session id copies history forward with the original message uuids, so
    // files sharing a first-message uuid are parts of one resume chain. Only
    // a from-byte-zero pass sees the first message — incremental passes hand
    // in null and COALESCE keeps the stored value.
    this.upsertSession = db.prepare(
      `INSERT INTO sessions
         (id, project_key, project_path, file_path, parent_session_id, root_uuid,
          ai_title, cc_title, tool,
          adapter_version, file_byte_offset, file_mtime_ms, file_size, line_count)
       VALUES (@id, @projectKey, @projectPath, @filePath, @parentSessionId, @rootUuid,
               @aiTitle, @ccTitle, @tool,
               @adapterVersion, @offset, @mtimeMs, @size, @lineCount)
       ON CONFLICT (id) DO UPDATE SET
         file_path         = excluded.file_path,
         parent_session_id = excluded.parent_session_id,
         root_uuid         = COALESCE(excluded.root_uuid, sessions.root_uuid),
         ai_title          = COALESCE(excluded.ai_title, sessions.ai_title),
         cc_title          = COALESCE(excluded.cc_title, sessions.cc_title),
         tool              = excluded.tool,
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
    // started/ended fall back to file mtime when messages exist but none
    // carries a timestamp — Cursor CLI transcripts have no ts at all, and a
    // NULL started_at would drop the session from every date-ordered view.
    // A session with no messages keeps NULL: nothing happened at no time.
    this.updateAggregates = db.prepare(
      `WITH family(id) AS (SELECT id FROM sessions WHERE id = @id OR parent_session_id = @id)
       UPDATE sessions SET
         started_at = COALESCE(
           (SELECT MIN(ts) FROM messages WHERE session_id IN (SELECT id FROM family) AND ts IS NOT NULL),
           (SELECT strftime('%Y-%m-%dT%H:%M:%fZ', file_mtime_ms / 1000.0, 'unixepoch')
              WHERE EXISTS (SELECT 1 FROM messages WHERE session_id IN (SELECT id FROM family)))),
         ended_at   = COALESCE(
           (SELECT MAX(ts) FROM messages WHERE session_id IN (SELECT id FROM family) AND ts IS NOT NULL),
           (SELECT strftime('%Y-%m-%dT%H:%M:%fZ', file_mtime_ms / 1000.0, 'unixepoch')
              WHERE EXISTS (SELECT 1 FROM messages WHERE session_id IN (SELECT id FROM family)))),
         event_count = (SELECT COUNT(*) FROM messages WHERE session_id IN (SELECT id FROM family)),
         input_tokens       = (SELECT COALESCE(SUM(tokens_in), 0) FROM messages WHERE session_id IN (SELECT id FROM family)),
         output_tokens      = (SELECT COALESCE(SUM(tokens_out), 0) FROM messages WHERE session_id IN (SELECT id FROM family)),
         cache_read_tokens  = (SELECT COALESCE(SUM(cache_read_tokens), 0) FROM messages WHERE session_id IN (SELECT id FROM family)),
         cache_write_tokens = (SELECT COALESCE(SUM(cache_write_tokens), 0) FROM messages WHERE session_id IN (SELECT id FROM family)),
         cost_usd = (SELECT SUM(cost_usd) FROM messages WHERE session_id IN (SELECT id FROM family)),
         model = (SELECT model FROM messages
                  WHERE session_id = @id AND model IS NOT NULL AND model NOT LIKE '<%'
                  ORDER BY idx DESC LIMIT 1),
         branch = (SELECT git_branch FROM messages
                   WHERE session_id = @id AND git_branch IS NOT NULL
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
            rec.gitBranch,
            rec.command,
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
    out.push(...(await this.listCodexFiles()));
    out.push(...(await this.listCursorCliFiles()));
    return out.sort();
  }

  /**
   * Cursor CLI transcripts: `<root>/<dir-id>/agent-transcripts/<uuid>/
   * <uuid>.jsonl` plus `subagents/*.jsonl` beside them. Structured walk, not
   * a recursive glob — `~/.cursor` also holds extensions and caches that a
   * blind walk would pointlessly stat.
   */
  private async listCursorCliFiles(): Promise<string[]> {
    const root = this.opts.cursorCliDir;
    if (!root) return [];
    const out: string[] = [];
    let projectDirs: fs.Dirent[];
    try {
      projectDirs = await fs.promises.readdir(root, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const project of projectDirs) {
      if (!project.isDirectory() || project.name.startsWith('.')) continue;
      const transcripts = path.join(root, project.name, 'agent-transcripts');
      let sessionDirs: fs.Dirent[];
      try {
        sessionDirs = await fs.promises.readdir(transcripts, { withFileTypes: true });
      } catch {
        continue; // project dir without transcripts
      }
      for (const session of sessionDirs) {
        if (!session.isDirectory()) continue;
        const sessionDir = path.join(transcripts, session.name);
        let entries: fs.Dirent[];
        try {
          entries = await fs.promises.readdir(sessionDir, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const entry of entries) {
          if (entry.isFile() && entry.name.endsWith('.jsonl')) {
            out.push(path.join(sessionDir, entry.name));
          } else if (entry.isDirectory() && entry.name === 'subagents') {
            let subs: fs.Dirent[];
            try {
              subs = await fs.promises.readdir(path.join(sessionDir, 'subagents'), {
                withFileTypes: true,
              });
            } catch {
              continue;
            }
            for (const sub of subs) {
              if (sub.isFile() && sub.name.endsWith('.jsonl')) {
                out.push(path.join(sessionDir, 'subagents', sub.name));
              }
            }
          }
        }
      }
    }
    return out;
  }

  /**
   * Codex rollouts under `codexDir`, date-nested `YYYY/MM/DD/rollout-*.jsonl`.
   * A bounded recursive walk (the nesting is fixed at three levels, but a
   * tolerant walk survives layout drift); absent dir = no Codex.
   */
  private async listCodexFiles(): Promise<string[]> {
    const root = this.opts.codexDir;
    if (!root) return [];
    const out: string[] = [];
    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > 4) return;
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch {
        return; // missing root, permissions — Codex indexing simply off
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          await walk(full, depth + 1);
        } else if (entry.isFile() && /^rollout-.*\.jsonl$/.test(entry.name)) {
          out.push(full);
        }
      }
    };
    await walk(root, 0);
    return out;
  }

  /** Which tool wrote a session file — by which discovery root it lives under. */
  private toolFor(filePath: string): SessionTool {
    const codex = this.opts.codexDir;
    if (codex && (filePath === codex || filePath.startsWith(codex + path.sep))) return 'codex';
    const cursor = this.opts.cursorCliDir;
    if (cursor && (filePath === cursor || filePath.startsWith(cursor + path.sep)))
      return 'cursor';
    return 'claude-code';
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
    this.indexCursorIde(summary);
    onProgress?.({ filesTotal: files.length, filesDone: done, currentFile: '' });
    return summary;
  }

  /**
   * Index Cursor IDE composers as virtual sessions. The incremental unit is
   * the composer: its stored file_mtime_ms is the composer's lastUpdatedAt,
   * so an unchanged composer is one row lookup, and a changed one is a full
   * cheap re-extract (composers are small). file_path is
   * `<vscdb path>#<composerId>` — real enough for reveal, unique per session.
   */
  private indexCursorIde(summary: ScanSummary): void {
    const userDir = this.opts.cursorIdeUserDir;
    if (!userDir) return;
    let composers;
    try {
      composers = extractCursorIdeComposers(userDir);
    } catch (err) {
      summary.errors.push({
        file: userDir,
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    for (const composer of composers) {
      summary.filesSeen += 1;
      // Composers with no conversation at all (draft panes) would index as
      // permanently-empty sessions; skip them the way empty files are skipped.
      if (composer.envelopes.length <= 1) continue;
      const mtime = composer.lastUpdatedAt ?? composer.createdAt ?? 0;
      const filePath = `${composer.dbPath}#${composer.composerId}`;
      const row = this.selByPath.get(filePath) as SessionFileRow | undefined;
      if (
        row &&
        row.adapter_version === CURSOR_IDE_ADAPTER_VERSION &&
        row.file_mtime_ms === mtime
      ) {
        continue;
      }
      if (row) this.deleteSessionData(row.id);

      let batch: Array<{ rec: NormalizedRecord; idx: number; dupUsage: boolean }> = [];
      let firstCwd: string | null = null;
      let rootUuid: string | null = null;
      let idx = 0;
      for (const env of composer.envelopes) {
        const rec = normalizeCursorIdeEnvelope(env, `${composer.composerId}:${idx}`);
        if (firstCwd === null && rec.cwd) firstCwd = rec.cwd;
        if (rootUuid === null && (rec.role === 'user' || rec.role === 'assistant')) {
          rootUuid = rec.uuid;
        }
        batch.push({ rec, idx, dupUsage: false });
        idx += 1;
        if (batch.length >= BATCH_SIZE) {
          this.insertBatchTx(composer.composerId, batch);
          batch = [];
        }
      }
      if (batch.length > 0) this.insertBatchTx(composer.composerId, batch);

      this.upsertSession.run({
        id: composer.composerId,
        projectKey: composer.cwd ? mungeCwd(composer.cwd) : 'cursor-ide',
        projectPath: composer.cwd,
        filePath,
        parentSessionId: null,
        rootUuid,
        aiTitle: composer.name,
        ccTitle: null,
        tool: 'cursor' satisfies SessionTool,
        adapterVersion: CURSOR_IDE_ADAPTER_VERSION,
        offset: 0,
        mtimeMs: mtime,
        size: idx,
        lineCount: idx,
      });
      this.updateAggregates.run({ id: composer.composerId });
      summary.filesIndexed += 1;
      summary.linesParsed += idx;
    }
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

    const tool = this.toolFor(filePath);
    const toolAdapterVersion =
      tool === 'codex'
        ? CODEX_ADAPTER_VERSION
        : tool === 'cursor'
          ? CURSOR_ADAPTER_VERSION
          : ADAPTER_VERSION;
    let sessionId = path.basename(filePath, '.jsonl');
    const dir = path.dirname(filePath);
    let projectKey = path.basename(dir);
    let parentSessionId: string | null = null;
    if (tool === 'codex') {
      // The filename carries the session uuid — stable across passes, unlike
      // the session_meta record an incremental pass never re-reads. The
      // project key is derived from the session's cwd after parsing (below),
      // munged CC-style so both tools' work on one repo is one project.
      sessionId = ROLLOUT_ID_RE.exec(path.basename(filePath))?.[1] ?? sessionId;
      projectKey = 'codex';
    } else if (tool === 'cursor') {
      // <root>/<dir-id>/agent-transcripts/<session>/<session>.jsonl, with
      // subagents/ one level deeper. <dir-id> is the cwd dash-munged the same
      // way CC munges its project dirs (minus the leading dash) — normalize
      // to CC's form so all agents' work on one repo is one project.
      let sessionDir = dir;
      if (projectKey === 'subagents') {
        sessionDir = path.dirname(dir);
        parentSessionId = path.basename(sessionDir);
      }
      const dirId = path.basename(path.dirname(path.dirname(sessionDir)));
      projectKey = dirId.startsWith('-') ? dirId : `-${dirId}`;
    } else if (projectKey === 'subagents') {
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
        row.adapter_version === toolAdapterVersion &&
        row.file_size === st.size &&
        row.file_mtime_ms === st.mtimeMs &&
        row.file_byte_offset === st.size;
      if (upToDate) return -1;

      if (st.size < row.file_byte_offset || row.adapter_version !== toolAdapterVersion) {
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
    let rootUuid: string | null = null;
    // CC rewrites its titles as the session evolves — last one wins per
    // stream. Null when this pass saw none; the upsert then keeps the stored
    // value (incremental passes start mid-file).
    let aiTitle: string | null = null;
    let ccTitle: string | null = null;

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

    // Codex cross-line context (cwd, current model). Incremental passes start
    // mid-file and would otherwise lose the model in force — reseed it from
    // the stored session row.
    const codexState = tool === 'codex' ? newCodexState() : null;
    if (codexState && startOffset > 0) {
      const seed = this.selCodexSeed.get(sessionId) as
        | { model: string | null; project_path: string | null }
        | undefined;
      codexState.model = seed?.model ?? null;
      codexState.cwd = seed?.project_path ?? null;
    }

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
      const fallbackId = `${sessionId}:${lineNo}`;
      const rec = codexState
        ? normalizeCodexLine(chunk.text, fallbackId, codexState)
        : tool === 'cursor'
          ? normalizeCursorCliLine(chunk.text, fallbackId)
          : normalizeLine(chunk.text, fallbackId);
      lineNo += 1;
      newOffset = chunk.end;
      if (rec) {
        if (firstCwd === null && rec.cwd) firstCwd = rec.cwd;
        // First real message of the file (matches the schema-v7 backfill:
        // user/assistant role with an actual uuid, not the line fallback).
        if (
          rootUuid === null &&
          startOffset === 0 &&
          (rec.role === 'user' || rec.role === 'assistant') &&
          rec.uuid !== fallbackId
        ) {
          rootUuid = rec.uuid;
        }
        if (rec.kind === 'title' && rec.text !== '') {
          if (rec.subtype === 'custom') ccTitle = rec.text;
          else aiTitle = rec.text;
        }
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

    // Codex files carry no project in their path — the cwd is the project.
    // Incremental passes may not see it again; the upsert's ON CONFLICT does
    // not touch project_key, so the from-zero pass's value survives.
    if (tool === 'codex' && firstCwd) projectKey = mungeCwd(firstCwd);

    this.upsertSession.run({
      id: sessionId,
      projectKey,
      projectPath: firstCwd,
      filePath,
      parentSessionId,
      rootUuid,
      aiTitle,
      ccTitle,
      tool,
      adapterVersion: toolAdapterVersion,
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
    // The trigram twin's triggers come down for the wipe — left live, the
    // bulk DELETE would issue one FTS 'delete' per row against an index that
    // no longer holds them, which corrupts rather than errors.
    const deep = suspendDeepIndex(this.db);
    this.db.exec(`
      INSERT INTO messages_fts (messages_fts) VALUES ('delete-all');
      DELETE FROM messages;
      DELETE FROM files_touched;
      DELETE FROM sessions;
    `);
    resumeDeepIndex(this.db, deep);
    return this.scanAll(onProgress);
  }
}
