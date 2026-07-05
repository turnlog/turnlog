import type Database from 'better-sqlite3';
import type {
  MessageListResponse,
  MessageRow,
  ProjectInfo,
  SearchResponse,
  SessionListResponse,
  SessionMeta,
  StatsResponse,
  TurnsResponse,
  TurnSummary,
} from './apiTypes.js';
import { LENSES, SNIPPET_CLOSE, SNIPPET_OPEN, type Lens } from './apiTypes.js';

const SESSION_COLUMNS = `
  id, project_path, project_key, started_at, ended_at, model, turn_count,
  input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
  cost_usd, files_touched_count
`;

function rowToSession(r: any): SessionMeta {
  return {
    id: r.id,
    projectPath: r.project_path,
    projectKey: r.project_key,
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
  };
}

const SORTABLE: Record<string, string> = {
  started_at: 'started_at',
  ended_at: 'ended_at',
  cost_usd: 'cost_usd',
  turn_count: 'turn_count',
};

export interface ListSessionsQuery {
  sort?: string;
  dir?: string;
  project?: string;
  limit?: number;
  offset?: number;
}

export function listSessions(db: Database.Database, q: ListSessionsQuery): SessionListResponse {
  const sort = SORTABLE[q.sort ?? ''] ?? 'started_at';
  const dir = q.dir === 'asc' ? 'ASC' : 'DESC';
  const limit = Math.min(Math.max(q.limit ?? 100, 1), 1000);
  const offset = Math.max(q.offset ?? 0, 0);
  const where = q.project ? `WHERE project_key = ?` : '';
  const params: unknown[] = q.project ? [q.project] : [];

  const rows = db
    .prepare(
      `SELECT ${SESSION_COLUMNS} FROM sessions ${where}
       ORDER BY ${sort} ${dir} LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset);
  const total = db
    .prepare(`SELECT COUNT(*) AS n FROM sessions ${where}`)
    .get(...params) as { n: number };

  return { sessions: rows.map(rowToSession), total: total.n };
}

export function getSession(db: Database.Database, id: string): SessionMeta | null {
  const row = db.prepare(`SELECT ${SESSION_COLUMNS} FROM sessions WHERE id = ?`).get(id);
  return row ? rowToSession(row) : null;
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

  const messages: MessageRow[] = rows.map((r: any) => ({
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
  }));

  return { sessionId, messages, total: total.n };
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

export function searchMessages(
  db: Database.Database,
  q: { query: string; limit?: number; sessionId?: string },
): SearchResponse {
  const match = toFtsQuery(q.query);
  const empty: SearchResponse = { query: q.query, groups: [], totalHits: 0 };
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
                s.id, s.project_path, s.project_key, s.started_at, s.ended_at, s.model,
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

  return { query: q.query, groups: [...groups.values()], totalHits: rows.length };
}

export function listProjects(db: Database.Database): ProjectInfo[] {
  const rows = db
    .prepare(
      `SELECT project_key, MAX(project_path) AS project_path, COUNT(*) AS n
       FROM sessions GROUP BY project_key ORDER BY n DESC`,
    )
    .all();
  return rows.map((r: any) => ({
    projectKey: r.project_key,
    projectPath: r.project_path,
    sessionCount: r.n,
  }));
}

export function getStats(db: Database.Database): StatsResponse {
  const totals = db
    .prepare(
      `SELECT COUNT(*) AS sessions,
              COALESCE(SUM(turn_count), 0) AS messages,
              COALESCE(SUM(input_tokens), 0) AS input_tokens,
              COALESCE(SUM(output_tokens), 0) AS output_tokens,
              COALESCE(SUM(cost_usd), 0) AS cost_usd
       FROM sessions`,
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
