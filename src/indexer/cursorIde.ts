import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import type { CursorIdeEnvelope } from '../parser/adapters/cursorIde.js';

/**
 * Extractor for Cursor IDE composers.
 *
 * The IDE keeps chat history inside its own SQLite state DBs, which Cursor
 * holds open and writes constantly. Turnlog NEVER opens the originals:
 * every DB is copied (with its -wal, so un-checkpointed writes are seen) to
 * a scratch dir first, opened readonly there, and the copies deleted after.
 * Read-only toward other tools' data is a hard guarantee, and a copy cannot
 * even take a read lock on the live file.
 *
 * Layout (verified on real data, Cursor 0.4x–1.x):
 *  - globalStorage/state.vscdb, table `cursorDiskKV`:
 *      `composerData:<id>`  — session metadata + (legacy) inline conversation
 *      `bubbleId:<composerId>:<bubbleId>` — one message (modern generation)
 *  - workspaceStorage/<hash>/state.vscdb, table `ItemTable`, key
 *      `composer.composerData` — which composers belong to this workspace;
 *      the sibling workspace.json carries the folder URI → cwd attribution.
 *
 * Everything is defensive: a missing dir, an unreadable DB, or a table the
 * next Cursor release renames turns into "no sessions from this source",
 * never a crash. Shape drift inside a composer degrades per-envelope via the
 * adapter's unknown handling.
 */

/** Context caches stripped from stored envelopes: IDE working state, not
 *  conversation. The vscdb on disk remains the source of truth; on a format
 *  bump the extractor re-reads it, so nothing is lost by not archiving them. */
const BUBBLE_BLOCKLIST = new Set([
  'attachedCodeChunks',
  'attachedFileCodeChunksUris',
  'attachedFolders',
  'attachedFoldersListDirResults',
  'attachedFoldersNew',
  'attachedHumanChanges',
  'codebaseContextChunks',
  'contextPieces',
  'context',
  'diffHistories',
  'diffsForCompressingFiles',
  'diffsSinceLastApply',
  'docsReferences',
  'editTrailContexts',
  'fileDiffTrajectories',
  'humanChanges',
  'interpreterResults',
  'knowledgeItems',
  'lints',
  'multiFileLinterErrors',
  'notepads',
  'recentLocationsHistory',
  'recentlyViewedFiles',
  'suggestedCodeBlocks',
  'summarizedComposers',
  'symbolLinks',
]);

const COMPOSER_KEEP = new Set([
  '_v',
  'composerId',
  'name',
  'createdAt',
  'lastUpdatedAt',
  'unifiedMode',
  'forceMode',
  'isAgentic',
  'usageData',
  'modelConfig',
  'gitWorktree',
  'status',
]);

export interface CursorIdeComposer {
  composerId: string;
  name: string | null;
  createdAt: number | null;
  lastUpdatedAt: number | null;
  cwd: string | null;
  /** The real vscdb path this composer came from (reveal, health). */
  dbPath: string;
  envelopes: CursorIdeEnvelope[];
}

function slim(obj: Record<string, unknown>, blocklist: Set<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!blocklist.has(k)) out[k] = v;
  }
  return out;
}

function keep(obj: Record<string, unknown>, allowlist: Set<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (allowlist.has(k)) out[k] = v;
  }
  return out;
}

function parseJson(v: unknown): Record<string, unknown> | null {
  if (typeof v !== 'string') return null;
  try {
    const parsed = JSON.parse(v);
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

/** file:///Users/x/proj → /Users/x/proj (decoded, platform slashes kept). */
function folderUriToPath(uri: unknown): string | null {
  if (typeof uri !== 'string' || !uri.startsWith('file://')) return null;
  try {
    return fileURLToPath(uri);
  } catch {
    return null;
  }
}

/** Copy a DB (+ sidecar -wal) to the scratch dir and open readonly. */
function openCopy(dbPath: string, scratch: string, tag: string): Database.Database | null {
  try {
    const copy = path.join(scratch, `${tag}.vscdb`);
    fs.copyFileSync(dbPath, copy);
    for (const ext of ['-wal', '-shm']) {
      try {
        fs.copyFileSync(dbPath + ext, copy + ext);
      } catch {
        /* no sidecar — checkpointed DB */
      }
    }
    return new Database(copy, { readonly: true, fileMustExist: true });
  } catch {
    return null;
  }
}

/** composerId → workspace folder path, from every workspace DB that maps one. */
function readWorkspaceMap(userDir: string, scratch: string): Map<string, string> {
  const map = new Map<string, string>();
  const root = path.join(userDir, 'workspaceStorage');
  let hashes: fs.Dirent[];
  try {
    hashes = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return map;
  }
  for (const h of hashes) {
    if (!h.isDirectory()) continue;
    const wsDir = path.join(root, h.name);
    const folder = folderUriToPath(
      parseJson(safeRead(path.join(wsDir, 'workspace.json')))?.folder,
    );
    if (!folder) continue;
    const db = openCopy(path.join(wsDir, 'state.vscdb'), scratch, `ws-${h.name}`);
    if (!db) continue;
    try {
      const row = db
        .prepare(`SELECT value FROM ItemTable WHERE key = 'composer.composerData'`)
        .get() as { value: string | Buffer } | undefined;
      const data = parseJson(row?.value?.toString());
      const all = Array.isArray(data?.allComposers) ? (data.allComposers as unknown[]) : [];
      for (const c of all) {
        const id = (c as Record<string, unknown>)?.composerId;
        if (typeof id === 'string') map.set(id, folder);
      }
    } catch {
      /* table shape drift — this workspace contributes no mapping */
    } finally {
      db.close();
    }
  }
  return map;
}

function safeRead(p: string): string | null {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Read every composer out of the Cursor IDE user dir. Returns [] when Cursor
 * is absent or the layout is unrecognizable — indexing simply off.
 */
export function extractCursorIdeComposers(userDir: string): CursorIdeComposer[] {
  const globalDb = path.join(userDir, 'globalStorage', 'state.vscdb');
  if (!fs.existsSync(globalDb)) return [];

  let scratch: string;
  try {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'turnlog-cursor-'));
  } catch {
    return [];
  }

  const out: CursorIdeComposer[] = [];
  try {
    const workspaceOf = readWorkspaceMap(userDir, scratch);
    const db = openCopy(globalDb, scratch, 'global');
    if (!db) return [];
    try {
      const rows = db
        .prepare(
          `SELECT key, value FROM cursorDiskKV
           WHERE key LIKE 'composerData:%' OR key LIKE 'bubbleId:%'`,
        )
        .all() as Array<{ key: string; value: string | Buffer | null }>;

      const composers = new Map<string, Record<string, unknown>>();
      const bubbles = new Map<string, Map<string, Record<string, unknown>>>();
      for (const row of rows) {
        const data = parseJson(row.value?.toString());
        if (!data) continue;
        if (row.key.startsWith('composerData:')) {
          composers.set(row.key.slice('composerData:'.length), data);
        } else {
          const [, composerId, bubbleId] = row.key.split(':');
          if (!composerId || !bubbleId) continue;
          let forComposer = bubbles.get(composerId);
          if (!forComposer) bubbles.set(composerId, (forComposer = new Map()));
          forComposer.set(bubbleId, data);
        }
      }

      for (const [composerId, data] of composers) {
        out.push(
          buildComposer(composerId, data, bubbles.get(composerId), workspaceOf, globalDb),
        );
      }
    } finally {
      db.close();
    }
  } catch {
    /* unrecognizable layout — no cursor-ide sessions this pass */
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  return out;
}

function buildComposer(
  composerId: string,
  data: Record<string, unknown>,
  bubbleStore: Map<string, Record<string, unknown>> | undefined,
  workspaceOf: Map<string, string>,
  dbPath: string,
): CursorIdeComposer {
  const cwd = workspaceOf.get(composerId) ?? null;
  const envelopes: CursorIdeEnvelope[] = [];
  const composerSlim = keep(data, COMPOSER_KEEP);
  envelopes.push({
    source: 'cursor-ide',
    t: 'composer',
    composerId,
    ...(cwd !== null ? { cwd } : {}),
    data: composerSlim,
  });

  // Modern generation: ordered headers referencing separate bubble keys.
  const headers = Array.isArray(data.fullConversationHeadersOnly)
    ? (data.fullConversationHeadersOnly as Array<Record<string, unknown>>)
    : [];
  for (const h of headers) {
    const bubbleId = typeof h?.bubbleId === 'string' ? h.bubbleId : null;
    const bubble = bubbleId ? bubbleStore?.get(bubbleId) : undefined;
    if (!bubbleId || !bubble) continue; // header without its bubble — nothing to store
    pushBubble(envelopes, composerId, bubbleId, bubble);
  }

  // Legacy generation: the conversation rides the composer itself.
  const legacy = Array.isArray(data.conversation)
    ? (data.conversation as Array<Record<string, unknown>>)
    : [];
  for (let i = 0; i < legacy.length; i += 1) {
    const entry = legacy[i];
    if (!entry || typeof entry !== 'object') continue;
    const bubbleId = typeof entry.bubbleId === 'string' ? entry.bubbleId : `legacy-${i}`;
    envelopes.push({
      source: 'cursor-ide',
      t: 'legacy',
      composerId,
      bubbleId,
      data: slim(entry, BUBBLE_BLOCKLIST),
    });
  }

  // Cursor's own per-model billing — the recorded cost for this session.
  const usage = data.usageData;
  if (usage && typeof usage === 'object' && !Array.isArray(usage)) {
    for (const [model, entry] of Object.entries(usage as Record<string, unknown>)) {
      if (!entry || typeof entry !== 'object') continue;
      envelopes.push({
        source: 'cursor-ide',
        t: 'usage',
        composerId,
        model,
        data: { ...(entry as Record<string, unknown>), lastUpdatedAt: data.lastUpdatedAt },
      });
    }
  }

  return {
    composerId,
    name: typeof data.name === 'string' && data.name !== '' ? data.name : null,
    createdAt: typeof data.createdAt === 'number' ? data.createdAt : null,
    lastUpdatedAt: typeof data.lastUpdatedAt === 'number' ? data.lastUpdatedAt : null,
    cwd,
    dbPath,
    envelopes,
  };
}

function pushBubble(
  envelopes: CursorIdeEnvelope[],
  composerId: string,
  bubbleId: string,
  bubble: Record<string, unknown>,
): void {
  const slimBubble = slim(bubble, BUBBLE_BLOCKLIST);
  const tf = bubble.toolFormerData;
  if (tf && typeof tf === 'object') {
    // Split call and result so tool pairing works: the call keeps everything
    // but the (often huge) result payload; the result envelope carries it.
    const tfRec = tf as Record<string, unknown>;
    const call = { ...tfRec };
    delete call.result;
    envelopes.push({
      source: 'cursor-ide',
      t: 'bubble',
      composerId,
      bubbleId,
      data: { ...slimBubble, toolFormerData: call },
    });
    envelopes.push({
      source: 'cursor-ide',
      t: 'bubble_result',
      composerId,
      bubbleId,
      data: {
        toolFormerData: {
          toolCallId: tfRec.toolCallId,
          status: tfRec.status,
          result: tfRec.result,
        },
      },
    });
    return;
  }
  envelopes.push({ source: 'cursor-ide', t: 'bubble', composerId, bubbleId, data: slimBubble });
}
