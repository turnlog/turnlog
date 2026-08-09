import fs from 'node:fs';
import type Database from 'better-sqlite3';
import { DEEP_MIN_CHARS, hasDeepIndex } from '../indexer/deepSearch.js';
import { pricingForModel, type ModelPricing } from '../cost/pricing.js';
import { sessionToHtml } from '../export/html.js';
import { sessionToJson } from '../export/json.js';
import { sessionToMarkdown, type ExportOptions } from '../export/markdown.js';
import type {
  ChildSessionSummary,
  DiskUsageResponse,
  FileHistoryResponse,
  FileSummary,
  MessageListResponse,
  MessageRow,
  BookmarksListResponse,
  ErrorSignaturesResponse,
  ProjectDetail,
  ProjectInfo,
  LiveResponse,
  RelatedResponse,
  SavedSearch,
  SearchAggregates,
  SearchFacet,
  SearchFacets,
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
  id, project_path, project_key, parent_session_id, started_at, ended_at, model, event_count, tool,
  branch,
  input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
  cost_usd, files_touched_count, ai_title, cc_title,
  COALESCE(session_meta.pinned, 0) AS pinned, custom_name, note,
  -- Tags ride the row so a list can show its chips without a query per row.
  (SELECT group_concat(tag, char(10)) FROM (
     SELECT tag FROM session_tags WHERE session_id = sessions.id ORDER BY tag
   )) AS tags,
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
    branch: r.branch ?? null,
    eventCount: r.event_count,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    cacheReadTokens: r.cache_read_tokens,
    cacheWriteTokens: r.cache_write_tokens,
    costUsd: r.cost_usd,
    filesTouchedCount: r.files_touched_count,
    pinned: !!r.pinned,
    customName: r.custom_name ?? null,
    note: r.note ?? null,
    // Newline-joined by the query because a tag may contain a space; the
    // separator is the one character normalizeTag can never leave in.
    tags: r.tags ? String(r.tags).split('\n') : [],
    // CC's user-set custom-title outranks its generated ai-title.
    aiTitle: r.cc_title ?? r.ai_title ?? null,
    // NULL root_uuid never matches the subquery — 0 reads as standalone.
    chainLen: r.chain_len > 0 ? r.chain_len : 1,
    tool: r.tool ?? 'claude-code',
  };
}

const SORTABLE: Record<string, string> = {
  started_at: 'started_at',
  ended_at: 'ended_at',
  cost_usd: 'cost_usd',
  event_count: 'event_count',
  // The old spelling still resolves: it was in URLs and saved UI state, and
  // an unknown key silently falls back to started_at — so dropping it would
  // reorder someone's list without saying why.
  turn_count: 'event_count',
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
  /** Case-insensitive name filter: custom name, CC title, or project. */
  name?: string;
  /** Only sessions carrying this tag (canonical form, like the tag: operator). */
  tag?: string;
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
  if (q.tag) {
    const tag = normalizeTag(q.tag);
    if (tag !== null) {
      clauses.push('EXISTS (SELECT 1 FROM session_tags st WHERE st.session_id = sessions.id AND st.tag = ?)');
      params.push(tag);
    }
  }
  if (q.since) {
    clauses.push('started_at >= ?');
    params.push(q.since);
  }
  if (q.until) {
    clauses.push('started_at < ?');
    params.push(q.until);
  }
  if (q.name && q.name.trim() !== '') {
    // The sidebar's quick filter — matches everything a row can display as
    // its name, so what you see is what it filters.
    const like = `%${q.name.trim()}%`;
    clauses.push(
      `(custom_name LIKE ? OR cc_title LIKE ? OR ai_title LIKE ?
        OR project_path LIKE ? OR project_key LIKE ?)`,
    );
    params.push(like, like, like, like, like);
  }
  if (q.hideEmpty) {
    // Empty = reads zero on either axis (no prompts, or no usage at all —
    // e.g. prompt-only files with no assistant response). Recorded cost keeps
    // a session visible: legacy CC logged per-message costUSD without tokens.
    // Pinning something is a statement that it matters — pins never hide.
    clauses.push(
      `NOT ((event_count = 0 OR input_tokens + output_tokens = 0)
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

/* ── the now panel (sessions running this minute) ────────────────────── */

/**
 * How recently a session must have been written to to count as running. The
 * sidebar's live dot uses the same five minutes — one definition of "active",
 * not two that can disagree on screen.
 */
export const LIVE_WITHIN_MINUTES = 5;

/**
 * Sessions written to in the last few minutes, most recent first.
 *
 * Deliberately built from the same columns every adapter fills, so the panel
 * reads identically whoever is running: the only agent-specific field is
 * `contextTokens`, and it is null rather than wrong where an agent does not
 * report window fill.
 */
export function getLiveSessions(
  db: Database.Database,
  opts: { withinMinutes?: number; limit?: number } = {},
): LiveResponse {
  const withinMinutes = opts.withinMinutes ?? LIVE_WITHIN_MINUTES;
  const limit = Math.min(Math.max(opts.limit ?? 8, 1), 50);
  const cutoff = new Date(Date.now() - withinMinutes * 60_000).toISOString();

  // Parents only: a subagent transcript is the same work as the session that
  // spawned it, and listing both would double-count one agent's activity.
  const rows = db
    .prepare(
      `SELECT id, tool, project_key, project_path, started_at, ended_at,
              event_count, cost_usd, ai_title, cc_title, custom_name
         FROM sessions LEFT JOIN session_meta ON session_meta.session_id = sessions.id
        WHERE parent_session_id IS NULL AND ended_at IS NOT NULL AND ended_at >= ?
        ORDER BY ended_at DESC
        LIMIT ?`,
    )
    .all(cutoff, limit) as {
    id: string;
    tool: string;
    project_key: string | null;
    project_path: string | null;
    started_at: string | null;
    ended_at: string | null;
    event_count: number;
    cost_usd: number | null;
    ai_title: string | null;
    cc_title: string | null;
    custom_name: string | null;
  }[];

  const lastPromptStmt = db.prepare(
    `SELECT text FROM messages
      WHERE session_id = ? AND kind = 'prompt' AND text <> ''
      ORDER BY idx DESC LIMIT 1`,
  );
  // Only Claude Code rows carry a running window total; see getSessionContext.
  const contextStmt = db.prepare(
    `SELECT tokens_in + cache_read_tokens + cache_write_tokens AS ctx
       FROM messages
      WHERE session_id = ? AND is_sidechain = 0
        AND tokens_in + cache_read_tokens + cache_write_tokens > 0
      ORDER BY idx DESC LIMIT 1`,
  );

  return {
    withinMinutes,
    sessions: rows.map((r) => {
      const prompt = lastPromptStmt.get(r.id) as { text: string } | undefined;
      const reportsWindow = r.tool === 'claude-code';
      const ctx = reportsWindow ? (contextStmt.get(r.id) as { ctx: number } | undefined) : undefined;
      return {
        id: r.id,
        tool: r.tool,
        projectKey: r.project_key,
        projectPath: r.project_path,
        name: r.custom_name ?? r.cc_title ?? r.ai_title ?? '',
        lastActivityAt: r.ended_at,
        eventCount: r.event_count,
        costUsd: r.cost_usd,
        lastPrompt: prompt?.text.replace(/\s+/g, ' ').trim().slice(0, 240) ?? null,
        contextTokens: ctx?.ctx ?? null,
      };
    }),
  };
}

/* ── session tags ────────────────────────────────────────────────────── */

/** Long enough to be a label, short enough to stay a chip. */
export const TAG_MAX = 32;
/** A session with more than this many tags has stopped organising anything. */
export const TAGS_PER_SESSION_MAX = 24;

/**
 * Tags are free-form, so they need exactly one canonical form or the same
 * idea splits across `Refactor`, `refactor ` and `REFACTOR` and the filter
 * silently misses two thirds of it. Lower-cased, inner whitespace collapsed,
 * trimmed, capped. Returns null for anything that normalises to nothing.
 */
export function normalizeTag(raw: string): string | null {
  const tag = raw.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, TAG_MAX).trim();
  return tag === '' ? null : tag;
}

/** A session's tags, alphabetical. Null = unknown session. */
export function listSessionTags(db: Database.Database, sessionId: string): string[] | null {
  const exists = db.prepare(`SELECT id FROM sessions WHERE id = ?`).get(sessionId);
  if (!exists) return null;
  const rows = db
    .prepare(`SELECT tag FROM session_tags WHERE session_id = ? ORDER BY tag`)
    .all(sessionId) as { tag: string }[];
  return rows.map((r) => r.tag);
}

/**
 * Replace a session's tags wholesale — the UI edits a set, not a diff, and a
 * whole-set write means a dropped request can't leave half an edit applied.
 * Returns the stored set, or null for an unknown session.
 */
export function setSessionTags(
  db: Database.Database,
  sessionId: string,
  tags: string[],
): string[] | null {
  const exists = db.prepare(`SELECT id FROM sessions WHERE id = ?`).get(sessionId);
  if (!exists) return null;

  const seen = new Set<string>();
  for (const raw of tags) {
    const tag = normalizeTag(raw);
    if (tag !== null) seen.add(tag);
    if (seen.size >= TAGS_PER_SESSION_MAX) break;
  }
  const now = new Date().toISOString();
  const del = db.prepare(`DELETE FROM session_tags WHERE session_id = ?`);
  const ins = db.prepare(
    `INSERT OR IGNORE INTO session_tags (session_id, tag, created_at) VALUES (?, ?, ?)`,
  );
  db.transaction(() => {
    del.run(sessionId);
    for (const tag of seen) ins.run(sessionId, tag, now);
  })();
  return [...seen].sort();
}

/**
 * Every tag in use with how many sessions carry it — the sidebar's filter
 * list and the replay editor's suggestions. Ordered by use so the labels that
 * organise the most work come first.
 */
export function listAllTags(db: Database.Database): { tag: string; count: number }[] {
  return db
    .prepare(
      `SELECT tag, COUNT(*) AS count FROM session_tags
       GROUP BY tag ORDER BY count DESC, tag`,
    )
    .all() as { tag: string; count: number }[];
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

/** Captions for one session's bookmarks, keyed by idx — only the ones set. */
export function listBookmarkCaptions(
  db: Database.Database,
  sessionId: string,
): Record<number, string> {
  const rows = db
    .prepare(
      `SELECT idx, caption FROM message_bookmarks
        WHERE session_id = ? AND caption IS NOT NULL`,
    )
    .all(sessionId) as { idx: number; caption: string }[];
  return Object.fromEntries(rows.map((r) => [r.idx, r.caption]));
}

/**
 * Set or clear one bookmark; returns the session's bookmarks after the write.
 * Null = no message at that (session, idx) — never bookmark thin air.
 */
const CAPTION_MAX = 300;

export function setBookmark(
  db: Database.Database,
  sessionId: string,
  idx: number,
  on: boolean,
  /** undefined leaves any existing caption alone; a string sets it, '' clears. */
  caption?: string,
): number[] | null {
  const target = db
    .prepare(`SELECT 1 FROM messages WHERE session_id = ? AND idx = ?`)
    .get(sessionId, idx);
  if (!target) return null;
  if (on) {
    const text =
      caption === undefined ? null : caption.trim().slice(0, CAPTION_MAX) || null;
    db.prepare(
      `INSERT INTO message_bookmarks (session_id, idx, created_at, caption)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (session_id, idx) DO UPDATE SET
         caption = CASE WHEN @keep THEN message_bookmarks.caption ELSE excluded.caption END`,
    ).run(sessionId, idx, new Date().toISOString(), text, {
      keep: caption === undefined ? 1 : 0,
    });
  } else {
    db.prepare(`DELETE FROM message_bookmarks WHERE session_id = ? AND idx = ?`).run(
      sessionId,
      idx,
    );
  }
  return listBookmarks(db, sessionId);
}

/**
 * Every marked moment, newest first — the bookmarks page. Each row carries
 * enough to recognise it without opening the session: the caption if there
 * is one, the message's own text if not, and where it lives.
 */
export function listAllBookmarks(
  db: Database.Database,
  opts: { limit?: number } = {},
): BookmarksListResponse {
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);
  const rows = db
    .prepare(
      `SELECT b.session_id AS sessionId, b.idx AS idx, b.created_at AS createdAt,
              b.caption AS caption,
              substr(m.text, 1, 240) AS text, m.kind AS kind, m.ts AS ts,
              s.tool AS tool, s.project_key AS projectKey, s.project_path AS projectPath,
              s.ai_title AS aiTitle, s.cc_title AS ccTitle, sm.custom_name AS customName
         FROM message_bookmarks b
         JOIN sessions s ON s.id = b.session_id
         LEFT JOIN messages m ON m.session_id = b.session_id AND m.idx = b.idx
         LEFT JOIN session_meta sm ON sm.session_id = b.session_id
        ORDER BY b.created_at DESC, b.session_id, b.idx
        LIMIT ?`,
    )
    .all(limit) as {
    sessionId: string;
    idx: number;
    createdAt: string | null;
    caption: string | null;
    text: string | null;
    kind: string | null;
    ts: string | null;
    tool: string;
    projectKey: string | null;
    projectPath: string | null;
    aiTitle: string | null;
    ccTitle: string | null;
    customName: string | null;
  }[];
  return {
    bookmarks: rows.map((r) => ({
      sessionId: r.sessionId,
      idx: r.idx,
      createdAt: r.createdAt,
      caption: r.caption,
      // A bookmark whose message vanished (a reindex after the log was
      // rewritten) keeps its caption and its jump — never a blank row.
      text: (r.text ?? '').replace(/\s+/g, ' ').trim(),
      kind: r.kind,
      ts: r.ts,
      tool: r.tool,
      projectKey: r.projectKey,
      projectPath: r.projectPath,
      sessionName: r.customName ?? r.aiTitle ?? r.ccTitle ?? null,
    })),
  };
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
      `SELECT ${SESSION_COLUMNS}, sessions.file_path,
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
    sessions: rows.map((r) => ({
      ...rowToSession(r),
      bytes: (r as { bytes: number }).bytes,
      missing: !fs.existsSync(sessionFileOnDisk((r as { file_path: string }).file_path)),
    })),
  };
}

/**
 * The real file behind a session's file_path. Cursor IDE composers are
 * virtual sessions — their path is `<state.vscdb path>#<composerId>` — so
 * existence checks and reveal must look at the DB file, not the full string.
 */
export function sessionFileOnDisk(filePath: string): string {
  const i = filePath.indexOf('#');
  return i === -1 ? filePath : filePath.slice(0, i);
}

/** The on-disk file behind a session — for the reveal-in-file-manager action. */
export function getSessionFilePath(db: Database.Database, id: string): string | null {
  const row = db.prepare(`SELECT file_path FROM sessions WHERE id = ?`).get(id) as
    | { file_path: string }
    | undefined;
  return row ? sessionFileOnDisk(row.file_path) : null;
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

/** The normalized message stream as JSON — for jq and scripts, not humans. */
export function getSessionJsonExport(
  db: Database.Database,
  id: string,
  opts: ExportOptions = {},
  range?: ExportRange,
): string | null {
  const session = getSession(db, id);
  if (!session) return null;
  return sessionToJson(session, exportRows(db, id, range), withExcerpt(opts, range));
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

  // Columns-only scan except mode evidence, which lives in raw JSON (the
  // normalized subtype is not a DB column) — the CASE keeps every other
  // row's raw out of the read. Two signals: mode/permission-mode records
  // (older CC wrote 'plan' there), and the plan_mode_exit attachment that
  // is how current CC marks a planning turn.
  const rows = db
    .prepare(
      `SELECT uuid, parent_uuid, message_id, idx, kind, tool_name, ts,
              is_sidechain, is_error, tokens_out, text,
              CASE WHEN kind = 'mode'
                     OR (kind = 'attachment' AND raw_json LIKE '%plan_mode_exit%')
                   THEN raw_json END AS mode_raw
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
    mode_raw: string | null;
  }>;

  const abandoned = findAbandonedIdxs(rows);

  const turns: TurnSummary[] = [];
  let current: TurnSummary | null = null;
  let preludeCount = 0;
  // Mode records ('mode' / 'permission-mode') mark switches; the value in
  // force when a prompt lands is that turn's mode.
  let currentMode: string | null = null;

  for (const r of rows) {
    // A prompt on an abandoned branch was never actually answered (the user
    // interrupted and retyped) — it must not open a turn or the spine counts
    // conversations that never happened.
    if (abandoned.has(r.idx)) continue;
    if (r.mode_raw !== null) {
      try {
        const o = JSON.parse(r.mode_raw) as {
          mode?: unknown;
          permissionMode?: unknown;
          attachment?: { type?: unknown };
        };
        if (r.kind === 'mode') {
          const v = o.mode ?? o.permissionMode;
          if (typeof v === 'string') currentMode = v;
        } else if (o.attachment?.type === 'plan_mode_exit' && current) {
          // The plan ended inside this turn — this turn was planning.
          current.mode = 'plan';
        }
      } catch {
        /* garbage-stored line — mode stays as it was */
      }
    }
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
        mode: currentMode,
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
  /** path: — sessions whose family touched a matching file (files_touched). */
  path?: string;
  /** tag: — sessions carrying a user tag (exact, since tags are canonical). */
  tag?: string;
  /** agent: — which tool wrote the session (`claude-code`, `codex`, …). */
  agent?: string;
  /** branch: — the git branch a message was written on. */
  branch?: string;
  /** like: — "have I solved this before": session id or unique prefix. */
  like?: string;
  /**
   * Resolved from `like:` at search time, never typed: the chain family to
   * leave out, so a resumed conversation doesn't come back as its own match.
   */
  excludeRoot?: string;
}

export interface ParsedQuery {
  /** The free-text remainder after operators are pulled out. */
  terms: string;
  filters: SearchFilters;
  hasFilters: boolean;
}

const FILTER_OPS = new Set([
  'tool',
  'kind',
  'is',
  'has',
  'project',
  'model',
  'path',
  'tag',
  'agent',
  'branch',
  'like',
  'before',
  'after',
]);
const DATE_RE = /^\d{4}(-\d{2}(-\d{2})?)?$/;
const RELATIVE_DAYS_RE = /^(\d{1,4})d$/i;

/**
 * Date-operator values: ISO prefixes pass through (they compare
 * lexicographically against stored full-ISO timestamps); `7d`, `today` and
 * `yesterday` resolve to ISO at parse time. Null = not a date, keep as text.
 */
function resolveDateValue(value: string): string | null {
  if (DATE_RE.test(value)) return value;
  const days = RELATIVE_DAYS_RE.exec(value);
  if (days) return new Date(Date.now() - Number(days[1]) * 86_400_000).toISOString();
  const startOfToday = () => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  };
  if (value.toLowerCase() === 'today') return startOfToday().toISOString();
  if (value.toLowerCase() === 'yesterday') {
    const d = startOfToday();
    d.setDate(d.getDate() - 1);
    return d.toISOString();
  }
  return null;
}

/**
 * Split a query into tokens, keeping a quoted operator value together.
 *
 * Splitting on whitespace alone cannot express a value that contains one, so
 * `tag:"needs review"` used to parse as `tag:"needs` plus a stray `review"`
 * and silently matched nothing — which mattered the moment tags allowed
 * spaces, and matters for any project or model whose name has one.
 */
function tokenizeQuery(input: string): string[] {
  // op:"quoted value" | "quoted phrase" | bare-run
  const re = /[^\s:"]+:"[^"]*"|"[^"]*"|\S+/g;
  return input.match(re) ?? [];
}

export function parseSearchQuery(input: string): ParsedQuery {
  const terms: string[] = [];
  const filters: SearchFilters = {};
  for (const token of tokenizeQuery(input)) {
    const colon = token.indexOf(':');
    const op = colon > 0 ? token.slice(0, colon).toLowerCase() : null;
    // A quoted value keeps its spaces; the quotes themselves are syntax.
    const rawValue = colon > 0 ? token.slice(colon + 1) : '';
    const value =
      rawValue.length > 1 && rawValue.startsWith('"') && rawValue.endsWith('"')
        ? rawValue.slice(1, -1)
        : rawValue;
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
      case 'agent':
        filters.agent = value.toLowerCase();
        break;
      case 'branch':
        filters.branch = value;
        break;
      case 'like':
        filters.like = value;
        break;
      case 'tag': {
        // Normalised the same way on the way in and the way out, so typing
        // `tag:Refactor` finds what the chip stored as `refactor`.
        const tag = normalizeTag(value);
        if (tag !== null) filters.tag = tag;
        break;
      }
      case 'model':
        filters.model = value;
        break;
      case 'path':
        filters.path = value;
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
      case 'after': {
        const resolved = resolveDateValue(value);
        if (resolved !== null) filters[op] = resolved;
        else terms.push(token);
        break;
      }
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
  if (f.branch !== undefined) {
    clauses.push('m.git_branch = ? COLLATE NOCASE');
    params.push(f.branch);
  }
  // `like:` — the source conversation is not "related" to itself, and a
  // resumed session shares its whole history, so the family goes with it.
  if (f.excludeRoot !== undefined) {
    clauses.push(
      `COALESCE(${sessionAlias}.root_uuid, ${sessionAlias}.id) != ? AND ${sessionAlias}.id != ?`,
    );
    params.push(f.excludeRoot, f.excludeRoot);
  }
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
  if (f.agent !== undefined) {
    // Matched against the stored key AND its short form, so `agent:codex`
    // works as well as the registry's own `codex`, and `agent:claude` finds
    // `claude-code` without the user knowing the column's spelling.
    clauses.push(`(${sessionAlias}.tool = ? OR ${sessionAlias}.tool LIKE ? || '-%')`);
    params.push(f.agent, f.agent);
  }
  if (f.tag !== undefined) {
    clauses.push(
      `EXISTS (SELECT 1 FROM session_tags st WHERE st.session_id = ${annotated} AND st.tag = ?)`,
    );
    params.push(f.tag);
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
  // Family-aware like the annotation operators: a hit in the parent counts
  // when a subagent touched the file, and vice versa.
  if (f.path !== undefined) {
    clauses.push(
      `EXISTS (SELECT 1 FROM files_touched ft
         JOIN sessions fs ON fs.id = ft.session_id
         WHERE COALESCE(fs.parent_session_id, fs.id) = COALESCE(${sessionAlias}.parent_session_id, ${sessionAlias}.id)
           AND ft.path LIKE ?)`,
    );
    params.push(`%${f.path}%`);
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

/**
 * The same job for the trigram index, which matches substrings rather than
 * words. Each token becomes a quoted phrase — FTS5 finds it anywhere inside
 * the text, so `eWebSock` reaches `useWebSocket` — and several tokens AND
 * together. Trailing `*` is meaningless here (every match is already a
 * substring) and is stripped rather than passed through as a literal.
 *
 * Tokens under three characters cannot be served: a trigram index stores
 * three-character sequences, so there is nothing shorter to look up. They are
 * dropped, and a query made only of them returns null — the caller then says
 * so rather than silently searching for something else.
 */
export function toTrigramQuery(input: string): string | null {
  const parts: string[] = [];
  for (const token of input.split(/\s+/).filter(Boolean).slice(0, 16)) {
    const core = token.replace(/\*+$/, '').replace(/"/g, '""');
    if (core.length < DEEP_MIN_CHARS) continue;
    parts.push(`"${core}"`);
  }
  return parts.length > 0 ? parts.join(' ') : null;
}

// Matches resolve to the ROOT session: a hit inside a subagent transcript
// counts as its parent, whose row carries the family's rolled-up totals —
// summing both parent and child rows would double count.
/** Rows offered per dimension — enough to refine, few enough to skim. */
const FACET_LIMIT = 6;

/**
 * Facet the current match set so refining is a click rather than knowing the
 * grammar. Same matched-message set the hits come from, one GROUP BY per
 * dimension.
 *
 * Session-level dimensions (project, agent) count SESSIONS, message-level
 * ones (tool, kind) count MESSAGES — a project with 300 hits in one session
 * is one project, and saying "300" there would read as 300 projects.
 */
function searchFacets(
  db: Database.Database,
  match: string | null,
  filters: SearchFilters,
  fts: FtsTable,
): SearchFacets {
  const f = filterSql(filters, 's');
  const from = match
    ? `FROM ${fts}
       JOIN messages m ON m.rowid = ${fts}.rowid
       JOIN sessions s ON s.id = m.session_id
       WHERE ${fts} MATCH ? ${f.sql}`
    : `FROM messages m
       JOIN sessions s ON s.id = m.session_id
       WHERE 1=1 ${f.sql}`;
  const params = match ? [match, ...f.params] : f.params;

  const facet = (
    expr: string,
    operator: string,
    distinctSessions: boolean,
    label?: (value: string) => string,
  ): SearchFacet[] => {
    const counted = distinctSessions ? 'COUNT(DISTINCT COALESCE(s.parent_session_id, s.id))' : 'COUNT(*)';
    try {
      const rows = db
        .prepare(
          `SELECT ${expr} AS value, ${counted} AS n ${from}
             AND ${expr} IS NOT NULL AND ${expr} <> ''
           GROUP BY value ORDER BY n DESC, value LIMIT ${FACET_LIMIT}`,
        )
        .all(...params) as { value: string; n: number }[];
      return rows.map((r) => ({
        value: r.value,
        count: r.n,
        ...(label ? { label: label(r.value) } : {}),
        operator: `${operator}:${/\s/.test(r.value) ? `"${r.value}"` : r.value}`,
      }));
    } catch {
      // A malformed FTS query is the caller's problem, not a 500 — the hits
      // query reports it; facets just come back empty.
      return [];
    }
  };

  // One value is not a choice, in ANY dimension — a chip that filters
  // nothing away is noise pretending to be a control. This also cleans up
  // after a click: refining by tool:Bash collapses the tools dimension to
  // one value, which then drops instead of re-offering the chip just used.
  const choice = (list: SearchFacet[]): SearchFacet[] => (list.length > 1 ? list : []);
  return {
    tools: choice(facet('m.tool_name', 'tool', false)),
    kinds: choice(facet('m.kind', 'kind', false)),
    // Keys are path-derived; the chip shows the folder, the operator keeps
    // the exact key so the count it promises is the count you get.
    projects: choice(
      facet('s.project_key', 'project', true, (key) => {
        const segs = key.split('-').filter(Boolean);
        return segs.length > 0 ? segs[segs.length - 1]! : key;
      }),
    ),
    agents: choice(facet('s.tool', 'agent', true)),
    // Counted per message, like tools and kinds: a session that crossed
    // branches belongs to each of them, not to whichever it ended on.
    branches: choice(facet('m.git_branch', 'branch', false)),
  };
}

function searchAggregates(
  db: Database.Database,
  match: string | null,
  filters: SearchFilters,
  fts: FtsTable,
): SearchAggregates | null {
  const f = filterSql(filters, 'ms');
  const matched = match
    ? `SELECT DISTINCT COALESCE(ms.parent_session_id, ms.id)
       FROM ${fts}
       JOIN messages m ON m.rowid = ${fts}.rowid
       JOIN sessions ms ON ms.id = m.session_id
       WHERE ${fts} MATCH ? ${f.sql}`
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
                COALESCE(SUM(event_count), 0) AS turns,
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
                s.started_at, s.ended_at, s.model, s.tool, s.branch,
                s.event_count, s.input_tokens, s.output_tokens, s.cache_read_tokens,
                s.cache_write_tokens, s.cost_usd, s.files_touched_count,
                (SELECT COUNT(*) FROM sessions c
                 WHERE c.root_uuid = s.root_uuid AND c.project_key IS s.project_key
                   AND c.parent_session_id IS NULL) AS chain_len`;

/**
 * Shared front half of every search entry point: operators parsed out, the
 * remainder sanitized for FTS. `empty` = nothing searchable at all.
 */
/** The two FTS tables a search can run against. Never user input. */
type FtsTable = 'messages_fts' | 'messages_trigram';

/**
 * Parse once and decide which index answers. Deep search is only used when it
 * is asked for AND built — a request for it on an index without one falls
 * back to word matching rather than failing, so a stale UI toggle degrades
 * instead of erroring.
 */
/**
 * How many of a session's own words to OR together. Enough that a session
 * about two things still matches on either; few enough that the tail of
 * merely-uncommon words doesn't drag in everything.
 */
const LIKE_TERMS = 12;
/** Words in more than this share of all messages are the index's own filler. */
const LIKE_MAX_DOC_SHARE = 0.1;

/**
 * The words that make a session *this* session — its prompts' vocabulary,
 * ranked by how rare each word is across the whole index.
 *
 * Rarity does the work a stopword list would: "the" is in nearly every
 * message and sorts last on its own, so there is no English-specific list to
 * maintain and nothing to get wrong in another language. Plain SQLite
 * throughout — the promise holds, no model is involved.
 *
 * Words appearing in only ONE message are dropped, not kept: they are the
 * most distinctive words there are, and they can only match the session we
 * are about to exclude.
 */
export function distinctiveTerms(db: Database.Database, sessionId: string): string[] {
  const prompts = db
    .prepare(
      `SELECT text FROM messages
       WHERE session_id = ? AND kind = 'prompt' AND text != ''
       ORDER BY idx LIMIT 50`,
    )
    .all(sessionId) as { text: string }[];
  if (prompts.length === 0) return [];

  // The FTS tokenizer's alphabet: unicode61 plus the tokenchars the schema
  // adds, so a candidate here is a term the index can actually be asked for.
  const candidates = new Set<string>();
  for (const p of prompts) {
    for (const raw of p.text.toLowerCase().split(/[^\p{L}\p{N}_$.]+/u)) {
      const t = raw.replace(/^[.$]+|[.$]+$/g, '');
      if (t.length >= 3 && t.length <= 40 && !/^\d+$/.test(t)) candidates.add(t);
    }
  }
  if (candidates.size === 0) return [];

  const total = (db.prepare(`SELECT count(*) AS n FROM messages`).get() as { n: number }).n;
  const ceiling = Math.max(2, Math.floor(total * LIKE_MAX_DOC_SHARE));
  const list = [...candidates].slice(0, 400);
  const rows = db
    .prepare(
      `SELECT term, doc FROM messages_vocab
       WHERE term IN (${list.map(() => '?').join(',')}) AND doc > 1 AND doc <= ?`,
    )
    .all(...list, ceiling) as { term: string; doc: number }[];

  return rows
    .sort((a, b) => a.doc - b.doc || a.term.localeCompare(b.term))
    .slice(0, LIKE_TERMS)
    .map((r) => r.term);
}

/**
 * Turn `like:<id>` into an FTS match plus the exclusion that keeps the
 * session (and the rest of its resume chain) out of its own results.
 * Returns null when the session is unknown or has nothing distinctive to say.
 */
function resolveLike(
  db: Database.Database,
  idOrPrefix: string,
): { match: string; excludeRoot: string } | null {
  const id = resolveSessionId(db, idOrPrefix);
  if (id === null) return null;
  const terms = distinctiveTerms(db, id);
  if (terms.length === 0) return null;
  const row = db.prepare(`SELECT root_uuid FROM sessions WHERE id = ?`).get(id) as
    | { root_uuid: string | null }
    | undefined;
  return {
    match: `(${terms.map((t) => `"${t.replace(/"/g, '""')}"`).join(' OR ')})`,
    // No root_uuid (a session of pure bookkeeping) — fall back to the id, so
    // the exclusion still excludes something rather than silently nothing.
    excludeRoot: row?.root_uuid ?? id,
  };
}

function parseForSearch(
  query: string,
  db?: Database.Database,
  deep?: boolean,
): {
  parsed: ParsedQuery;
  match: string | null;
  empty: boolean;
  fts: FtsTable;
} {
  const parsed = parseSearchQuery(query);
  // `like:` reads the word index to build its terms, so it always runs against
  // messages_fts — a trigram index has no notion of a word to be rare.
  const useDeep = deep === true && db !== undefined && hasDeepIndex(db) && parsed.filters.like === undefined;
  const fts: FtsTable = useDeep ? 'messages_trigram' : 'messages_fts';
  let match =
    parsed.terms !== ''
      ? useDeep
        ? toTrigramQuery(parsed.terms)
        : toFtsQuery(parsed.terms)
      : null;

  if (parsed.filters.like !== undefined && db !== undefined) {
    const like = resolveLike(db, parsed.filters.like);
    if (like === null) {
      // An unknown id or a session with nothing to match on returns nothing,
      // rather than quietly widening to every session in the index.
      return { parsed, match: null, empty: true, fts };
    }
    // Typed text still narrows: "the other times this came up, about auth".
    match = match === null ? like.match : `${like.match} AND (${match})`;
    parsed.filters.excludeRoot = like.excludeRoot;
  }

  return { parsed, match, empty: match === null && !parsed.hasFilters, fts };
}

export function searchMessages(
  db: Database.Database,
  q: { query: string; limit?: number; sessionId?: string; deep?: boolean },
): SearchResponse {
  const { parsed, match, empty: nothing, fts } = parseForSearch(q.query, db, q.deep);
  const empty: SearchResponse = {
    query: q.query,
    groups: [],
    totalHits: 0,
    aggregates: null,
    facets: null,
  };
  if (nothing) return empty;
  const limit = Math.min(Math.max(q.limit ?? 100, 1), 500);
  const f = filterSql(parsed.filters, 's');

  // Session-scoped find (in-session Cmd-F) orders by position, not rank —
  // prev/next navigation needs document order.
  const sessionWhere = q.sessionId !== undefined ? 'AND m.session_id = ?' : '';

  let rows: any[];
  try {
    if (match !== null) {
      const order = q.sessionId !== undefined ? 'm.idx' : `bm25(${fts})`;
      const params: unknown[] = [SNIPPET_OPEN, SNIPPET_CLOSE, match];
      if (q.sessionId !== undefined) params.push(q.sessionId);
      params.push(...f.params, limit);
      rows = db
        .prepare(
          `SELECT m.uuid, m.session_id, m.idx, m.kind, m.tool_name, m.ts,
                  snippet(${fts}, 0, ?, ?, '…', 12) AS snip,
                  ${SESSION_JOIN_COLUMNS}
           FROM ${fts}
           JOIN messages m ON m.rowid = ${fts}.rowid
           JOIN sessions s ON s.id = m.session_id
           WHERE ${fts} MATCH ? ${sessionWhere} ${f.sql}
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
      q.sessionId === undefined ? searchAggregates(db, match, parsed.filters, fts) : null,
    // Nothing to refine inside one session — the find bar is already scoped.
    facets: q.sessionId === undefined ? searchFacets(db, match, parsed.filters, fts) : null,
  };
}

/**
 * The other times this came up. Nothing here that `like:` in the search box
 * doesn't already do — this is the same query, shaped for a header row, which
 * is why the MCP `search` tool got related sessions without a tool of its own.
 */
export function relatedSessions(
  db: Database.Database,
  id: string,
  limit = 5,
): RelatedResponse {
  const sessionId = resolveSessionId(db, id);
  if (sessionId === null) return { terms: [], sessions: [] };
  const terms = distinctiveTerms(db, sessionId);
  if (terms.length === 0) return { terms: [], sessions: [] };

  // Ask for more hits than sessions wanted: hits cluster, and 5 sessions can
  // hide behind 200 hits in one of them.
  const found = searchMessages(db, { query: `like:${sessionId}`, limit: 400 });

  // A subagent transcript is part of its parent's run, not a session of its
  // own — it is hidden from every list, so it is rolled up here too. Rank
  // order is preserved: the first group to name a parent fixes its place.
  const byRoot = new Map<string, { session: SessionMeta; hits: number; idx: number }>();
  for (const g of found.groups) {
    const rootId = g.session.parentSessionId ?? g.session.id;
    // A child of the source session is the source session's own work.
    if (rootId === sessionId) continue;
    const seen = byRoot.get(rootId);
    if (seen) {
      seen.hits += g.hits.length;
      continue;
    }
    const session = g.session.parentSessionId === null ? g.session : getSession(db, rootId);
    if (!session) continue;
    byRoot.set(rootId, { session, hits: g.hits.length, idx: g.hits[0]?.idx ?? 0 });
  }
  return { terms, sessions: [...byRoot.values()].slice(0, Math.min(Math.max(limit, 1), 20)) };
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
  q: { query: string; deep?: boolean },
): SearchTimelineResponse {
  const { parsed, match, empty: nothing, fts } = parseForSearch(q.query, db, q.deep);
  const empty: SearchTimelineResponse = { query: q.query, sessions: [] };
  if (nothing) return empty;
  const f = filterSql(parsed.filters, 'ms');

  // Hits resolve to the ROOT session (same rule as aggregates); the first-hit
  // idx only counts hits in the root itself — an idx inside a subagent
  // transcript is meaningless as a jump target in the parent's replay.
  const hitsFrom =
    match !== null
      ? `FROM ${fts}
         JOIN messages m ON m.rowid = ${fts}.rowid
         JOIN sessions ms ON ms.id = m.session_id
         WHERE ${fts} MATCH ? ${f.sql}`
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
  const exists = db.prepare(`SELECT id, tool FROM sessions WHERE id = ?`).get(sessionId) as
    | { id: string; tool: string | null }
    | undefined;
  if (!exists) return null;
  // Codex rows carry per-response DELTAS, not window fill — a curve of them
  // would be confidently wrong. Empty means the strip simply doesn't render.
  if (exists.tool !== null && exists.tool !== 'claude-code') {
    return { sessionId, points: [], compactions: [] };
  }
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

/**
 * Three examples, seeded once into an empty index.
 *
 * The operator grammar is the most powerful thing in Turnlog and the least
 * discoverable — a cheat line teaches it worse than three working examples
 * sitting where saved searches already appear. Chosen to show three different
 * ideas rather than three spellings of one: a state filter, an annotation
 * filter, and a kind filter with a relative date.
 *
 * They are ordinary saved searches, so deleting them is permanent — the seed
 * is pref-flagged and never runs twice, or a deleted example would come back
 * on the next launch, which is the single most annoying thing a starter item
 * can do.
 */
const STARTER_SEARCHES: { name: string; query: string }[] = [
  { name: 'recent failures', query: 'is:error after:7d' },
  { name: 'moments I marked', query: 'has:bookmark' },
  { name: 'what I asked today', query: 'kind:prompt after:today' },
];

/** Pref key recording that the seed has run, so it runs exactly once. */
const SEEDED_KEY = 'starterSearchesSeeded';

/**
 * Seed the examples if this index has never had a saved search and has never
 * been seeded. Returns how many were written — zero on every later launch.
 */
export function seedStarterSearches(db: Database.Database): number {
  const seeded = db.prepare(`SELECT value FROM ui_prefs WHERE key = ?`).get(SEEDED_KEY);
  if (seeded !== undefined) return 0;
  const existing = db.prepare(`SELECT COUNT(*) AS n FROM saved_searches`).get() as { n: number };

  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO saved_searches (name, query, created_at) VALUES (?, ?, ?)`,
  );
  const markSeeded = db.prepare(
    `INSERT OR REPLACE INTO ui_prefs (key, value) VALUES (?, ?)`,
  );
  return db.transaction(() => {
    // Someone with their own saved searches does not need examples; mark it
    // seeded anyway so this check stops running.
    if (existing.n > 0) {
      markSeeded.run(SEEDED_KEY, JSON.stringify(true));
      return 0;
    }
    for (const s of STARTER_SEARCHES) insert.run(s.name, s.query, now);
    markSeeded.run(SEEDED_KEY, JSON.stringify(true));
    return STARTER_SEARCHES.length;
  })();
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

/**
 * Files matching a path fragment, most recently touched first. `find` is the
 * path: operator's reverse: keep only files touched by sessions matching a
 * search query — "which files did the rate-limit work touch".
 */
export function searchFiles(
  db: Database.Database,
  q: { query?: string; limit?: number; find?: string; deep?: boolean },
): FileSummary[] {
  const limit = Math.min(Math.max(q.limit ?? 100, 1), 500);
  const like = q.query ? `%${q.query}%` : '%';

  let findSql = '';
  const findParams: unknown[] = [];
  if (q.find && q.find.trim() !== '') {
    const { parsed, match, empty, fts } = parseForSearch(q.find, db, q.deep);
    if (!empty) {
      const f = filterSql(parsed.filters, 'ms');
      const matched =
        match !== null
          ? `SELECT DISTINCT COALESCE(ms.parent_session_id, ms.id)
             FROM ${fts}
             JOIN messages m ON m.rowid = ${fts}.rowid
             JOIN sessions ms ON ms.id = m.session_id
             WHERE ${fts} MATCH ? ${f.sql}`
          : `SELECT DISTINCT COALESCE(ms.parent_session_id, ms.id)
             FROM messages m
             JOIN sessions ms ON ms.id = m.session_id
             WHERE 1=1 ${f.sql}`;
      findSql = `AND COALESCE(s.parent_session_id, s.id) IN (${matched})`;
      if (match !== null) findParams.push(match);
      findParams.push(...f.params);
    }
  }

  try {
    const rows = db
      .prepare(
        `SELECT ft.path AS path,
                COUNT(DISTINCT COALESCE(s.parent_session_id, s.id)) AS n,
                MAX(COALESCE(s.ended_at, s.started_at)) AS last
         FROM files_touched ft
         JOIN sessions s ON s.id = ft.session_id
         WHERE ft.path LIKE ? ${findSql}
         GROUP BY ft.path
         ORDER BY last DESC
         LIMIT ?`,
      )
      .all(like, ...findParams, limit) as { path: string; n: number; last: string | null }[];
    return rows.map((r) => ({ path: r.path, sessions: r.n, lastTouched: r.last }));
  } catch {
    return []; // MATCH errors must never 500 — same posture as search
  }
}

/** True when a path was ever touched by any session — the open-in-editor
 *  route only launches on paths the index actually knows. */
export function isTouchedFile(db: Database.Database, filePath: string): boolean {
  return (
    db.prepare(`SELECT 1 FROM files_touched WHERE path = ? LIMIT 1`).get(filePath) !== undefined
  );
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

/**
 * Message rows that are resume duplicates, as a subquery.
 *
 * Chain-aware money: resuming a session copies its whole history into the new
 * file — same message uuids under a new session id — so summing session
 * aggregates bills a 3-part chain's shared prefix 3×. Within each multi-part
 * family (root_uuid + project), every message uuid's first occurrence
 * (earliest part) keeps its usage and the rest drop. Chains are rare, so
 * ranking only family messages is cheap; it spans ALL sessions, not just a
 * window — a prefix owned by a part outside the window stays outside it.
 *
 * One definition on purpose: spend and the project page must agree on what a
 * duplicate is, or the same repo shows two different totals on two screens.
 */
const DUP_ROWIDS_SQL = `
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

/**
 * One repo, every agent — the page behind a project name. Exact key match,
 * never the `project:` operator's LIKE: a page about `-Users-me-app` must not
 * quietly fold in `-Users-me-app-v2`.
 *
 * Totals count messages, not session aggregates, so a family's subagent
 * transcripts contribute once and resume copies not at all.
 */
export function getProject(db: Database.Database, projectKey: string): ProjectDetail | null {
  const head = db
    .prepare(
      `SELECT MAX(project_path) AS project_path, COUNT(*) AS n,
              MIN(started_at) AS first_at, MAX(COALESCE(ended_at, started_at)) AS last_at
         FROM sessions
        WHERE project_key = ? AND parent_session_id IS NULL`,
    )
    .get(projectKey) as {
    project_path: string | null;
    n: number;
    first_at: string | null;
    last_at: string | null;
  };
  if (head.n === 0) return null;

  const agents = db
    .prepare(
      `SELECT tool, COUNT(*) AS n FROM sessions
        WHERE project_key = ? AND parent_session_id IS NULL
        GROUP BY tool ORDER BY n DESC`,
    )
    .all(projectKey) as { tool: string; n: number }[];

  const totals = db
    .prepare(
      `SELECT COALESCE(SUM(m.cost_usd), 0) AS cost,
              COALESCE(SUM(m.tokens_in), 0) AS tin,
              COALESCE(SUM(m.tokens_out), 0) AS tout,
              COALESCE(SUM(m.cache_read_tokens), 0) AS cr,
              COUNT(*) AS events
         FROM messages m
         JOIN sessions s ON s.id = m.session_id
        WHERE s.project_key = ? AND m.rowid NOT IN (${DUP_ROWIDS_SQL})`,
    )
    .get(projectKey) as {
    cost: number;
    tin: number;
    tout: number;
    cr: number;
    events: number;
  };

  const topFiles = db
    .prepare(
      `SELECT ft.path AS path,
              COUNT(DISTINCT COALESCE(s.parent_session_id, s.id)) AS n,
              MAX(COALESCE(s.ended_at, s.started_at)) AS last
         FROM files_touched ft
         JOIN sessions s ON s.id = ft.session_id
        WHERE s.project_key = ?
        GROUP BY ft.path
        ORDER BY n DESC, last DESC
        LIMIT 12`,
    )
    .all(projectKey) as { path: string; n: number; last: string | null }[];

  const tags = db
    .prepare(
      `SELECT st.tag AS tag, COUNT(*) AS n
         FROM session_tags st
         JOIN sessions s ON s.id = st.session_id
        WHERE s.project_key = ?
        GROUP BY st.tag ORDER BY n DESC, st.tag LIMIT 20`,
    )
    .all(projectKey) as { tag: string; n: number }[];

  return {
    projectKey,
    projectPath: head.project_path,
    pathExists:
      head.project_path === null || head.project_path === ''
        ? null
        : fs.existsSync(head.project_path),
    sessionCount: head.n,
    firstAt: head.first_at,
    lastAt: head.last_at,
    eventCount: totals.events,
    costUsd: totals.cost,
    inputTokens: totals.tin,
    outputTokens: totals.tout,
    cacheReadTokens: totals.cr,
    agents: agents.map((a) => ({ tool: a.tool, sessions: a.n })),
    topFiles: topFiles.map((f) => ({ path: f.path, sessions: f.n, lastTouched: f.last })),
    tags: tags.map((t) => ({ tag: t.tag, count: t.n })),
  };
}

/**
 * Reduce one error message to a signature — what makes two failures "the
 * same failure". Everything that varies per occurrence is replaced by a
 * placeholder; what is left is the shape of the problem.
 *
 * Deliberately mechanical (no LLM, no fuzzy clustering): a rule you can read
 * is one you can trust, and the local promise forbids the alternative. Over-
 * merging is the failure mode to avoid, so only unmistakably-variable things
 * are replaced — paths, ids, numbers, quoted payloads.
 */
export function errorSignature(text: string): string {
  return (
    text
      // Agents wrap tool failures; the wrapper is noise, the message is not.
      .replace(/<\/?tool_use_error>/g, ' ')
      // A quoted payload is the input that failed, not the failure.
      .replace(/"[^"]{8,}"/g, '"…"')
      .replace(/'[^']{8,}'/g, "'…'")
      // Absolute paths (POSIX and Windows) — same error, different file.
      .replace(/(?:[A-Za-z]:)?[/\\][\w.\-/\\ ]{3,}/g, '<path>')
      // URLs before ids, so a URL does not decay into <id> soup.
      .replace(/\bhttps?:\/\/\S+/g, '<url>')
      .replace(/\b[0-9a-f]{8}-[0-9a-f-]{20,}\b/gi, '<id>')
      .replace(/\b[0-9a-f]{7,}\b/gi, '<id>')
      // No word boundaries: "10m 0s" and "3m 42s" are the same timeout, and
      // \b never fires between a digit and a letter.
      .replace(/\d+(?:\.\d+)*/g, '<n>')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^(.{24,}?[.!?])\s+\S.*$/, '$1') // keep the first sentence…
      .slice(0, 160) // …or, when there isn't one, a bounded prefix
  );
}

/**
 * Recurring failures across a match set: "this exact error happened in 14
 * sessions across 3 projects". Search-derived stats in the blessed sense —
 * aggregates attached to results, not a dashboard: it answers a question
 * about the errors you are already looking at.
 */
export function getErrorSignatures(
  db: Database.Database,
  q: { query?: string; limit?: number; deep?: boolean },
): ErrorSignaturesResponse {
  const limit = Math.min(Math.max(q.limit ?? 12, 1), 50);
  const parsed = parseForSearch(q.query ?? '', db, q.deep);
  const filter = filterSql(parsed.parsed.filters, 's');

  const rows = (() => {
    try {
      return db
        .prepare(
          parsed.match !== null
            ? `SELECT m.text AS text, m.idx AS idx, m.ts AS ts,
                      COALESCE(s.parent_session_id, s.id) AS root, s.project_key AS pk
                 FROM ${parsed.fts}
                 JOIN messages m ON m.rowid = ${parsed.fts}.rowid
                 JOIN sessions s ON s.id = m.session_id
                WHERE ${parsed.fts} MATCH ? AND m.is_error = 1 AND m.text != '' ${filter.sql}
                LIMIT 20000`
            : `SELECT m.text AS text, m.idx AS idx, m.ts AS ts,
                      COALESCE(s.parent_session_id, s.id) AS root, s.project_key AS pk
                 FROM messages m
                 JOIN sessions s ON s.id = m.session_id
                WHERE m.is_error = 1 AND m.text != '' ${filter.sql}
                LIMIT 20000`,
        )
        .all(
          ...(parsed.match !== null ? [parsed.match, ...filter.params] : filter.params),
        ) as { text: string; idx: number; ts: string | null; root: string; pk: string | null }[];
    } catch {
      return []; // MATCH errors must never 500 — same posture as search
    }
  })();

  interface Group {
    signature: string;
    sample: string;
    count: number;
    sessions: Set<string>;
    projects: Set<string>;
    lastAt: string | null;
    where: { sessionId: string; idx: number }[];
  }
  const groups = new Map<string, Group>();
  for (const r of rows) {
    const signature = errorSignature(r.text);
    if (signature === '') continue;
    let g = groups.get(signature);
    if (!g) {
      g = {
        signature,
        sample: r.text.replace(/\s+/g, ' ').trim().slice(0, 300),
        count: 0,
        sessions: new Set(),
        projects: new Set(),
        lastAt: null,
        where: [],
      };
      groups.set(signature, g);
    }
    g.count += 1;
    g.sessions.add(r.root);
    if (r.pk !== null) g.projects.add(r.pk);
    if (r.ts !== null && (g.lastAt === null || r.ts > g.lastAt)) g.lastAt = r.ts;
    // A handful of jump targets is enough to act on; the rest is a count.
    if (g.where.length < 8 && !g.where.some((w) => w.sessionId === r.root)) {
      g.where.push({ sessionId: r.root, idx: r.idx });
    }
  }

  // Recurrence is the point: rank by how many sessions hit it, not by raw
  // count — one runaway loop firing 400 times is not 400 problems.
  const out = [...groups.values()]
    .sort((a, b) => b.sessions.size - a.sessions.size || b.count - a.count)
    .slice(0, limit)
    .map((g) => ({
      signature: g.signature,
      sample: g.sample,
      count: g.count,
      sessions: g.sessions.size,
      projects: g.projects.size,
      lastAt: g.lastAt,
      where: g.where,
    }));
  return { signatures: out, totalErrors: rows.length };
}

export function listProjects(db: Database.Database): ProjectInfo[] {
  const rows = db
    .prepare(
      `SELECT project_key, MAX(project_path) AS project_path, COUNT(*) AS n,
              COALESCE(SUM(cost_usd), 0) AS cost,
              MAX(COALESCE(ended_at, started_at)) AS last_at,
              -- Which agents worked here, as a sorted distinct list. GROUP
              -- BY inside GROUP_CONCAT is not available, so dedupe client
              -- side; the cardinality is one row per session and tiny.
              GROUP_CONCAT(tool) AS tools
       FROM sessions WHERE parent_session_id IS NULL
       GROUP BY project_key ORDER BY n DESC`,
    )
    .all();
  return rows.map((r: any) => ({
    projectKey: r.project_key,
    projectPath: r.project_path,
    sessionCount: r.n,
    costUsd: r.cost,
    lastActiveAt: r.last_at ?? null,
    agents: [...new Set(String(r.tools ?? '').split(',').filter(Boolean))].sort(),
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
  // The full query language, not just text: the spend filter fed the raw
  // string to toFtsQuery, so `tool:Bash` or `agent:codex` was searched as the
  // literal phrase instead of narrowing — silently, and only here. Parsed the
  // same way search parses it, minus deep (the word index answers "what did
  // this KIND of work cost" fine, and spend must not require the trigram
  // build).
  const parsedQ = parseForSearch(q.query ?? '');
  const match = parsedQ.match;

  const dupRowids = DUP_ROWIDS_SQL;

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
  // Filters narrow even with no text (`agent:codex` alone is a real spend
  // question); null only when the query says nothing at all.
  const spendFilter = filterSql(parsedQ.parsed.filters, 'ms');
  const matchedSql = match
    ? `SELECT DISTINCT COALESCE(ms.parent_session_id, ms.id)
       FROM messages_fts
       JOIN messages m ON m.rowid = messages_fts.rowid
       JOIN sessions ms ON ms.id = m.session_id
       WHERE messages_fts MATCH ? ${spendFilter.sql}`
    : `SELECT DISTINCT COALESCE(ms.parent_session_id, ms.id)
       FROM messages m
       JOIN sessions ms ON ms.id = m.session_id
       WHERE 1=1 ${spendFilter.sql}`;
  const matchedRoots =
    match !== null || parsedQ.parsed.hasFilters
      ? new Set(
          (db
            .prepare(matchedSql)
            .raw()
            .all(...(match ? [match, ...spendFilter.params] : spendFilter.params)) as [
            string,
          ][]).map((r) => r[0]),
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
  missingFiles: number;
  dbBytes: number;
  deepSearch: boolean;
} {
  const files = db.prepare(`SELECT COUNT(*) AS n FROM sessions`).get() as { n: number };
  // Checked live rather than stored: the file count is small and the watcher
  // only sees unlinks while running — this stays honest across restarts.
  const filePaths = db.prepare(`SELECT file_path FROM sessions`).all() as {
    file_path: string;
  }[];
  const missingFiles = filePaths.filter(
    (f) => !fs.existsSync(sessionFileOnDisk(f.file_path)),
  ).length;
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
    missingFiles,
    dbBytes,
    deepSearch: hasDeepIndex(db),
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
  // sessionFileOnDisk: a Cursor IDE composer lives as long as its vscdb —
  // pruning on the raw '#'-suffixed path would wipe every one of them.
  const gone = rows.filter((r) => !fs.existsSync(sessionFileOnDisk(r.file_path))).map((r) => r.id);
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

/* ── annotation portability (turnlog annotations export|import) ──────── */

/**
 * Everything the user wrote about their sessions, as one JSON document:
 * pins/names/notes, message bookmarks, saved searches. Keyed by session id +
 * idx, which survive reindexes (logs are append-only) — so a dump restores
 * cleanly on another machine indexing the same logs. ui_prefs stay out:
 * they are per-machine UI state, not curation.
 */
export interface AnnotationsDump {
  version: 1;
  exportedAt: string;
  sessionMeta: {
    sessionId: string;
    pinned: boolean;
    customName: string | null;
    note: string | null;
    updatedAt: string | null;
  }[];
  bookmarks: { sessionId: string; idx: number; createdAt: string | null; caption?: string }[];
  savedSearches: { name: string; query: string; createdAt: string | null }[];
  /**
   * Optional so a dump written before tags existed still imports — the
   * importer treats a missing list as an empty one rather than a bad shape.
   */
  tags?: { sessionId: string; tag: string; createdAt: string | null }[];
}

export function exportAnnotations(db: Database.Database): AnnotationsDump {
  const meta = db
    .prepare(`SELECT session_id, pinned, custom_name, note, updated_at FROM session_meta`)
    .all() as { session_id: string; pinned: number; custom_name: string | null; note: string | null; updated_at: string | null }[];
  const bookmarks = db
    .prepare(`SELECT session_id, idx, created_at, caption FROM message_bookmarks`)
    .all() as { session_id: string; idx: number; created_at: string | null; caption: string | null }[];
  const saved = db
    .prepare(`SELECT name, query, created_at FROM saved_searches`)
    .all() as { name: string; query: string; created_at: string | null }[];
  const tags = db
    .prepare(`SELECT session_id, tag, created_at FROM session_tags ORDER BY session_id, tag`)
    .all() as { session_id: string; tag: string; created_at: string | null }[];
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    sessionMeta: meta.map((m) => ({
      sessionId: m.session_id,
      pinned: m.pinned === 1,
      customName: m.custom_name,
      note: m.note,
      updatedAt: m.updated_at,
    })),
    bookmarks: bookmarks.map((b) => ({
      sessionId: b.session_id,
      idx: b.idx,
      createdAt: b.created_at,
      // Optional on purpose: a pre-caption export must still import.
      ...(b.caption === null ? {} : { caption: b.caption }),
    })),
    savedSearches: saved.map((sv) => ({
      name: sv.name,
      query: sv.query,
      createdAt: sv.created_at,
    })),
    tags: tags.map((t) => ({
      sessionId: t.session_id,
      tag: t.tag,
      createdAt: t.created_at,
    })),
  };
}

/**
 * Merge a dump back in. session_meta upserts (the dump wins), bookmarks are
 * additive, saved searches dedupe on (name, query) so re-importing never
 * doubles them. Throws on a shape that is not an annotations dump.
 */
export function importAnnotations(
  db: Database.Database,
  data: unknown,
): { sessionMeta: number; bookmarks: number; savedSearches: number; tags: number } {
  const d = data as Partial<AnnotationsDump> | null;
  if (
    d === null ||
    typeof d !== 'object' ||
    d.version !== 1 ||
    !Array.isArray(d.sessionMeta) ||
    !Array.isArray(d.bookmarks) ||
    !Array.isArray(d.savedSearches)
  ) {
    throw new Error('not a turnlog annotations export (expected {version: 1, …})');
  }
  const counts = { sessionMeta: 0, bookmarks: 0, savedSearches: 0, tags: 0 };
  const upsertMeta = db.prepare(
    `INSERT OR REPLACE INTO session_meta (session_id, pinned, custom_name, note, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  // Upsert so the file's caption wins on conflict (the same rule pins,
  // names and notes follow) — but `changes` then counts an unchanged
  // re-import as work, and importing twice must report nothing new. So
  // newness is asked separately and drives the count.
  const bookmarkExists = db.prepare(
    `SELECT 1 FROM message_bookmarks WHERE session_id = ? AND idx = ? LIMIT 1`,
  );
  const insertBookmark = db.prepare(
    `INSERT INTO message_bookmarks (session_id, idx, created_at, caption)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (session_id, idx) DO UPDATE SET
       caption = COALESCE(excluded.caption, message_bookmarks.caption)`,
  );
  const savedExists = db.prepare(
    `SELECT 1 FROM saved_searches WHERE name = ? AND query = ? LIMIT 1`,
  );
  const insertSaved = db.prepare(
    `INSERT INTO saved_searches (name, query, created_at) VALUES (?, ?, ?)`,
  );
  const insertTag = db.prepare(
    `INSERT OR IGNORE INTO session_tags (session_id, tag, created_at) VALUES (?, ?, ?)`,
  );
  const tx = db.transaction(() => {
    for (const m of d.sessionMeta!) {
      if (typeof m?.sessionId !== 'string') continue;
      upsertMeta.run(
        m.sessionId,
        m.pinned ? 1 : 0,
        typeof m.customName === 'string' ? m.customName : null,
        typeof m.note === 'string' ? m.note : null,
        typeof m.updatedAt === 'string' ? m.updatedAt : null,
      );
      counts.sessionMeta++;
    }
    for (const b of d.bookmarks!) {
      if (typeof b?.sessionId !== 'string' || !Number.isInteger(b.idx)) continue;
      const isNew = bookmarkExists.get(b.sessionId, b.idx) === undefined;
      insertBookmark.run(
        b.sessionId,
        b.idx,
        typeof b.createdAt === 'string' ? b.createdAt : null,
        typeof b.caption === 'string' ? b.caption.slice(0, CAPTION_MAX) : null,
      );
      if (isNew) counts.bookmarks += 1;
    }
    for (const sv of d.savedSearches!) {
      if (typeof sv?.name !== 'string' || typeof sv.query !== 'string') continue;
      if (savedExists.get(sv.name, sv.query) !== undefined) continue;
      insertSaved.run(sv.name, sv.query, typeof sv.createdAt === 'string' ? sv.createdAt : null);
      counts.savedSearches++;
    }
    // Additive and re-normalised: a dump hand-edited to `Refactor` merges into
    // the same tag the UI would have written.
    for (const t of d.tags ?? []) {
      if (typeof t?.sessionId !== 'string' || typeof t.tag !== 'string') continue;
      const tag = normalizeTag(t.tag);
      if (tag === null) continue;
      const res = insertTag.run(
        t.sessionId,
        tag,
        typeof t.createdAt === 'string' ? t.createdAt : null,
      );
      counts.tags += res.changes;
    }
  });
  tx();
  return counts;
}

export function getStats(db: Database.Database): StatsResponse {
  const totals = db
    .prepare(
      `SELECT COUNT(*) AS sessions,
              COALESCE(SUM(event_count), 0) AS messages,
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
