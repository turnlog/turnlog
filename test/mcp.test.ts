import { beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { Indexer } from '../src/indexer/indexer.js';
import { handleMcpMessage, PARSE_ERROR } from '../src/mcp/mcp.js';
import { searchFiles } from '../src/server/api.js';
import { CODEX_SESSION, SESSION_A, copyCodexCorpus, copyCorpus, testDb, tmpDir } from './helpers.js';

let db: Database.Database;

beforeAll(async () => {
  db = testDb(tmpDir('turnlog-mcp-'));
  // Both agents: the MCP surface must describe every session the user has
  // indexed, not only the ones written by whoever is asking.
  await new Indexer(db, {
    projectsDir: copyCorpus(),
    codexDir: copyCodexCorpus(),
  }).scanAll();
});

/** Shorthand: make a tools/call request and return the parsed result. */
function call(name: string, args: Record<string, unknown> = {}): any {
  const res = handleMcpMessage(db, {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name, arguments: args },
  }) as any;
  expect(res.error).toBeUndefined();
  return res.result;
}

/** Parse the JSON payload out of a tool result's text content. */
function payload(result: any): any {
  expect(result.content[0].type).toBe('text');
  return JSON.parse(result.content[0].text);
}

describe('protocol handshake', () => {
  it('initialize echoes a supported protocol version', () => {
    const res = handleMcpMessage(db, {
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't' } },
    }) as any;
    expect(res.result.protocolVersion).toBe('2024-11-05');
    expect(res.result.capabilities.tools).toBeDefined();
    expect(res.result.serverInfo.name).toBe('turnlog');
  });

  it('initialize falls back to the latest version on an unknown one', () => {
    const res = handleMcpMessage(db, {
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: { protocolVersion: '1999-01-01' },
    }) as any;
    expect(res.result.protocolVersion).toBe('2025-06-18');
  });

  it('notifications get no response', () => {
    expect(
      handleMcpMessage(db, { jsonrpc: '2.0', method: 'notifications/initialized' }),
    ).toBeNull();
  });

  it('ping pongs; unknown methods and malformed messages error', () => {
    const pong = handleMcpMessage(db, { jsonrpc: '2.0', id: 7, method: 'ping' }) as any;
    expect(pong.result).toEqual({});
    const unknown = handleMcpMessage(db, { jsonrpc: '2.0', id: 8, method: 'nope/nope' }) as any;
    expect(unknown.error.code).toBe(-32601);
    const bad = handleMcpMessage(db, 'not an object') as any;
    expect(bad.error.code).toBe(-32600);
    expect((PARSE_ERROR as any).error.code).toBe(-32700);
  });
});

describe('tools/list', () => {
  it('exposes the six read-only tools with schemas', () => {
    const res = handleMcpMessage(db, { jsonrpc: '2.0', id: 1, method: 'tools/list' }) as any;
    const names = res.result.tools.map((t: any) => t.name);
    expect(names).toEqual([
      'search',
      'list_sessions',
      'get_session',
      'get_messages',
      'get_context',
      'file_history',
    ]);
    for (const tool of res.result.tools) {
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.inputSchema).toHaveProperty('type', 'object');
    }
  });
});

describe('tools/call', () => {
  it('search finds indexed content and points at readable context', () => {
    const data = payload(call('search', { query: 'useWebSocket' }));
    expect(data.totalHits).toBeGreaterThan(0);
    expect(data.sessions[0].sessionId).toBe(SESSION_A);
    expect(data.sessions[0].hits[0]).toHaveProperty('idx');
    expect(data.sessions[0].hits[0].snippet).toContain('«');
  });

  it('search accepts operator-only queries', () => {
    const data = payload(call('search', { query: 'is:error' }));
    expect(data.totalHits).toBeGreaterThan(0);
  });

  it('list_sessions filters by project fragment', () => {
    const all = payload(call('list_sessions', {}));
    expect(all.sessions.length).toBeGreaterThan(0);
    const none = payload(call('list_sessions', { project: 'no-such-project-xyz' }));
    expect(none.sessions).toHaveLength(0);
  });

  it('get_session resolves a unique prefix and returns the turn spine', () => {
    const data = payload(call('get_session', { session: SESSION_A.slice(0, 8) }));
    expect(data.session.id).toBe(SESSION_A);
    expect(data.turns.length).toBeGreaterThan(0);
    expect(data.turns[0]).toHaveProperty('prompt');
    expect(data.turns[0]).toHaveProperty('edits');
  });

  it('get_messages pages a window and rejects unknown lenses as tool errors', () => {
    const data = payload(call('get_messages', { session: SESSION_A, limit: 3 }));
    expect(data.messages.length).toBeLessThanOrEqual(3);
    expect(data.messages[0]).toHaveProperty('text');

    const bad = call('get_messages', { session: SESSION_A, lens: 'bananas' });
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toContain('unknown lens');
  });

  it('file_history returns candidates for fragments and a timeline for exact paths', () => {
    const files = searchFiles(db, {});
    expect(files.length).toBeGreaterThan(0);

    const exact = payload(call('file_history', { path: files[0]!.path }));
    expect(exact.path).toBe(files[0]!.path);
    expect(exact.sessions.length).toBeGreaterThan(0);

    const miss = payload(call('file_history', { path: '/definitely/not/a/file.xyz' }));
    expect(miss.matches).toHaveLength(0);
  });

  it('missing required arguments and unknown tools fail safely', () => {
    const noQuery = call('search', {});
    expect(noQuery.isError).toBe(true);

    const res = handleMcpMessage(db, {
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
      params: { name: 'drop_tables', arguments: {} },
    }) as any;
    expect(res.error.code).toBe(-32602);
  });
});

describe('the MCP surface covers every indexed agent', () => {
  it('says which agent wrote each session', () => {
    const rows = payload(call('list_sessions', { limit: 50 })) as { agent?: string }[];
    const list = Array.isArray(rows) ? rows : ((rows as any).sessions ?? []);
    expect(list.length).toBeGreaterThan(0);
    // Guard the guard: vacuous on a single-agent corpus.
    expect(new Set(list.map((r: any) => r.agent)).size).toBeGreaterThan(1);
    // An agent recalling past work needs to know whether it was its own.
    expect(list.every((r: any) => typeof r.agent === 'string')).toBe(true);
  });

  it('can narrow a search to one agent', () => {
    const res = payload(call('search', { query: 'agent:codex', limit: 5 }));
    const groups = res.groups ?? res.sessions ?? [];
    expect(groups.length).toBeGreaterThan(0);
    const ids = new Set(
      groups.map((g: any) => g.sessionId ?? g.session?.id ?? g.id),
    );
    expect(ids.has(CODEX_SESSION)).toBe(true);
  });

  it('reports a value with a space when quoted, as its description promises', () => {
    const res = payload(call('search', { query: 'tag:"nothing tagged this"', limit: 5 }));
    // The point is that it parses as a FILTER and returns nothing, rather
    // than falling back to a text search for the words.
    expect(res.totalHits ?? 0).toBe(0);
  });
});

describe('get_context', () => {
  it('is on the tool list — the sixth read-only tool', () => {
    const res = handleMcpMessage(db, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    }) as any;
    const names = res.result.tools.map((t: any) => t.name);
    expect(names).toContain('get_context');
    expect(names).toHaveLength(6);
  });

  it('reports the window curve for a session that logs one', () => {
    const res = payload(call('get_context', { sessionId: SESSION_A }));
    expect(res.responses).toBeGreaterThan(0);
    expect(res.peakTokens).toBeGreaterThan(0);
    expect(res.finalTokens).toBeGreaterThan(0);
    expect(typeof res.compacted).toBe('boolean');
  });

  it('says null rather than wrong for an agent with no running total', () => {
    const res = payload(call('get_context', { sessionId: CODEX_SESSION }));
    // Codex logs per-response deltas; a curve built from them would be
    // confidently wrong, so the honest answer is no curve at all.
    expect(res.responses).toBe(0);
    expect(res.peakTokens).toBeNull();
    expect(res.finalTokens).toBeNull();
    expect(res.note).toContain('does not log');
  });

  it('errors on an unknown session', () => {
    const res = handleMcpMessage(db, {
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
      params: { name: 'get_context', arguments: { sessionId: 'nope' } },
    }) as any;
    expect(res.result.isError).toBe(true);
  });
});
