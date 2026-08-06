import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { extractCursorIdeComposers } from '../src/indexer/cursorIde.js';
import { Indexer, mungeCwd } from '../src/indexer/indexer.js';
import {
  getSession,
  getSessionFilePath,
  listSessions,
  pruneMissingSessions,
  searchMessages,
  sessionFileOnDisk,
} from '../src/server/api.js';
import { testDb, tmpDir } from './helpers.js';

const MODERN = 'aaaa0000-1111-4222-8333-444455556666';
const LEGACY = 'bbbb0000-1111-4222-8333-444455556666';
const DRAFT = 'cccc0000-1111-4222-8333-444455556666';
// Platform-shaped on purpose: a drive-letter-less file:// URL throws in
// fileURLToPath on Windows, which is exactly what real Cursor never writes
// there — the fixture must look like the platform's own workspace.json.
const WS_FOLDER =
  process.platform === 'win32' ? 'C:\\Users\\dev\\projects\\webapp' : '/Users/dev/projects/webapp';

/**
 * Build a synthetic Cursor IDE user dir with the shapes observed on real
 * data: a modern (_v:3) composer with header-referenced bubbles, a tool
 * bubble carrying call+result in toolFormerData, per-model usageData cents;
 * a legacy composer with the conversation inline; and an empty draft pane.
 */
function buildCursorUserDir(): string {
  const userDir = tmpDir('turnlog-cursor-ide-');
  const globalDir = path.join(userDir, 'globalStorage');
  fs.mkdirSync(globalDir, { recursive: true });
  const db = new Database(path.join(globalDir, 'state.vscdb'));
  db.exec(`CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value TEXT)`);
  const put = db.prepare(`INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)`);

  const bubbles: Array<[string, Record<string, unknown>]> = [
    ['b1', { type: 1, text: 'cap the websocket reconnect backoff at 30s' }],
    [
      'b2',
      {
        type: 2,
        text: '',
        toolFormerData: {
          tool: 5,
          name: 'read_file',
          params: JSON.stringify({ relativeWorkspacePath: 'src/hooks/useWebSocket.ts' }),
          rawArgs: '{"relativeWorkspacePath":"src/hooks/useWebSocket.ts"}',
          result: JSON.stringify({ contents: 'const backoff = INITIAL_BACKOFF;' }),
          status: 'completed',
          toolCallId: 'call_cursor_ide_01',
        },
        // Context caches the extractor must strip:
        attachedCodeChunks: [{ big: 'blob' }],
        codebaseContextChunks: [{ big: 'blob' }],
      },
    ],
    [
      'b3',
      {
        type: 2,
        text: '',
        toolFormerData: {
          tool: 7,
          name: 'edit_file',
          params: JSON.stringify({ relativeWorkspacePath: 'src/hooks/useWebSocket.ts' }),
          rawArgs: '{"relativeWorkspacePath":"src/hooks/useWebSocket.ts"}',
          result: JSON.stringify({ applied: true }),
          status: 'completed',
          toolCallId: 'call_cursor_ide_02',
        },
      },
    ],
    [
      'b4',
      {
        type: 2,
        text: 'Backoff now caps at 30 seconds and survives heartbeats.',
        tokenCount: { inputTokens: 41626, outputTokens: 1268 },
      },
    ],
  ];
  for (const [id, bubble] of bubbles) put.run(`bubbleId:${MODERN}:${id}`, JSON.stringify(bubble));
  put.run(
    `composerData:${MODERN}`,
    JSON.stringify({
      _v: 3,
      composerId: MODERN,
      name: 'Cap websocket reconnect backoff',
      createdAt: 1754300000000,
      lastUpdatedAt: 1754303600000,
      unifiedMode: 'agent',
      fullConversationHeadersOnly: bubbles.map(([id]) => ({ bubbleId: id, type: 1 })),
      usageData: { 'gpt-4.1': { costInCents: 16, amount: 4 } },
      richText: 'x'.repeat(500), // stripped by the composer allowlist
    }),
  );
  put.run(
    `composerData:${LEGACY}`,
    JSON.stringify({
      composerId: LEGACY,
      name: 'Legacy inline conversation',
      createdAt: 1737819637986,
      lastUpdatedAt: 1737819737986,
      conversation: [
        { type: 1, bubbleId: 'L1', text: 'write a mobile app based on the docs' },
        { type: 2, bubbleId: 'L2', text: "I'll help you create a React Native app." },
      ],
    }),
  );
  put.run(
    `composerData:${DRAFT}`,
    JSON.stringify({ _v: 3, composerId: DRAFT, createdAt: 1754300000000 }),
  );
  db.close();

  const wsDir = path.join(userDir, 'workspaceStorage', 'deadbeefcafe');
  fs.mkdirSync(wsDir, { recursive: true });
  fs.writeFileSync(
    path.join(wsDir, 'workspace.json'),
    JSON.stringify({ folder: pathToFileURL(WS_FOLDER).href }),
  );
  const ws = new Database(path.join(wsDir, 'state.vscdb'));
  ws.exec(`CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)`);
  ws.prepare(`INSERT INTO ItemTable (key, value) VALUES (?, ?)`).run(
    'composer.composerData',
    JSON.stringify({ allComposers: [{ composerId: MODERN, name: 'Cap websocket reconnect backoff' }] }),
  );
  ws.close();
  return userDir;
}

let userDir: string;

beforeAll(() => {
  userDir = buildCursorUserDir();
});

describe('cursor ide extraction', () => {
  it('extracts both generations; the originals stay byte-identical', () => {
    const globalDb = path.join(userDir, 'globalStorage', 'state.vscdb');
    const before = fs.readFileSync(globalDb);
    const composers = extractCursorIdeComposers(userDir);
    expect(fs.readFileSync(globalDb).equals(before)).toBe(true);
    expect(composers.map((c) => c.composerId).sort()).toEqual([MODERN, LEGACY, DRAFT].sort());
  });

  it('splits toolFormerData bubbles into call + result envelopes', () => {
    const modern = extractCursorIdeComposers(userDir).find((c) => c.composerId === MODERN)!;
    const kinds = modern.envelopes.map((e) => e.t);
    expect(kinds).toEqual([
      'composer',
      'bubble', // prompt
      'bubble', // read_file call
      'bubble_result',
      'bubble', // edit_file call
      'bubble_result',
      'bubble', // final answer
      'usage',
    ]);
  });

  it('resolves the workspace folder onto the composer', () => {
    const modern = extractCursorIdeComposers(userDir).find((c) => c.composerId === MODERN)!;
    expect(modern.cwd).toBe(WS_FOLDER);
  });

  it('strips context caches but keeps conversation fields', () => {
    const modern = extractCursorIdeComposers(userDir).find((c) => c.composerId === MODERN)!;
    const raws = modern.envelopes.map((e) => JSON.stringify(e));
    expect(raws.some((r) => r.includes('attachedCodeChunks'))).toBe(false);
    expect(raws.some((r) => r.includes('INITIAL_BACKOFF'))).toBe(true);
  });
});

describe('cursor ide indexing', () => {
  let db: Database.Database;

  beforeAll(async () => {
    db = testDb(tmpDir('turnlog-cursorideidx-'));
    await new Indexer(db, {
      projectsDir: tmpDir('turnlog-empty-'),
      cursorIdeUserDir: userDir,
    }).scanAll();
  });

  it('indexes composers as sessions: tool, title, project from the workspace', () => {
    const s = getSession(db, MODERN)!;
    expect(s.tool).toBe('cursor');
    expect(s.aiTitle).toBe('Cap websocket reconnect backoff');
    expect(s.projectKey).toBe(mungeCwd(WS_FOLDER));
    expect(s.startedAt).toBe(new Date(1754300000000).toISOString());
    expect(s.endedAt).toBe(new Date(1754303600000).toISOString());
  });

  it('skips empty draft panes', () => {
    expect(getSession(db, DRAFT)).toBeNull();
    const listed = listSessions(db, {}).sessions.map((x) => x.id);
    expect(listed).not.toContain(DRAFT);
  });

  it("costs come from Cursor's own usageData cents, tokens from bubbles", () => {
    const s = getSession(db, MODERN)!;
    expect(s.costUsd).toBeCloseTo(0.16);
    expect(s.inputTokens).toBe(41626);
    expect(s.outputTokens).toBe(1268);
    expect(s.model).toBe('gpt-4.1');
  });

  it('pairs the split tool call and result', () => {
    const rows = db
      .prepare(
        `SELECT kind, tool_use_id FROM messages WHERE session_id = ? AND tool_use_id = 'call_cursor_ide_01' ORDER BY idx`,
      )
      .all(MODERN) as Array<{ kind: string }>;
    expect(rows.map((r) => r.kind)).toEqual(['tool_use', 'tool_result']);
  });

  it('searches across generations', () => {
    const modern = searchMessages(db, { query: 'agent:cursor backoff' });
    expect(modern.groups.map((g) => g.session.id)).toContain(MODERN);
    const legacy = searchMessages(db, { query: 'React Native' });
    expect(legacy.groups.map((g) => g.session.id)).toContain(LEGACY);
  });

  it('is incremental per composer and re-extracts on lastUpdatedAt change', async () => {
    const indexer = new Indexer(db, {
      projectsDir: tmpDir('turnlog-empty-'),
      cursorIdeUserDir: userDir,
    });
    const second = await indexer.scanAll();
    expect(second.filesIndexed).toBe(0); // nothing changed → nothing re-read

    const globalDb = path.join(userDir, 'globalStorage', 'state.vscdb');
    const raw = new Database(globalDb);
    const row = raw
      .prepare(`SELECT value FROM cursorDiskKV WHERE key = ?`)
      .get(`composerData:${LEGACY}`) as { value: string };
    const data = JSON.parse(row.value);
    data.lastUpdatedAt = 1737819999999;
    data.conversation.push({ type: 1, bubbleId: 'L3', text: 'add a dark theme toggle' });
    raw
      .prepare(`UPDATE cursorDiskKV SET value = ? WHERE key = ?`)
      .run(JSON.stringify(data), `composerData:${LEGACY}`);
    raw.close();

    const third = await indexer.scanAll();
    expect(third.filesIndexed).toBe(1); // only the touched composer
    const res = searchMessages(db, { query: 'dark theme toggle' });
    expect(res.groups.map((g) => g.session.id)).toContain(LEGACY);
  });

  it('virtual paths survive prune and resolve reveal to the vscdb', () => {
    expect(sessionFileOnDisk(`${path.sep}x${path.sep}state.vscdb#abc`)).toBe(
      `${path.sep}x${path.sep}state.vscdb`,
    );
    const { pruned } = pruneMissingSessions(db);
    expect(pruned).toBe(0); // the vscdb exists — composers are not "missing files"
    expect(getSession(db, MODERN)).not.toBeNull();
    const reveal = getSessionFilePath(db, MODERN)!;
    expect(reveal.endsWith('state.vscdb')).toBe(true);
    expect(fs.existsSync(reveal)).toBe(true);
  });
});
