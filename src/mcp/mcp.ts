import type Database from 'better-sqlite3';
import {
  getFileHistory,
  getSession,
  isLens,
  listMessages,
  listSessions,
  listTurns,
  resolveSessionId,
  searchFiles,
  searchMessages,
} from '../server/api.js';
import { SNIPPET_CLOSE, SNIPPET_OPEN } from '../server/apiTypes.js';
import type { SessionMeta } from '../server/apiTypes.js';
import { APP_VERSION } from '../version.js';

/**
 * Turnlog as agent memory: a Model Context Protocol server over stdio that
 * exposes the local session index as read-only search tools — so an agent
 * can ask "how did we fix this last month?" against its own history.
 *
 * The protocol layer is hand-rolled on purpose (same reasoning as bare
 * node:http over Fastify): a tools-only MCP server is a small, stable
 * JSON-RPC 2.0 surface — initialize, tools/list, tools/call, ping — and
 * taking the SDK would add the first new runtime dependency chain since
 * better-sqlite3. Newline-delimited JSON on stdin/stdout; nothing here ever
 * touches the network.
 */

const LATEST_PROTOCOL = '2025-06-18';
const SUPPORTED_PROTOCOLS = new Set(['2024-11-05', '2025-03-26', '2025-06-18']);

/* ── argument helpers ───────────────────────────────────────────────── */

function argStr(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

function requireStr(args: Record<string, unknown>, key: string): string {
  const v = argStr(args, key);
  if (v === undefined) throw new Error(`"${key}" is required and must be a non-empty string`);
  return v;
}

function argInt(
  args: Record<string, unknown>,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const v = args[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(Math.max(Math.floor(v), min), max);
}

const TEXT_CAP = 1500;

function capText(text: string): string {
  return text.length > TEXT_CAP ? `${text.slice(0, TEXT_CAP)}… [truncated]` : text;
}

/** Session rows trimmed to what an agent needs to pick and reference one. */
function compactSession(s: SessionMeta) {
  return {
    id: s.id,
    project: s.projectPath ?? s.projectKey,
    name: s.customName ?? undefined,
    note: s.note ?? undefined,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    model: s.model ?? undefined,
    turns: s.turnCount,
    costUsd: s.costUsd ?? undefined,
  };
}

/* ── the tool surface (all read-only) ───────────────────────────────── */

interface McpTool {
  name: string;
  description: string;
  inputSchema: object;
  run(db: Database.Database, args: Record<string, unknown>): unknown;
}

const MAX_TURNS = 300;

const TOOLS: McpTool[] = [
  {
    name: 'search',
    description:
      'Full-text search across every indexed Claude Code session on this machine. ' +
      'Call this when you need to recall how something was done, discussed, or fixed in a past session. ' +
      'Supports operators combinable with text (or usable alone): tool:Bash, kind:prompt, is:error, ' +
      'project:<name>, model:<name>, before:<ISO date prefix>, after:<ISO date prefix>. ' +
      'Returns hits grouped by session; use each hit’s sessionId + idx with get_messages to read the surrounding context.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search terms and/or operators, e.g. "websocket reconnect" or "is:error tool:Bash after:2026-06"' },
        limit: { type: 'number', description: 'Max hits (default 20, max 100)' },
      },
      required: ['query'],
    },
    run(db, args) {
      const query = requireStr(args, 'query');
      const limit = argInt(args, 'limit', 20, 1, 100);
      const res = searchMessages(db, { query, limit });
      return {
        totalHits: res.totalHits,
        aggregates: res.aggregates ?? undefined,
        sessions: res.groups.map((g) => ({
          sessionId: g.session.id,
          project: g.session.projectPath ?? g.session.projectKey,
          name: g.session.customName ?? undefined,
          startedAt: g.session.startedAt,
          hits: g.hits.map((h) => ({
            idx: h.idx,
            kind: h.kind,
            tool: h.toolName ?? undefined,
            ts: h.ts,
            snippet: capText(
              h.snippet.replaceAll(SNIPPET_OPEN, '«').replaceAll(SNIPPET_CLOSE, '»'),
            ),
          })),
        })),
      };
    },
  },
  {
    name: 'list_sessions',
    description:
      'List recent Claude Code sessions, most recently active first. ' +
      'Call this to orient yourself before searching, or to find the latest session for a project. ' +
      'Empty sessions are hidden. The project filter matches a fragment of the project path.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Only sessions whose project path contains this fragment' },
        limit: { type: 'number', description: 'Max sessions (default 20, max 100)' },
      },
    },
    run(db, args) {
      const limit = argInt(args, 'limit', 20, 1, 100);
      const fragment = argStr(args, 'project')?.toLowerCase();
      // Project keys are path-derived; fragment matching happens here so the
      // agent can say "turnlog" instead of the exact key.
      const res = listSessions(db, { sort: 'ended_at', dir: 'desc', limit: 1000, hideEmpty: true });
      const filtered = fragment
        ? res.sessions.filter((s) =>
            (s.projectPath ?? s.projectKey ?? '').toLowerCase().includes(fragment),
          )
        : res.sessions;
      return { total: filtered.length, sessions: filtered.slice(0, limit).map(compactSession) };
    },
  },
  {
    name: 'get_session',
    description:
      'Get one session’s metadata plus its turn spine: every user prompt with mechanical counts of ' +
      'what happened under it (file reads, edits, commands, subagents, errors). ' +
      'Call this after search or list_sessions to understand a session’s structure before reading messages. ' +
      'Accepts a full session id or a unique prefix.',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session id or unique prefix' },
      },
      required: ['session'],
    },
    run(db, args) {
      const idArg = requireStr(args, 'session');
      const id = resolveSessionId(db, idArg);
      if (id === null) throw new Error(`no session matches "${idArg}" (or the prefix is ambiguous)`);
      const session = getSession(db, id);
      const turns = listTurns(db, id);
      if (!session || !turns) throw new Error(`session "${id}" not found`);
      return {
        session: compactSession(session),
        totalTurns: turns.turns.length,
        truncated: turns.turns.length > MAX_TURNS || undefined,
        turns: turns.turns.slice(0, MAX_TURNS).map((t) => ({
          idx: t.idx,
          ts: t.ts,
          prompt: t.command ?? t.text,
          reads: t.reads,
          edits: t.edits,
          commands: t.commands,
          tasks: t.tasks,
          errors: t.errors,
        })),
      };
    },
  },
  {
    name: 'get_messages',
    description:
      'Read a window of messages from one session, in order. ' +
      'Call this to read the context around a search hit: pass the hit’s sessionId and after_idx = hit idx - 1 ' +
      '(or a few earlier for lead-in). Long message bodies are truncated. ' +
      'Optional lens narrows to one dimension: diffs, commands, errors, or prompts.',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session id or unique prefix' },
        after_idx: { type: 'number', description: 'Return messages with idx greater than this (default -1 = from the start)' },
        limit: { type: 'number', description: 'Max messages (default 20, max 100)' },
        lens: { type: 'string', enum: ['diffs', 'commands', 'errors', 'prompts'], description: 'Only messages of one kind' },
      },
      required: ['session'],
    },
    run(db, args) {
      const idArg = requireStr(args, 'session');
      const id = resolveSessionId(db, idArg);
      if (id === null) throw new Error(`no session matches "${idArg}" (or the prefix is ambiguous)`);
      const lensArg = argStr(args, 'lens');
      if (lensArg !== undefined && !isLens(lensArg)) {
        throw new Error(`unknown lens "${lensArg}" — use diffs, commands, errors, or prompts`);
      }
      const afterIdx = argInt(args, 'after_idx', -1, -1, Number.MAX_SAFE_INTEGER);
      const limit = argInt(args, 'limit', 20, 1, 100);
      const res = listMessages(db, id, { afterIdx, limit, lens: lensArg });
      if (!res) throw new Error(`session "${id}" not found`);
      return {
        sessionId: id,
        total: res.total,
        messages: res.messages.map((m) => ({
          idx: m.idx,
          role: m.role ?? undefined,
          kind: m.kind,
          tool: m.toolName ?? undefined,
          ts: m.ts,
          isError: m.isError || undefined,
          text: capText(m.text),
        })),
      };
    },
  },
  {
    name: 'file_history',
    description:
      'Cross-session file history: every session that ever edited or wrote a file, newest first — ' +
      'like blame, but for agent edits, where the why is the surrounding conversation. ' +
      'Call this when you need to know when, why, or by which session a file was changed. ' +
      'Pass an exact path, or a fragment to discover matching files first.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Exact file path, or a fragment of one' },
      },
      required: ['path'],
    },
    run(db, args) {
      const path = requireStr(args, 'path');
      const files = searchFiles(db, { query: path, limit: 10 });
      const exact = files.find((f) => f.path === path) ?? (files.length === 1 ? files[0] : null);
      if (!exact) {
        return files.length === 0
          ? { matches: [], note: 'no touched files match this path' }
          : { matches: files, note: 'several files match — call again with one exact path' };
      }
      const history = getFileHistory(db, exact.path);
      return { path: exact.path, sessions: history.sessions.map(compactSession) };
    },
  },
];

/* ── JSON-RPC plumbing ──────────────────────────────────────────────── */

type RpcId = number | string | null;

function rpcResult(id: RpcId, result: unknown): object {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id: RpcId, code: number, message: string): object {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

export const PARSE_ERROR = rpcError(null, -32700, 'parse error');

/**
 * Handle one decoded JSON-RPC message. Returns the response object to write,
 * or null when none is due (notifications). Never throws — tool failures
 * become isError tool results, protocol failures become JSON-RPC errors.
 */
export function handleMcpMessage(db: Database.Database, msg: unknown): object | null {
  if (typeof msg !== 'object' || msg === null || Array.isArray(msg)) {
    return rpcError(null, -32600, 'invalid request');
  }
  const { id, method, params } = msg as { id?: RpcId; method?: unknown; params?: unknown };
  const hasId = id !== undefined && id !== null;
  if (typeof method !== 'string') {
    return hasId ? rpcError(id!, -32600, 'invalid request: method missing') : null;
  }
  // Notifications (initialized, cancelled, …) expect no response.
  if (!hasId) return null;

  switch (method) {
    case 'initialize': {
      const requested = (params as { protocolVersion?: unknown } | undefined)?.protocolVersion;
      const version =
        typeof requested === 'string' && SUPPORTED_PROTOCOLS.has(requested)
          ? requested
          : LATEST_PROTOCOL;
      return rpcResult(id!, {
        protocolVersion: version,
        capabilities: { tools: {} },
        serverInfo: { name: 'turnlog', version: APP_VERSION },
      });
    }
    case 'ping':
      return rpcResult(id!, {});
    case 'tools/list':
      return rpcResult(id!, {
        tools: TOOLS.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
        })),
      });
    case 'tools/call': {
      const p = (params ?? {}) as { name?: unknown; arguments?: unknown };
      const tool = TOOLS.find((t) => t.name === p.name);
      if (!tool) return rpcError(id!, -32602, `unknown tool: ${String(p.name)}`);
      const args =
        typeof p.arguments === 'object' && p.arguments !== null && !Array.isArray(p.arguments)
          ? (p.arguments as Record<string, unknown>)
          : {};
      try {
        const data = tool.run(db, args);
        return rpcResult(id!, {
          content: [{ type: 'text', text: JSON.stringify(data, null, 1) }],
        });
      } catch (err) {
        return rpcResult(id!, {
          content: [{ type: 'text', text: `error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        });
      }
    }
    default:
      return rpcError(id!, -32601, `method not found: ${method}`);
  }
}
