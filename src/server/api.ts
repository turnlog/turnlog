import fs from 'node:fs';
import type Database from 'better-sqlite3';
import { pricingForModel, type ModelPricing } from '../cost/pricing.js';
import { sessionToHtml } from '../export/html.js';
import { sessionToMarkdown, type ExportOptions } from '../export/markdown.js';
import type {
  ChildSessionSummary,
  DiskUsageResponse,
  FileHistoryResponse,
  FileSummary,
  MessageListResponse,
  MessageRow,
  ProjectInfo,
  SavedSearch,
  SearchAggregates,
  SearchResponse,
  SearchTimelineResponse,
  SessionContextResponse,
  SessionListResponse,
  SessionMeta,
  SessionMetaPatch,
  SpendResponse,
  StatsResponse,
  TurnsResponse,
  TurnSummary,
} from './apiTypes.js';
import { LENSES, SNIPPET_CLOSE, SNIPPET_OPEN, type Lens } from './apiTypes.js';

const SESSION_COLUMNS = `
  id, project_path, project_key, parent_session_id, started_at, ended_at, model, turn_count,
  input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
  cost_usd, files_touched_count, ai_title, cc_title,
  COALESCE(session_meta.pinned, 0) AS pinned, custom_name, note,
  (SELECT COUNT(*) FROM sessions c
   WHERE c.root_uuid = sessions.root_uuid AND c.project_key IS sessions.project_key
     AND c.parent_session_id IS NULL) AS chain_len
`;

/** Sessions with their user annotations (pin/name/note) joined in. */
const SESSIONS_JOINED = `sessions LEFT JOIN session_meta ON session_meta.session_id = sessions.id`;

function rowToSession(r: any): SessionMeta {
  return {
    id: r.id,
    projectPath: r.project_path,
    projectKey: r.project_key,
    parentSessionId: r.parent_session_id,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    model: r.model,
    turnCount: r.turn_count,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    cacheReadTokens: r.cache_read_tokens,
    cacheWriteTokens: r.cache_write_tokens,
    costUsd: r.cost_usd,
    filesTouchedCount: r.files_touched_count,
    pinned: !!r.pinned,
    customName: r.custom_name ?? null,
    note: r.note ?? null,
    // CC's user-set custom-title outranks its generated ai-title.
    aiTitle: r.cc_title ?? r.ai_title ?? null,
    // NULL root_uuid never matches the subquery — 0 reads as standalone.
    chainLen: r.chain_len > 0 ? r.chain_len : 1,
  };
}

const SORTABLE: Record<string, string> = {
  started_at: 'started_at',
  ended_at: 'ended_at',
  cost_usd: 'cost_usd',
  turn_count: 'turn_count',
  tokens: '(input_tokens + output_tokens)',
};

export interface ListSessionsQuery {
  sort?: string;
  dir?: string;
  project?: string;
  limit?: number;
  offset?: number;
  /** ISO bounds on started_at (calendar range queries). */
  since?: string;
  until?: string;
  /** Drop sessions with nothing in them (0 turns or 0 tokens, no cost). */
  hideEmpty?: boolean;
  /**
   * Collapse resume chains to their most recent part (the tip carries the
   * whole copied history anyway). The calendar wants every part at its real
   * time, so this is opt-in.
   */
  collapseChains?: boolean;
}

export function listSessions(db: Database.Database, q: ListSessionsQuery): SessionListResponse {
  const sort = SORTABLE[q.sort ?? ''] ?? 'started_at';
  const dir = q.dir === 'asc' ? 'ASC' : 'DESC';
  const limit = Math.min(Math.max(q.limit ?? 100, 1), 1000);
  const offset = Math.max(q.offset ?? 0, 0);
  // Subagent transcripts are rolled into their parent, never listed standalone.
  const clauses: string[] = ['parent_session_id IS NULL'];
  const params: unknown[] = [];
  if (q.project) {
    clauses.push('project_key = ?');
    params.push(q.project);
  }
  if (q.since) {
    clauses.push('started_at >= ?');
    params.push(q.since);
  }
  if (q.until) {
    clauses.push('started_at < ?');
    params.push(q.until);
  }
  if (q.hideEmpty) {
    // Empty = reads zero on either axis (no prompts, or no usage at all —
    // e.g. prompt-only files with no assistant response). Recorded cost keeps
    // a session visible: legacy CC logged per-message costUSD without tokens.
    // Pinning something is a statement that it matters — pins never hide.
    clauses.push(
      `NOT ((turn_count = 0 OR input_tokens + output_tokens = 0)
            AND COALESCE(cost_usd, 0) = 0 AND COALESCE(session_meta.pinned, 0) = 0)`,
    );
  }
  if (q.collapseChains) {
    // Keep only each chain's tip — the part with the latest activity (ties
    // break on id so the choice is stable). Pins never hide, here either.
    clauses.push(
      `(COALESCE(session_meta.pinned, 0) = 1 OR root_uuid IS NULL OR NOT EXISTS (
          SELECT 1 FROM sessions o
          WHERE o.root_uuid = sessions.root_uuid
            AND o.project_key IS sessions.project_key
            AND o.parent_session_id IS NULL
            AND o.id <> sessions.id
            AND (COALESCE(o.ended_at, o.started_at, '') > COALESCE(sessions.ended_at, sessions.started_at, '')
                 OR (COALESCE(o.ended_at, o.started_at, '') = COALESCE(sessions.ended_at, sessions.started_at, '')
                     AND o.id > sessions.id))))`,
    );
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  const rows = db
    .prepare(
      `SELECT ${SESSION_COLUMNS} FROM ${SESSIONS_JOINED} ${where}
       ORDER BY pinned DESC, ${sort} ${dir} LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset);
  const total = db
    .prepare(`SELECT COUNT(*) AS n FROM ${SESSIONS_JOINED} ${where}`)
    .get(...params) as { n: number };

  return { sessions: rows.map(rowToSession), total: total.n };
}

export function getSession(db: Database.Database, id: string): SessionMeta | null {
  const row = db
    .prepare(`SELECT ${SESSION_COLUMNS} FROM ${SESSIONS_JOINED} WHERE sessions.id = ?`)
    .get(id);
  return row ? rowToSession(row) : null;
}

/**
 * Every part of a session's resume chain, oldest first. Parts share their
 * first message's uuid (resume copies history forward), and ordering by last
 * activity puts the live continuation at the end. Null = unknown session; a
 * standalone session is a chain of one.
 */
export function getSessionChain(db: Database.Database, id: string): SessionMeta[] | null {
  const row = db.prepare(`SELECT root_uuid, project_key FROM sessions WHERE id = ?`).get(id) as
    | { root_uuid: string | null; project_key: string | null }
    | undefined;
  if (!row) return null;
  if (row.root_uuid !== null) {
    // Project-scoped: a shared root uuid only means "same conversation"
    // within one project dir (resume writes to the cwd's project).
    const rows = db
      .prepare(
        `SELECT ${SESSION_COLUMNS} FROM ${SESSIONS_JOINED}
         WHERE root_uuid = ? AND project_key IS ? AND parent_session_id IS NULL
         ORDER BY COALESCE(ended_at, started_at, ''), sessions.id`,
      )
      .all(row.root_uuid, row.project_key);
    if (rows.length > 0) return rows.map(rowToSession);
  }
  // No root uuid (empty file) or no root siblings (subagent transcript).
  const self = getSession(db, id);
  return self ? [self] : null;
}

const FIRST_PROMPT_MAX = 400;

/**
 * A session's file-based subagent transcripts, oldest first, each with its
 * opening prompt — the replay matches that against Task `input.prompt` to
 * nest the transcript under the call that spawned it. Null = unknown session.
 */
export function listSessionChildren(
  db: Database.Database,
  id: string,
): ChildSessionSummary[] | null {
  const exists = db.prepare(`SELECT id FROM sessions WHERE id = ?`).get(id);
  if (!exists) return null;
  const rows = db
    .prepare(
      `SELECT ${SESSION_COLUMNS},
              (SELECT text FROM messages m
               WHERE m.session_id = sessions.id AND m.kind = 'prompt'
               ORDER BY m.idx LIMIT 1) AS first_prompt
       FROM ${SESSIONS_JOINED}
       WHERE parent_session_id = ?
       ORDER BY started_at, sessions.id`,
    )
    .all(id);
  return rows.map((r: any) => ({
    ...rowToSession(r),
    firstPrompt: ((r.first_prompt as string | null) ?? '').slice(0, FIRST_PROMPT_MAX),
  }));
}

/** Length caps keep the annotations table honest — these are labels, not documents. */
const CUSTOM_NAME_MAX = 200;
const NOTE_MAX = 4000;

/**
 * Upsert a session's user annotations. Absent patch fields keep their current
 * value; empty strings clear to null. Returns the updated session, or null
 * for an unknown id. An all-default row is deleted rather than kept around.
 */
export function setSessionMeta(
  db: Database.Database,
  id: string,
  patch: SessionMetaPatch,
): SessionMeta | null {
  const exists = db.prepare(`SELECT id FROM sessions WHERE id = ?`).get(id);
  if (!exists) return null;
  const cur = db
    .prepare(`SELECT pinned, custom_name, note FROM session_meta WHERE session_id = ?`)
    .get(id) as { pinned: number; custom_name: string | null; note: string | null } | undefined;

  const text = (v: string | null | undefined, cap: number, current: string | null) =>
    v === undefined ? current : v === null ? null : v.trim().slice(0, cap) || null;
  const pinned = patch.pinned === undefined ? (cur?.pinned ?? 0) : patch.pinned ? 1 : 0;
  const customName = text(patch.customName, CUSTOM_NAME_MAX, cur?.custom_name ?? null);
  const note = text(patch.note, NOTE_MAX, cur?.note ?? null);

  if (pinned === 0 && customName === null && note === null) {
    db.prepare(`DELETE FROM session_meta WHERE session_id = ?`).run(id);
  } else {
    db.prepare(
      `INSERT OR REPLACE INTO session_meta (session_id, pinned, custom_name, note, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(id, pinned, customName, note, new Date().toISOString());
  }
  return getSession(db, id);
}

/* ── message bookmarks ("mark this moment") ─────────────────────────── */

/** Bookmarked message idxs for a session, ascending. Null = unknown session. */
export function listBookmarks(db: Database.Database, sessionId: string): number[] | null {
  const exists = db.prepare(`SELECT id FROM sessions WHERE id = ?`).get(sessionId);
  if (!exists) return null;
  return (
    db
      .prepare(`SELECT idx FROM message_bookmarks WHERE session_id = ? ORDER BY idx`)
      .all(sessionId) as { idx: number }[]
  ).map((r) => r.idx);
}

/**
 * Set or clear one bookmark; returns the session's bookmarks after the write.
 * Null = no message at that (session, idx) — never bookmark thin air.
 */
export function setBookmark(
  db: Database.Database,
  sessionId: string,
  idx: number,
  on: boolean,
): number[] | null {
  const target = db
    .prepare(`SELECT 1 FROM messages WHERE session_id = ? AND idx = ?`)
    .get(sessionId, idx);
  if (!target) return null;
  if (on) {
    db.prepare(
      `INSERT OR IGNORE INTO message_bookmarks (session_id, idx, created_at) VALUES (?, ?, ?)`,
    ).run(sessionId, idx, new Date().toISOString());
  } else {
    db.prepare(`DELETE FROM message_bookmarks WHERE session_id = ? AND idx = ?`).run(
      sessionId,
      idx,
    );
  }
  return listBookmarks(db, sessionId);
}

/* ── UI preferences (server-side; the random port resets localStorage) ── */

const PREF_KEY_MAX = 64;
const PREF_VALUE_MAX = 2048;
const PREF_PATCH_MAX = 32;
const PREF_COUNT_MAX = 200;

/** All stored UI prefs as one object; corrupt values are skipped, not fatal. */
export function getPrefs(db: Database.Database): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const rows = db.prepare(`SELECT key, value FROM ui_prefs`).all() as {
    key: string;
    value: string;
  }[];
  for (const r of rows) {
    try {
      out[r.key] = JSON.parse(r.value);
    } catch {
      /* unreadable value — drop it from the view, leave the row */
    }
  }
  return out;
}

/**
 * Merge a patch into the stored prefs: each key is set to its JSON value,
 * null deletes. Validates the whole patch before touching anything; returns
 * the full prefs after the write, or null if the patch is unacceptable.
 */
export function setPrefs(
  db: Database.Database,
  patch: Record<string, unknown>,
): Record<string, unknown> | null {
  const entries = Object.entries(patch);
  if (entries.length === 0 || entries.length > PREF_PATCH_MAX) return null;
  const writes: Array<{ key: string; value: string | null }> = [];
  for (const [key, value] of entries) {
    if (key.length === 0 || key.length > PREF_KEY_MAX) return null;
    if (value === null || value === undefined) {
      writes.push({ key, value: null });
      continue;
    }
    let encoded: string;
    try {
      encoded = JSON.stringify(value);
    } catch {
      return null;
    }
    if (encoded === undefined || encoded.length > PREF_VALUE_MAX) return null;
    writes.push({ key, value: encoded });
  }
  const count = db.prepare(`SELECT COUNT(*) AS n FROM ui_prefs`).get() as { n: number };
  if (count.n + writes.length > PREF_COUNT_MAX) return null;

  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    for (const w of writes) {
      if (w.value === null) {
        db.prepare(`DELETE FROM ui_prefs WHERE key = ?`).run(w.key);
      } else {
        db.prepare(
          `INSERT OR REPLACE INTO ui_prefs (key, value, updated_at) VALUES (?, ?, ?)`,
        ).run(w.key, w.value, now);
      }
    }
  });
  tx();
  return getPrefs(db);
}

/* ── disk usage ("what's eating ~/.claude") ─────────────────────────── */

/**
 * Sessions ranked by on-disk bytes, subagent transcript files rolled into
 * their parent. Read-only by design: Turnlog never deletes another tool's
 * files — the UI pairs this with reveal-in-file-manager instead.
 */
export function getDiskUsage(db: Database.Database, limit = 200): DiskUsageResponse {
  const totals = db
    .prepare(`SELECT COALESCE(SUM(file_size), 0) AS bytes, COUNT(*) AS files FROM sessions`)
    .get() as { bytes: number; files: number };
  const rows = db
    .prepare(
      `SELECT ${SESSION_COLUMNS},
              (SELECT COALESCE(SUM(f.file_size), 0) FROM sessions f
               WHERE f.id = sessions.id OR f.parent_session_id = sessions.id) AS bytes
       FROM ${SESSIONS_JOINED}
       WHERE parent_session_id IS NULL
       ORDER BY bytes DESC
       LIMIT ?`,
    )
    .all(Math.min(Math.max(limit, 1), 1000));
  return {
    totalBytes: totals.bytes,
    fileCount: totals.files,
    sessions: rows.map((r) => ({ ...rowToSession(r), bytes: (r as { bytes: number }).bytes })),
  };
}

/** The on-disk JSONL behind a session — for the reveal-in-file-manager action. */
export function getSessionFilePath(db: Database.Database, id: string): string | null {
  const row = db.prepare(`SELECT file_path FROM sessions WHERE id = ?`).get(id) as
    | { file_path: string }
    | undefined;
  return row?.file_path ?? null;
}

const DIFF_TOOLS_SQL = `('Edit','MultiEdit','Write','NotebookEdit')`;

/**
 * Lens WHERE fragments. Tool lenses match the tool_use rows and pull their
 * paired tool_result rows in via tool_use_id; the errors lens starts from
 * failing results and pulls the anchoring tool_use in.
 */
const LENS_SQL: Record<Lens, string> = {
  prompts: `AND kind = 'prompt' AND is_sidechain = 0`,
  diffs: `AND (tool_name IN ${DIFF_TOOLS_SQL}
    OR (kind = 'tool_result' AND tool_use_id IN (
      SELECT tool_use_id FROM messages
      WHERE session_id = @sid AND tool_name IN ${DIFF_TOOLS_SQL} AND tool_use_id IS NOT NULL)))`,
  commands: `AND (tool_name = 'Bash'
    OR (kind = 'tool_result' AND tool_use_id IN (
      SELECT tool_use_id FROM messages
      WHERE session_id = @sid AND tool_name = 'Bash' AND tool_use_id IS NOT NULL)))`,
  errors: `AND ((kind = 'tool_result' AND is_error = 1)
    OR tool_use_id IN (
      SELECT tool_use_id FROM messages
      WHERE session_id = @sid AND kind = 'tool_result' AND is_error = 1
        AND tool_use_id IS NOT NULL))`,
};

export function isLens(v: string | undefined): v is Lens {
  return (LENSES as readonly string[]).includes(v ?? '');
}

export function listMessages(
  db: Database.Database,
  sessionId: string,
  q: { afterIdx?: number; limit?: number; lens?: Lens },
): MessageListResponse | null {
  const session = db.prepare(`SELECT id FROM sessions WHERE id = ?`).get(sessionId);
  if (!session) return null;
  const afterIdx = q.afterIdx ?? -1;
  const limit = Math.min(Math.max(q.limit ?? 200, 1), 2000);
  const lensSql = q.lens ? LENS_SQL[q.lens] : '';

  const rows = db
    .prepare(
      `SELECT ${MESSAGE_COLUMNS}
       FROM messages WHERE session_id = @sid AND idx > @after ${lensSql}
       ORDER BY idx LIMIT @limit`,
    )
    .all({ sid: sessionId, after: afterIdx, limit });
  const total = db
    .prepare(`SELECT COUNT(*) AS n FROM messages WHERE session_id = @sid ${lensSql}`)
    .get({ sid: sessionId }) as { n: number };

  const messages: MessageRow[] = rows.map(rowToMessage);

  return { sessionId, messages, total: total.n };
}

const MESSAGE_COLUMNS = `uuid, parent_uuid, idx, role, kind, tool_name, tool_use_id, ts,
  is_sidechain, is_error, tokens_in, tokens_out, cost_usd, model, message_id, text, raw_json`;

function rowToMessage(r: any): MessageRow {
  return {
    uuid: r.uuid,
    parentUuid: r.parent_uuid,
    idx: r.idx,
    role: r.role,
    kind: r.kind,
    toolName: r.tool_name,
    toolUseId: r.tool_use_id,
    messageId: r.message_id ?? null,
    ts: r.ts,
    isSidechain: r.is_sidechain === 1,
    isError: r.is_error === 1,
    tokensIn: r.tokens_in,
    tokensOut: r.tokens_out,
    costUsd: r.cost_usd,
    model: r.model,
    text: r.text,
    raw: r.raw_json,
  };
}

/** Resolve an exact session id or a unique prefix (CLI convenience). */
export function resolveSessionId(db: Database.Database, idOrPrefix: string): string | null {
  const exact = db.prepare(`SELECT id FROM sessions WHERE id = ?`).get(idOrPrefix) as
    | { id: string }
    | undefined;
  if (exact) return exact.id;
  const matches = db
    .prepare(`SELECT id FROM sessions WHERE id LIKE ? LIMIT 2`)
    .all(`${idOrPrefix}%`) as { id: string }[];
  return matches.length === 1 ? matches[0]!.id : null;
}

/** Full session as markdown — CLI export + copy-as-markdown. */
/** Message-idx bounds for a partial export — share the fix, not all 1,800 turns. */
export interface ExportRange {
  fromIdx?: number;
  toIdx?: number;
}

function exportRows(db: Database.Database, id: string, range?: ExportRange): MessageRow[] {
  const clauses = ['session_id = ?'];
  const params: unknown[] = [id];
  if (range?.fromIdx !== undefined) {
    clauses.push('idx >= ?');
    params.push(range.fromIdx);
  }
  if (range?.toIdx !== undefined) {
    clauses.push('idx <= ?');
    params.push(range.toIdx);
  }
  return db
    .prepare(`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE ${clauses.join(' AND ')} ORDER BY idx`)
    .all(...params)
    .map(rowToMessage);
}

function withExcerpt(opts: ExportOptions, range?: ExportRange): ExportOptions {
  const partial = range?.fromIdx !== undefined || range?.toIdx !== undefined;
  return partial ? { ...opts, excerpt: true } : opts;
}

export function getSessionExport(
  db: Database.Database,
  id: string,
  opts: ExportOptions = {},
  range?: ExportRange,
): string | null {
  const session = getSession(db, id);
  if (!session) return null;
  return sessionToMarkdown(session, exportRows(db, id, range), withExcerpt(opts, range));
}

/** Full session as a self-contained styled HTML page — the shareable export. */
export function getSessionHtmlExport(
  db: Database.Database,
  id: string,
  opts: ExportOptions = {},
  range?: ExportRange,
): string | null {
  const session = getSession(db, id);
  if (!session) return null;
  return sessionToHtml(session, exportRows(db, id, range), withExcerpt(opts, range));
}

const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead']);
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
const COMMAND_RE = /<command-name>([^<]*)<\/command-name>/;
const TURN_TEXT_MAX = 240;

/**
 * The spine: prompts as turn boundaries, everything between two prompts
 * aggregated into mechanical counts. One cheap columns-only scan per call —
 * no raw JSON is touched.
 */
export function listTurns(db: Database.Database, sessionId: string): TurnsResponse | null {
  const session = db.prepare(`SELECT id FROM sessions WHERE id = ?`).get(sessionId);
  if (!session) return null;

  const rows = db
    .prepare(
      `SELECT uuid, parent_uuid, message_id, idx, kind, tool_name, ts,
              is_sidechain, is_error, tokens_out, text
       FROM messages WHERE session_id = ? ORDER BY idx`,
    )
    .all(sessionId) as Array<{
    uuid: string;
    parent_uuid: string | null;
    message_id: string | null;
    idx: number;
    kind: string;
    tool_name: string | null;
    ts: string | null;
    is_sidechain: number;
    is_error: number;
    tokens_out: number;
    text: string;
  }>;

  const abandoned = findAbandonedIdxs(rows);

  const turns: TurnSummary[] = [];
  let current: TurnSummary | null = null;
  let preludeCount = 0;

  for (const r of rows) {
    // A prompt on an abandoned branch was never actually answered (the user
    // interrupted and retyped) — it must not open a turn or the spine counts
    // conversations that never happened.
    if (abandoned.has(r.idx)) continue;
    if (r.kind === 'prompt' && r.is_sidechain === 0) {
      if (current) current.endIdx = r.idx;
      const command = COMMAND_RE.exec(r.text)?.[1]?.trim() ?? null;
      const text = command
        ? ''
        : r.text.replace(/\s+/g, ' ').trim().slice(0, TURN_TEXT_MAX);
      current = {
        idx: r.idx,
        endIdx: r.idx + 1, // patched below: next turn's start, or the session end
        uuid: r.uuid,
        ts: r.ts,
        text,
        command,
        reads: 0,
        edits: 0,
        commands: 0,
        tasks: 0,
        otherTools: 0,
        errors: 0,
        tokensOut: 0,
      };
      turns.push(current);
      continue;
    }
    if (!current) {
      preludeCount++;
      continue;
    }
    // Errors count from sidechains too (a failed subagent matters);
    // tool tallies stay main-chain so the summary reads as "what I saw".
    if (r.is_error === 1) current.errors++;
    if (r.is_sidechain === 1) continue;
    current.tokensOut += r.tokens_out;
    if (r.kind === 'tool_use' && r.tool_name !== null) {
      if (READ_TOOLS.has(r.tool_name)) current.reads++;
      else if (EDIT_TOOLS.has(r.tool_name)) current.edits++;
      else if (r.tool_name === 'Bash') current.commands++;
      else if (r.tool_name === 'Task') current.tasks++;
      else current.otherTools++;
    }
  }

  // idx is line-ordered but can have gaps (duplicate uuids are ignored on
  // insert), so the session's end bound comes from the last idx, not COUNT.
  const total = rows.length === 0 ? 0 : rows[rows.length - 1]!.idx + 1;
  if (current) current.endIdx = total;

  return { sessionId, turns, total, preludeCount };
}

/**
 * Rows on abandoned branches, by idx.
 *
 * `parentUuid` is a tree: interrupting Claude mid-answer and retyping (or a
 * rewind) leaves the first attempt as a dead sibling subtree, which file-order
 * rendering would otherwise show as a normal turn. Most multi-child nodes are
 * NOT branches, so three shapes are excluded first:
 *
 *  - continuation lines of the parent's own API response (same message id —
 *    CC writes one line per content block),
 *  - `tool_result` rows, which attach to their `tool_use` rather than fork it,
 *  - injected `meta`/`system`/bookkeeping records, which hang off whatever
 *    came before them.
 *
 * What remains is a real fork; the last child in file order is the live path
 * (the retry the conversation continued from) and the earlier siblings —
 * with their whole subtrees — are abandoned.
 *
 * Mirrored client-side in `web/src/replay/thread.ts` (same rule, over the
 * loaded window) — keep the two in step.
 */
interface BranchRow {
  uuid: string;
  parent_uuid?: string | null;
  parentUuid?: string | null;
  idx: number;
  kind: string;
  message_id?: string | null;
  messageId?: string | null;
  is_sidechain?: number;
  isSidechain?: boolean;
}

const BRANCH_INERT_KINDS = new Set(['meta', 'system', 'attachment', 'mode', 'title', 'unknown']);

export function findAbandonedIdxs(rows: BranchRow[]): Set<number> {
  const parentOf = (r: BranchRow) => r.parent_uuid ?? r.parentUuid ?? null;
  const msgIdOf = (r: BranchRow) => r.message_id ?? r.messageId ?? null;
  const sideOf = (r: BranchRow) => r.is_sidechain === 1 || r.isSidechain === true;

  const main = rows.filter((r) => !sideOf(r));
  const byUuid = new Map(main.map((r) => [r.uuid, r]));
  const children = new Map<string, BranchRow[]>();
  for (const r of main) {
    const p = parentOf(r);
    if (p === null) continue;
    const list = children.get(p);
    if (list) list.push(r);
    else children.set(p, [r]);
  }

  const abandoned = new Set<number>();
  for (const [parentUuid, kids] of children) {
    if (kids.length < 2) continue;
    const parent = byUuid.get(parentUuid);
    const parentMsgId = parent ? msgIdOf(parent) : null;
    const forks = kids.filter(
      (c) =>
        !(parentMsgId !== null && msgIdOf(c) === parentMsgId) &&
        c.kind !== 'tool_result' &&
        !BRANCH_INERT_KINDS.has(c.kind),
    );
    if (forks.length < 2) continue;
    forks.sort((a, b) => a.idx - b.idx);
    // Everything but the live (last) child, and everything hanging off it.
    for (const dead of forks.slice(0, -1)) {
      const stack = [dead];
      while (stack.length > 0) {
        const node = stack.pop()!;
        if (abandoned.has(node.idx)) continue;
        abandoned.add(node.idx);
        for (const child of children.get(node.uuid) ?? []) stack.push(child);
      }
    }
  }
  return abandoned;
}

/**
 * Search operators — `op:value` tokens mapped straight onto indexed columns.
 * Unknown operators and malformed values fall through as plain text terms,
 * so `file.ts:12` or `https://…` never break a query.
 */
export interface SearchFilters {
  tool?: string;
  kind?: string;
  isError?: boolean;
  project?: string;
  model?: string;
  before?: string;
  after?: string;
  /** is:pinned — sessions the user pinned (annotation tables join the query language). */
  pinned?: boolean;
  /** has:note — sessions carrying a user note. */
  hasNote?: boolean;
  /** has:bookmark — bookmarked moments themselves (message-level, not the whole session). */
  hasBookmark?: boolean;
}

export interface ParsedQuery {
  /** The free-text remainder after operators are pulled out. */
  terms: string;
  filters: SearchFilters;
  hasFilters: boolean;
}

const FILTER_OPS = new Set(['tool', 'kind', 'is', 'has', 'project', 'model', 'before', 'after']);
const DATE_RE = /^\d{4}(-\d{2}(-\d{2})?)?$/;

export function parseSearchQuery(input: string): ParsedQuery {
  const terms: string[] = [];
  const filters: SearchFilters = {};
  for (const token of input.split(/\s+/).filter(Boolean)) {
    const colon = token.indexOf(':');
    const op = colon > 0 ? token.slice(0, colon).toLowerCase() : null;
    const value = colon > 0 ? token.slice(colon + 1) : '';
    if (op === null || !FILTER_OPS.has(op) || value === '') {
      terms.push(token);
      continue;
    }
    switch (op) {
      case 'tool':
        filters.tool = value;
        break;
      case 'kind':
        filters.kind = value;
        break;
      case 'project':
        filters.project = value;
        break;
      case 'model':
        filters.model = value;
        break;
      case 'is':
        if (value.toLowerCase() === 'error') filters.isError = true;
        else if (value.toLowerCase() === 'pinned') filters.pinned = true;
        else terms.push(token);
        break;
      case 'has':
        if (value.toLowerCase() === 'note') filters.hasNote = true;
        else if (value.toLowerCase() === 'bookmark') filters.hasBookmark = true;
        else terms.push(token);
        break;
      case 'before':
      case 'after':
        // ISO prefixes (2026, 2026-07, 2026-07-01) compare lexicographically
        // against the stored full-ISO timestamps.
        if (DATE_RE.test(value)) filters[op] = value;
        else terms.push(token);
        break;
    }
  }
  return { terms: terms.join(' '), filters, hasFilters: Object.keys(filters).length > 0 };
}

/** WHERE fragments for the parsed filters; `m` = messages, sessionAlias = sessions. */
function filterSql(f: SearchFilters, sessionAlias: string): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (f.tool !== undefined) {
    clauses.push('m.tool_name = ? COLLATE NOCASE');
    params.push(f.tool);
  }
  if (f.kind !== undefined) {
    clauses.push('m.kind = ? COLLATE NOCASE');
    params.push(f.kind);
  }
  if (f.isError) clauses.push('m.is_error = 1');
  if (f.model !== undefined) {
    clauses.push('m.model LIKE ?');
    params.push(`%${f.model}%`);
  }
  if (f.project !== undefined) {
    clauses.push(`${sessionAlias}.project_key LIKE ?`);
    params.push(`%${f.project}%`);
  }
  if (f.before !== undefined) {
    clauses.push('m.ts < ?');
    params.push(f.before);
  }
  if (f.after !== undefined) {
    clauses.push('m.ts >= ?');
    params.push(f.after);
  }
  // Annotations live on the ROOT session (children are hidden from lists), so
  // hits inside subagent transcripts must test the parent's annotations.
  const annotated = `COALESCE(${sessionAlias}.parent_session_id, ${sessionAlias}.id)`;
  if (f.pinned) {
    clauses.push(
      `EXISTS (SELECT 1 FROM session_meta sm WHERE sm.session_id = ${annotated} AND sm.pinned = 1)`,
    );
  }
  if (f.hasNote) {
    clauses.push(
      `EXISTS (SELECT 1 FROM session_meta sm WHERE sm.session_id = ${annotated} AND sm.note IS NOT NULL)`,
    );
  }
  if (f.hasBookmark) {
    clauses.push(
      `EXISTS (SELECT 1 FROM message_bookmarks b WHERE b.session_id = m.session_id AND b.idx = m.idx)`,
    );
  }
  return { sql: clauses.map((c) => `AND ${c}`).join(' '), params };
}

/**
 * Sanitize free-form user input into an FTS5 MATCH expression: each token
 * becomes a quoted phrase (so FTS syntax like parens or NEAR can't error),
 * with a trailing * preserved as a prefix query.
 */
export function toFtsQuery(input: string): string | null {
  const tokens = input.split(/\s+/).filter(Boolean).slice(0, 16);
  const parts: string[] = [];
  for (const token of tokens) {
    const prefix = token.endsWith('*');
    const core = token.replace(/\*+$/, '').replace(/"/g, '""');
    if (core === '') continue;
    parts.push(`"${core}"${prefix ? '*' : ''}`);
  }
  return parts.length > 0 ? parts.join(' ') : null;
}

// Matches resolve to the ROOT session: a hit inside a subagent transcript
// counts as its parent, whose row carries the family's rolled-up totals —
// summing both parent and child rows would double count.
const MATCHED_SESSIONS_SQL = `SELECT DISTINCT COALESCE(ms.parent_session_id, ms.id)
  FROM messages_fts
  JOIN messages m ON m.rowid = messages_fts.rowid
  JOIN sessions ms ON ms.id = m.session_id
  WHERE messages_fts MATCH ?`;

function searchAggregates(
  db: Database.Database,
  match: string | null,
  filters: SearchFilters,
): SearchAggregates | null {
  const f = filterSql(filters, 'ms');
  const matched = match
    ? `SELECT DISTINCT COALESCE(ms.parent_session_id, ms.id)
       FROM messages_fts
       JOIN messages m ON m.rowid = messages_fts.rowid
       JOIN sessions ms ON ms.id = m.session_id
       WHERE messages_fts MATCH ? ${f.sql}`
    : `SELECT DISTINCT COALESCE(ms.parent_session_id, ms.id)
       FROM messages m
       JOIN sessions ms ON ms.id = m.session_id
       WHERE 1=1 ${f.sql}`;
  const params = match ? [match, ...f.params] : f.params;
  try {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n,
                COALESCE(SUM(cost_usd), 0) AS cost,
                SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END) AS unpriced,
                COALESCE(SUM(turn_count), 0) AS turns,
                COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens
         FROM sessions WHERE id IN (${matched})`,
      )
      .get(...params) as any;
    return {
      matchedSessions: row.n,
      totalCostUsd: row.cost,
      unpricedSessions: row.unpriced ?? 0,
      totalTurns: row.turns,
      totalTokens: row.tokens,
    };
  } catch {
    return null;
  }
}

const SESSION_JOIN_COLUMNS = `s.id, s.project_path, s.project_key, s.parent_session_id,
                s.started_at, s.ended_at, s.model,
                s.turn_count, s.input_tokens, s.output_tokens, s.cache_read_tokens,
                s.cache_write_tokens, s.cost_usd, s.files_touched_count,
                (SELECT COUNT(*) FROM sessions c
                 WHERE c.root_uuid = s.root_uuid AND c.project_key IS s.project_key
                   AND c.parent_session_id IS NULL) AS chain_len`;

/**
 * Shared front half of every search entry point: operators parsed out, the
 * remainder sanitized for FTS. `empty` = nothing searchable at all.
 */
function parseForSearch(query: string): {
  parsed: ParsedQuery;
  match: string | null;
  empty: boolean;
} {
  const parsed = parseSearchQuery(query);
  const match = parsed.terms !== '' ? toFtsQuery(parsed.terms) : null;
  return { parsed, match, empty: match === null && !parsed.hasFilters };
}

export function searchMessages(
  db: Database.Database,
  q: { query: string; limit?: number; sessionId?: string },
): SearchResponse {
  const { parsed, match, empty: nothing } = parseForSearch(q.query);
  const empty: SearchResponse = { query: q.query, groups: [], totalHits: 0, aggregates: null };
  if (nothing) return empty;
  const limit = Math.min(Math.max(q.limit ?? 100, 1), 500);
  const f = filterSql(parsed.filters, 's');

  // Session-scoped find (in-session Cmd-F) orders by position, not rank —
  // prev/next navigation needs document order.
  const sessionWhere = q.sessionId !== undefined ? 'AND m.session_id = ?' : '';

  let rows: any[];
  try {
    if (match !== null) {
      const order = q.sessionId !== undefined ? 'm.idx' : 'bm25(messages_fts)';
      const params: unknown[] = [SNIPPET_OPEN, SNIPPET_CLOSE, match];
      if (q.sessionId !== undefined) params.push(q.sessionId);
      params.push(...f.params, limit);
      rows = db
        .prepare(
          `SELECT m.uuid, m.session_id, m.idx, m.kind, m.tool_name, m.ts,
                  snippet(messages_fts, 0, ?, ?, '…', 12) AS snip,
                  ${SESSION_JOIN_COLUMNS}
           FROM messages_fts
           JOIN messages m ON m.rowid = messages_fts.rowid
           JOIN sessions s ON s.id = m.session_id
           WHERE messages_fts MATCH ? ${sessionWhere} ${f.sql}
           ORDER BY ${order}
           LIMIT ?`,
        )
        .all(...params);
    } else {
      // Operator-only query — no FTS involved; plain column filters, newest
      // sessions first. The snippet is a raw excerpt (no match to mark).
      const order = q.sessionId !== undefined ? 'm.idx' : 's.started_at DESC, m.idx';
      const params: unknown[] = [];
      if (q.sessionId !== undefined) params.push(q.sessionId);
      params.push(...f.params, limit);
      rows = db
        .prepare(
          `SELECT m.uuid, m.session_id, m.idx, m.kind, m.tool_name, m.ts,
                  substr(m.text, 1, 240) AS snip,
                  ${SESSION_JOIN_COLUMNS}
           FROM messages m
           JOIN sessions s ON s.id = m.session_id
           WHERE 1=1 ${sessionWhere} ${f.sql}
           ORDER BY ${order}
           LIMIT ?`,
        )
        .all(...params);
    }
  } catch {
    return empty; // belt and suspenders: a MATCH error must never 500
  }

  const groups = new Map<string, { session: SessionMeta; hits: SearchResponse['groups'][0]['hits'] }>();
  for (const r of rows) {
    let group = groups.get(r.session_id);
    if (!group) {
      group = { session: rowToSession(r), hits: [] };
      groups.set(r.session_id, group);
    }
    group.hits.push({
      uuid: r.uuid,
      idx: r.idx,
      kind: r.kind,
      toolName: r.tool_name,
      ts: r.ts,
      snippet: r.snip,
    });
  }

  return {
    query: q.query,
    groups: [...groups.values()],
    totalHits: rows.length,
    // Session-scoped find doesn't need money attached to it.
    aggregates:
      q.sessionId === undefined ? searchAggregates(db, match, parsed.filters) : null,
  };
}

/**
 * Sessions on a personal index rarely reach four digits; the cap only guards
 * against a degenerate operator-only query matching everything.
 */
const TIMELINE_MAX_SESSIONS = 1000;

/**
 * The search-anchored timeline: the FULL match set (never the truncated hit
 * page) grouped per root session, oldest first — "when did this keep coming
 * up?". Each session carries its first in-root hit idx as the jump target.
 */
export function searchTimeline(
  db: Database.Database,
  q: { query: string },
): SearchTimelineResponse {
  const { parsed, match, empty: nothing } = parseForSearch(q.query);
  const empty: SearchTimelineResponse = { query: q.query, sessions: [] };
  if (nothing) return empty;
  const f = filterSql(parsed.filters, 'ms');

  // Hits resolve to the ROOT session (same rule as aggregates); the first-hit
  // idx only counts hits in the root itself — an idx inside a subagent
  // transcript is meaningless as a jump target in the parent's replay.
  const hitsFrom =
    match !== null
      ? `FROM messages_fts
         JOIN messages m ON m.rowid = messages_fts.rowid
         JOIN sessions ms ON ms.id = m.session_id
         WHERE messages_fts MATCH ? ${f.sql}`
      : `FROM messages m
         JOIN sessions ms ON ms.id = m.session_id
         WHERE 1=1 ${f.sql}`;
  const params: unknown[] = match !== null ? [match, ...f.params] : [...f.params];

  try {
    const rows = db
      .prepare(
        `SELECT ${SESSION_COLUMNS}, h.n AS hit_count, h.first_idx AS first_idx
         FROM ${SESSIONS_JOINED}
         JOIN (SELECT COALESCE(ms.parent_session_id, ms.id) AS root_id,
                      COUNT(*) AS n,
                      MIN(CASE WHEN ms.parent_session_id IS NULL THEN m.idx END) AS first_idx
               ${hitsFrom}
               GROUP BY root_id) h ON h.root_id = sessions.id
         ORDER BY started_at, sessions.id
         LIMIT ?`,
      )
      .all(...params, TIMELINE_MAX_SESSIONS);
    return {
      query: q.query,
      sessions: rows.map((r: any) => ({
        session: rowToSession(r),
        hits: r.hit_count as number,
        firstIdx: (r.first_idx as number | null) ?? null,
      })),
    };
  } catch {
    return empty; // same belt-and-suspenders as searchMessages: MATCH never 500s
  }
}

/**
 * The context-window timeline. Usage is zeroed on duplicate content-block
 * lines at index time, so every surviving usage row IS one API response;
 * its prompt side (input + cache read + cache write) is the window fill at
 * that moment. Sidechains are excluded — subagents run their own context.
 * Null = unknown session.
 */
export function getSessionContext(
  db: Database.Database,
  sessionId: string,
): SessionContextResponse | null {
  const exists = db.prepare(`SELECT id FROM sessions WHERE id = ?`).get(sessionId);
  if (!exists) return null;
  const points = db
    .prepare(
      `SELECT idx, ts,
              tokens_in + cache_read_tokens + cache_write_tokens AS ctx,
              tokens_out AS tout
       FROM messages
       WHERE session_id = ? AND is_sidechain = 0
         AND tokens_in + cache_read_tokens + cache_write_tokens > 0
       ORDER BY idx`,
    )
    .all(sessionId) as { idx: number; ts: string | null; ctx: number; tout: number }[];
  // compact_boundary rides a plain system record; the metadata stays in raw
  // JSON (json_valid guards garbage lines, per the cardinal rule).
  const compactions = db
    .prepare(
      `SELECT idx, ts, json_extract(raw_json, '$.compactMetadata.preTokens') AS pre
       FROM messages
       WHERE session_id = ? AND kind = 'system' AND json_valid(raw_json)
         AND json_extract(raw_json, '$.subtype') = 'compact_boundary'
       ORDER BY idx`,
    )
    .all(sessionId) as { idx: number; ts: string | null; pre: unknown }[];
  return {
    sessionId,
    points: points.map((p) => ({ idx: p.idx, ts: p.ts, context: p.ctx, tokensOut: p.tout })),
    compactions: compactions.map((c) => ({
      idx: c.idx,
      ts: c.ts,
      preTokens: typeof c.pre === 'number' ? c.pre : null,
    })),
  };
}

/* ── saved searches (schema v5; survives rebuilds like session_meta) ── */

const SAVED_NAME_MAX = 120;
const SAVED_QUERY_MAX = 500;

function rowToSavedSearch(r: any): SavedSearch {
  return { id: r.id, name: r.name, query: r.query, createdAt: r.created_at ?? null };
}

export function listSavedSearches(db: Database.Database): SavedSearch[] {
  return db
    .prepare(`SELECT id, name, query, created_at FROM saved_searches ORDER BY id DESC`)
    .all()
    .map(rowToSavedSearch);
}

/** Create a saved search; the name defaults to the query. Null = nothing to save. */
export function createSavedSearch(
  db: Database.Database,
  name: string | null,
  query: string,
): SavedSearch | null {
  const q = query.trim().slice(0, SAVED_QUERY_MAX);
  if (q === '') return null;
  const n = (name ?? '').trim().slice(0, SAVED_NAME_MAX) || q;
  const info = db
    .prepare(`INSERT INTO saved_searches (name, query, created_at) VALUES (?, ?, ?)`)
    .run(n, q, new Date().toISOString());
  const row = db
    .prepare(`SELECT id, name, query, created_at FROM saved_searches WHERE id = ?`)
    .get(info.lastInsertRowid);
  return rowToSavedSearch(row);
}

export function deleteSavedSearch(db: Database.Database, id: number): boolean {
  return db.prepare(`DELETE FROM saved_searches WHERE id = ?`).run(id).changes > 0;
}

/* ── cross-session file history ("git blame for agent edits") ───────── */

/** Files matching a path fragment, most recently touched first. */
export function searchFiles(
  db: Database.Database,
  q: { query?: string; limit?: number },
): FileSummary[] {
  const limit = Math.min(Math.max(q.limit ?? 100, 1), 500);
  const like = q.query ? `%${q.query}%` : '%';
  const rows = db
    .prepare(
      `SELECT ft.path AS path,
              COUNT(DISTINCT COALESCE(s.parent_session_id, s.id)) AS n,
              MAX(COALESCE(s.ended_at, s.started_at)) AS last
       FROM files_touched ft
       JOIN sessions s ON s.id = ft.session_id
       WHERE ft.path LIKE ?
       GROUP BY ft.path
       ORDER BY last DESC
       LIMIT ?`,
    )
    .all(like, limit) as { path: string; n: number; last: string | null }[];
  return rows.map((r) => ({ path: r.path, sessions: r.n, lastTouched: r.last }));
}

/** Every session that touched a path (subagent hits resolve to their root). */
export function getFileHistory(db: Database.Database, path: string): FileHistoryResponse {
  const rows = db
    .prepare(
      `SELECT ${SESSION_COLUMNS} FROM ${SESSIONS_JOINED}
       WHERE sessions.id IN (
         SELECT DISTINCT COALESCE(fs.parent_session_id, fs.id)
         FROM files_touched ft
         JOIN sessions fs ON fs.id = ft.session_id
         WHERE ft.path = ?)
       ORDER BY started_at DESC
       LIMIT 500`,
    )
    .all(path);
  return { path, sessions: rows.map(rowToSession) };
}

export function listProjects(db: Database.Database): ProjectInfo[] {
  const rows = db
    .prepare(
      `SELECT project_key, MAX(project_path) AS project_path, COUNT(*) AS n,
              COALESCE(SUM(cost_usd), 0) AS cost
       FROM sessions WHERE parent_session_id IS NULL
       GROUP BY project_key ORDER BY n DESC`,
    )
    .all();
  return rows.map((r: any) => ({
    projectKey: r.project_key,
    projectPath: r.project_path,
    sessionCount: r.n,
    costUsd: r.cost,
  }));
}

/**
 * The spend view: daily rollups and splits over the
 * session index, optionally narrowed to sessions matching an FTS query —
 * "what did this kind of work cost me". Session-start attribution.
 */
export function getSpend(
  db: Database.Database,
  q: { days?: number; query?: string; pricingOverrides?: Record<string, Partial<ModelPricing>> },
): SpendResponse {
  const sinceDays = Math.min(Math.max(Math.floor(q.days ?? 30), 1), 3650);
  const cutoff = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
  const match = q.query ? toFtsQuery(q.query) : null;

  // Chain-aware money: resuming a session copies its whole history into the
  // new file — same message uuids under a new session id — so summing session
  // aggregates bills a 3-part chain's shared prefix 3×. The copies are
  // excluded up front: within each multi-part family (root_uuid + project),
  // every message uuid's first occurrence (earliest part) keeps its usage and
  // the rest drop. Chains are rare, so ranking only family messages is cheap;
  // it spans ALL sessions, not just the window — a prefix owned by a part
  // outside the window stays outside it.
  const dupRowids = `
    SELECT mrowid FROM (
      SELECT m2.rowid AS mrowid,
             ROW_NUMBER() OVER (
               PARTITION BY s2.root_uuid, s2.project_key, m2.uuid
               ORDER BY s2.started_at, s2.id
             ) AS rn
      FROM messages m2
      JOIN sessions s2 ON s2.id = m2.session_id
      JOIN (SELECT root_uuid, project_key FROM sessions
            WHERE root_uuid IS NOT NULL AND parent_session_id IS NULL
            GROUP BY root_uuid, project_key HAVING COUNT(*) > 1) fam
        ON fam.root_uuid = s2.root_uuid AND fam.project_key IS s2.project_key
    ) WHERE rn > 1`;

  // One join-free scan of messages, aggregated per (session, model) — the
  // join to sessions per row is what made SQL-side grouping slow (~0.5s on a
  // real index; this shape runs in ~0.1s). Session attributes (project, day,
  // window membership) fold in below from one small sessions read.
  const cells = db
    .prepare(
      `SELECT m.session_id AS sessionId, m.model AS model,
              COALESCE(SUM(m.cost_usd), 0) AS cost,
              COALESCE(SUM(m.tokens_in), 0) AS tin, COALESCE(SUM(m.tokens_out), 0) AS tout,
              COALESCE(SUM(m.cache_read_tokens), 0) AS cr,
              COALESCE(SUM(m.cache_write_tokens), 0) AS cw
       FROM messages m
       WHERE m.rowid NOT IN (${dupRowids})
       GROUP BY 1, 2`,
    )
    .all() as {
    sessionId: string;
    model: string | null;
    cost: number;
    tin: number;
    tout: number;
    cr: number;
    cw: number;
  }[];

  interface SessionRowLite {
    id: string;
    parent_session_id: string | null;
    project_key: string | null;
    started_at: string | null;
    cost_usd: number | null;
  }
  const sessions = db
    .prepare(`SELECT id, parent_session_id, project_key, started_at, cost_usd FROM sessions`)
    .all() as SessionRowLite[];
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const matchedRoots = match
    ? new Set(
        (db.prepare(MATCHED_SESSIONS_SQL).raw().all(match) as [string][]).map((r) => r[0]),
      )
    : null;

  // date(..., 'localtime') semantics, in JS: the machine's calendar day —
  // the server always runs on the user's own machine, so its timezone is
  // the right one.
  const localDay = (iso: string): string => {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const inWindow = (s: SessionRowLite): boolean => {
    if (s.started_at === null || s.started_at < cutoff) return false;
    const root = s.parent_session_id ?? s.id;
    return matchedRoots === null || matchedRoots.has(root);
  };

  const dayMap = new Map<string, { cost: number; tokens: number }>();
  const projMap = new Map<string, { cost: number; tokens: number }>();
  const modelMap = new Map<
    string,
    { cost: number; tokens: number; cr: number; roots: Set<string> }
  >();
  const totals = { cost: 0, tin: 0, tout: 0, cr: 0, cw: 0 };
  for (const c of cells) {
    const s = byId.get(c.sessionId);
    if (!s || !inWindow(s)) continue;
    totals.cost += c.cost;
    totals.tin += c.tin;
    totals.tout += c.tout;
    totals.cr += c.cr;
    totals.cw += c.cw;
    const date = localDay(s.started_at!);
    const day = dayMap.get(date) ?? { cost: 0, tokens: 0 };
    day.cost += c.cost;
    day.tokens += c.tin + c.tout;
    dayMap.set(date, day);
    const pkey = s.project_key ?? '';
    const proj = projMap.get(pkey) ?? { cost: 0, tokens: 0 };
    proj.cost += c.cost;
    proj.tokens += c.tin + c.tout;
    projMap.set(pkey, proj);
    // Per-message model attribution: sessions mix models (subagents, /model
    // switches). Placeholder models ('<synthetic>') carry no usage — skipped.
    if (c.model !== null && !c.model.startsWith('<')) {
      const mdl = modelMap.get(c.model) ?? { cost: 0, tokens: 0, cr: 0, roots: new Set<string>() };
      mdl.cost += c.cost;
      mdl.tokens += c.tin + c.tout;
      mdl.cr += c.cr;
      mdl.roots.add(s.parent_session_id ?? s.id);
      modelMap.set(c.model, mdl);
    }
  }

  // Session counts and the unpriced tally stay session-derived (root sessions
  // only — parents already show their subagents' work).
  const windowRoots = sessions.filter((s) => s.parent_session_id === null && inWindow(s));
  const dayN = new Map<string, number>();
  const projN = new Map<string, number>();
  for (const s of windowRoots) {
    const date = localDay(s.started_at!);
    dayN.set(date, (dayN.get(date) ?? 0) + 1);
    const pkey = s.project_key ?? '';
    projN.set(pkey, (projN.get(pkey) ?? 0) + 1);
  }
  const dayDates = new Set([...dayMap.keys(), ...dayN.keys()]);
  const days = [...dayDates].sort().map((date) => {
    const d = dayMap.get(date);
    return { date, cost: d?.cost ?? 0, tokens: d?.tokens ?? 0, n: dayN.get(date) ?? 0 };
  });
  const byModel = [...modelMap.entries()]
    .map(([key, m]) => ({ key, cost: m.cost, tokens: m.tokens, cr: m.cr, n: m.roots.size }))
    .sort((a, b) => b.cost - a.cost);
  const byProject = [...projMap.entries()]
    .map(([key, p]) => ({
      key: key === '' ? null : key,
      cost: p.cost,
      tokens: p.tokens,
      n: projN.get(key) ?? 0,
    }))
    .sort((a, b) => b.cost - a.cost);

  const sessionTotals = {
    n: windowRoots.length,
    unpriced: windowRoots.filter((s) => s.cost_usd === null).length,
  };

  // Cache savings: reads billed at cacheRead instead of the full input rate.
  let cacheSavedUsd = 0;
  for (const m of byModel) {
    if (!m.key || m.cr === 0) continue;
    const p = pricingForModel(m.key, q.pricingOverrides);
    if (p) cacheSavedUsd += (m.cr * (p.input - p.cacheRead)) / 1_000_000;
  }

  return {
    days: days.map((d) => ({ date: d.date, costUsd: d.cost, tokens: d.tokens, sessions: d.n })),
    byModel: byModel.map((m) => ({
      key: m.key ?? 'unknown',
      costUsd: m.cost,
      tokens: m.tokens,
      sessions: m.n,
    })),
    byProject: byProject.map((p) => ({
      key: p.key ?? 'unknown',
      costUsd: p.cost,
      tokens: p.tokens,
      sessions: p.n,
    })),
    totals: {
      costUsd: totals.cost,
      unpricedSessions: sessionTotals.unpriced ?? 0,
      sessions: sessionTotals.n,
      inputTokens: totals.tin,
      outputTokens: totals.tout,
      cacheReadTokens: totals.cr,
      cacheWriteTokens: totals.cw,
      cacheSavedUsd,
    },
    sinceDays,
    query: match ? q.query! : null,
  };
}

/**
 * The DB half of `GET /api/health` (the server merges in the driver's scan
 * state): index size plus the unknown-record tally — the cardinal rule's
 * "never crash, never drop" residue, surfaced instead of silent.
 */
export function getIndexHealth(db: Database.Database): {
  indexedFiles: number;
  events: number;
  unknownEvents: number;
  unknownTypes: { type: string; count: number }[];
  dbBytes: number;
} {
  const files = db.prepare(`SELECT COUNT(*) AS n FROM sessions`).get() as { n: number };
  const events = db.prepare(`SELECT COUNT(*) AS n FROM messages`).get() as { n: number };
  const unknown = db
    .prepare(`SELECT COUNT(*) AS n FROM messages WHERE kind = 'unknown'`)
    .get() as { n: number };
  // json_valid guards json_extract: garbage lines are stored verbatim too.
  const types = db
    .prepare(
      `SELECT COALESCE(json_extract(raw_json, '$.type'), '(untyped)') AS type, COUNT(*) AS n
       FROM messages WHERE kind = 'unknown' AND json_valid(raw_json)
       GROUP BY 1 ORDER BY n DESC, type LIMIT 12`,
    )
    .all() as { type: string; n: number }[];
  const unknownTypes = types.map((t) => ({ type: t.type, count: t.n }));
  const garbage = db
    .prepare(
      `SELECT COUNT(*) AS n FROM messages WHERE kind = 'unknown' AND NOT json_valid(raw_json)`,
    )
    .get() as { n: number };
  if (garbage.n > 0) unknownTypes.push({ type: '(unparseable)', count: garbage.n });
  const dbBytes =
    (db.pragma('page_count', { simple: true }) as number) *
    (db.pragma('page_size', { simple: true }) as number);
  return {
    indexedFiles: files.n,
    events: events.n,
    unknownEvents: unknown.n,
    unknownTypes,
    dbBytes,
  };
}

/* ── index maintenance (our own data only; ~/.claude stays read-only) ── */

/**
 * Drop index rows for session files that no longer exist on disk. The watcher
 * sees writes, not unlinks, so deleted logs linger in the index forever.
 *
 * User annotations (pins, names, notes, bookmarks) are deliberately NOT
 * deleted: they are keyed by session id and survive `rebuild()` by the same
 * reasoning — if the file returns (a moved project dir, a restored backup),
 * so does everything the user wrote about it.
 */
export function pruneMissingSessions(db: Database.Database): { pruned: number } {
  const rows = db.prepare(`SELECT id, file_path FROM sessions`).all() as {
    id: string;
    file_path: string;
  }[];
  const gone = rows.filter((r) => !fs.existsSync(r.file_path)).map((r) => r.id);
  if (gone.length === 0) return { pruned: 0 };

  // messages_fts is an external-content table: every row must be withdrawn
  // with its text before the message row goes, or the index keeps phantoms.
  const selRows = db.prepare(`SELECT rowid, text FROM messages WHERE session_id = ?`);
  const ftsDelete = db.prepare(
    `INSERT INTO messages_fts (messages_fts, rowid, text) VALUES ('delete', ?, ?)`,
  );
  const delMessages = db.prepare(`DELETE FROM messages WHERE session_id = ?`);
  const delFiles = db.prepare(`DELETE FROM files_touched WHERE session_id = ?`);
  const delSession = db.prepare(`DELETE FROM sessions WHERE id = ?`);
  const tx = db.transaction((ids: string[]) => {
    for (const id of ids) {
      for (const r of selRows.all(id) as { rowid: number; text: string }[]) {
        ftsDelete.run(r.rowid, r.text);
      }
      delMessages.run(id);
      delFiles.run(id);
      delSession.run(id);
    }
  });
  tx(gone);
  return { pruned: gone.length };
}

/** Repack the index file after deletions. Returns the bytes freed (never negative). */
export function vacuumIndex(db: Database.Database): { freedBytes: number; dbBytes: number } {
  const size = () =>
    (db.pragma('page_count', { simple: true }) as number) *
    (db.pragma('page_size', { simple: true }) as number);
  const before = size();
  db.exec('VACUUM');
  const after = size();
  return { freedBytes: Math.max(0, before - after), dbBytes: after };
}

export function getStats(db: Database.Database): StatsResponse {
  const totals = db
    .prepare(
      `SELECT COUNT(*) AS sessions,
              COALESCE(SUM(turn_count), 0) AS messages,
              COALESCE(SUM(input_tokens), 0) AS input_tokens,
              COALESCE(SUM(output_tokens), 0) AS output_tokens,
              COALESCE(SUM(cost_usd), 0) AS cost_usd
       FROM sessions WHERE parent_session_id IS NULL`,
    )
    .get() as any;
  return {
    sessions: totals.sessions,
    messages: totals.messages,
    inputTokens: totals.input_tokens,
    outputTokens: totals.output_tokens,
    costUsd: totals.cost_usd,
    projects: listProjects(db),
  };
}
