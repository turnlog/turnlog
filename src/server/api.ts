import type Database from 'better-sqlite3';
import { pricingForModel, type ModelPricing } from '../cost/pricing.js';
import { sessionToMarkdown, type ExportOptions } from '../export/markdown.js';
import type {
  MessageListResponse,
  MessageRow,
  ProjectInfo,
  SearchAggregates,
  SearchResponse,
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
  cost_usd, files_touched_count,
  COALESCE(session_meta.pinned, 0) AS pinned, custom_name, note
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
      `SELECT uuid, parent_uuid, idx, role, kind, tool_name, tool_use_id, ts, is_sidechain,
              is_error, tokens_in, tokens_out, cost_usd, model, text, raw_json
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
  is_sidechain, is_error, tokens_in, tokens_out, cost_usd, model, text, raw_json`;

function rowToMessage(r: any): MessageRow {
  return {
    uuid: r.uuid,
    parentUuid: r.parent_uuid,
    idx: r.idx,
    role: r.role,
    kind: r.kind,
    toolName: r.tool_name,
    toolUseId: r.tool_use_id,
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

/** Full session as markdown (deep-dive §2.5) — CLI export + copy-as-markdown. */
export function getSessionExport(
  db: Database.Database,
  id: string,
  opts: ExportOptions = {},
): string | null {
  const session = getSession(db, id);
  if (!session) return null;
  const rows = db
    .prepare(`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE session_id = ? ORDER BY idx`)
    .all(id)
    .map(rowToMessage);
  return sessionToMarkdown(session, rows, opts);
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
      `SELECT uuid, idx, kind, tool_name, ts, is_sidechain, is_error, tokens_out, text
       FROM messages WHERE session_id = ? ORDER BY idx`,
    )
    .all(sessionId) as Array<{
    uuid: string;
    idx: number;
    kind: string;
    tool_name: string | null;
    ts: string | null;
    is_sidechain: number;
    is_error: number;
    tokens_out: number;
    text: string;
  }>;

  const turns: TurnSummary[] = [];
  let current: TurnSummary | null = null;
  let preludeCount = 0;

  for (const r of rows) {
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

function searchAggregates(db: Database.Database, match: string): SearchAggregates | null {
  try {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n,
                COALESCE(SUM(cost_usd), 0) AS cost,
                SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END) AS unpriced,
                COALESCE(SUM(turn_count), 0) AS turns,
                COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens
         FROM sessions WHERE id IN (${MATCHED_SESSIONS_SQL})`,
      )
      .get(match) as any;
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

export function searchMessages(
  db: Database.Database,
  q: { query: string; limit?: number; sessionId?: string },
): SearchResponse {
  const match = toFtsQuery(q.query);
  const empty: SearchResponse = { query: q.query, groups: [], totalHits: 0, aggregates: null };
  if (!match) return empty;
  const limit = Math.min(Math.max(q.limit ?? 100, 1), 500);

  // Session-scoped find (in-session Cmd-F) orders by position, not rank —
  // prev/next navigation needs document order.
  const sessionWhere = q.sessionId !== undefined ? 'AND m.session_id = ?' : '';
  const order = q.sessionId !== undefined ? 'm.idx' : 'bm25(messages_fts)';
  const params: unknown[] = [SNIPPET_OPEN, SNIPPET_CLOSE, match];
  if (q.sessionId !== undefined) params.push(q.sessionId);
  params.push(limit);

  let rows: any[];
  try {
    rows = db
      .prepare(
        `SELECT m.uuid, m.session_id, m.idx, m.kind, m.tool_name, m.ts,
                snippet(messages_fts, 0, ?, ?, '…', 12) AS snip,
                s.id, s.project_path, s.project_key, s.parent_session_id,
                s.started_at, s.ended_at, s.model,
                s.turn_count, s.input_tokens, s.output_tokens, s.cache_read_tokens,
                s.cache_write_tokens, s.cost_usd, s.files_touched_count
         FROM messages_fts
         JOIN messages m ON m.rowid = messages_fts.rowid
         JOIN sessions s ON s.id = m.session_id
         WHERE messages_fts MATCH ? ${sessionWhere}
         ORDER BY ${order}
         LIMIT ?`,
      )
      .all(...params);
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
    aggregates: q.sessionId === undefined ? searchAggregates(db, match) : null,
  };
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
 * The spend view (roadmap Phase 2.6): daily rollups and splits over the
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
  const matchSql = match ? `AND id IN (${MATCHED_SESSIONS_SQL.replace('?', '@match')})` : '';
  // Root sessions only: parent rows already carry their subagents' usage.
  const where = `FROM sessions WHERE parent_session_id IS NULL AND started_at >= @cutoff ${matchSql}`;
  const params = match ? { cutoff, match } : { cutoff };

  const run = <T>(sql: string): T[] => db.prepare(sql).all(params) as T[];

  // date(..., 'localtime') buckets by the machine's calendar day — the server
  // always runs on the user's own machine, so its timezone is the right one.
  const days = run<{ date: string; cost: number; tokens: number; n: number }>(
    `SELECT date(started_at, 'localtime') AS date, COALESCE(SUM(cost_usd), 0) AS cost,
            COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens, COUNT(*) AS n
     ${where} GROUP BY date ORDER BY date`,
  );
  // Per-message attribution: sessions mix models (subagents, /model switches),
  // so the split comes from the messages' own model column, not the session's.
  // Placeholder models ('<synthetic>') carry no usage and are excluded.
  const msgMatchSql = match
    ? `AND COALESCE(s.parent_session_id, s.id) IN (${MATCHED_SESSIONS_SQL.replace('?', '@match')})`
    : '';
  const byModel = run<{ key: string; cost: number; tokens: number; n: number; cr: number }>(
    `SELECT m.model AS key, COALESCE(SUM(m.cost_usd), 0) AS cost,
            COALESCE(SUM(m.tokens_in + m.tokens_out), 0) AS tokens,
            COUNT(DISTINCT COALESCE(s.parent_session_id, s.id)) AS n,
            COALESCE(SUM(m.cache_read_tokens), 0) AS cr
     FROM messages m JOIN sessions s ON s.id = m.session_id
     WHERE m.model IS NOT NULL AND m.model NOT LIKE '<%'
       AND s.started_at >= @cutoff ${msgMatchSql}
     GROUP BY m.model ORDER BY cost DESC`,
  );
  const byProject = run<{ key: string | null; cost: number; tokens: number; n: number }>(
    `SELECT project_key AS key, COALESCE(SUM(cost_usd), 0) AS cost,
            COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens, COUNT(*) AS n
     ${where} GROUP BY project_key ORDER BY cost DESC`,
  );
  const totals = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(cost_usd), 0) AS cost,
              SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END) AS unpriced,
              COALESCE(SUM(input_tokens), 0) AS tin, COALESCE(SUM(output_tokens), 0) AS tout,
              COALESCE(SUM(cache_read_tokens), 0) AS cr, COALESCE(SUM(cache_write_tokens), 0) AS cw
       ${where}`,
    )
    .get(params) as any;

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
      unpricedSessions: totals.unpriced ?? 0,
      sessions: totals.n,
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
