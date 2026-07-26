import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { Indexer } from '../src/indexer/indexer.js';
import { getSessionChain, listSessions, setSessionMeta } from '../src/server/api.js';
import { testDb, tmpDir } from './helpers.js';

/**
 * Resume chains: `claude --resume` into a new session id copies the whole
 * history into the new file — original message uuids, rewritten sessionId.
 * These fixtures reproduce that shape: Y is a fork of X carrying X's records
 * plus a continuation; Z is a standalone session.
 */

const SESSION_X = 'cccccccc-0000-4000-8000-000000000001';
const SESSION_Y = 'cccccccc-0000-4000-8000-000000000002';
const SESSION_Z = 'cccccccc-0000-4000-8000-000000000003';

function line(obj: Record<string, unknown>): string {
  return `${JSON.stringify(obj)}\n`;
}

function prompt(sid: string, uuid: string, parent: string | null, ts: string, text: string) {
  return line({
    type: 'user',
    sessionId: sid,
    uuid,
    parentUuid: parent,
    timestamp: ts,
    cwd: '/Users/dev/projects/chainproj',
    message: { role: 'user', content: text },
  });
}

function reply(sid: string, uuid: string, parent: string, ts: string, msgId: string) {
  return line({
    type: 'assistant',
    sessionId: sid,
    uuid,
    parentUuid: parent,
    timestamp: ts,
    message: {
      id: msgId,
      role: 'assistant',
      model: 'claude-opus-4-8',
      content: [{ type: 'text', text: 'done' }],
      usage: { input_tokens: 100, output_tokens: 20 },
    },
  });
}

/** The shared history both parts carry (uuids identical, sessionId rewritten). */
function sharedHistory(sid: string): string {
  return (
    line({ type: 'mode', mode: 'normal', sessionId: sid }) +
    prompt(sid, 'p1', null, '2026-07-01T10:00:00.000Z', 'start the work') +
    reply(sid, 'x1', 'p1', '2026-07-01T10:00:10.000Z', 'msg_c1') +
    prompt(sid, 'p2', 'x1', '2026-07-01T10:05:00.000Z', 'keep going') +
    reply(sid, 'x2', 'p2', '2026-07-01T10:05:10.000Z', 'msg_c2')
  );
}

let db: Database.Database;
let projectsDir: string;
let indexer: Indexer;

beforeAll(async () => {
  projectsDir = tmpDir('turnlog-chains-');
  const proj = path.join(projectsDir, '-Users-dev-projects-chainproj');
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, `${SESSION_X}.jsonl`), sharedHistory(SESSION_X));
  fs.writeFileSync(
    path.join(proj, `${SESSION_Y}.jsonl`),
    sharedHistory(SESSION_Y) +
      prompt(SESSION_Y, 'p3', 'x2', '2026-07-01T11:00:00.000Z', 'resumed — continue') +
      reply(SESSION_Y, 'x3', 'p3', '2026-07-01T11:00:10.000Z', 'msg_c3'),
  );
  fs.writeFileSync(
    path.join(proj, `${SESSION_Z}.jsonl`),
    prompt(SESSION_Z, 'z1', null, '2026-07-01T12:00:00.000Z', 'unrelated session') +
      reply(SESSION_Z, 'zx1', 'z1', '2026-07-01T12:00:10.000Z', 'msg_z1'),
  );
  db = testDb(tmpDir('turnlog-chains-db-'));
  indexer = new Indexer(db, { projectsDir });
  await indexer.scanAll();
});

describe('resume-chain stitching', () => {
  it('stamps the shared root uuid on both parts, skipping non-message records', async () => {
    const roots = db
      .prepare(`SELECT id, root_uuid FROM sessions ORDER BY id`)
      .all() as { id: string; root_uuid: string | null }[];
    const byId = new Map(roots.map((r) => [r.id, r.root_uuid]));
    // The 'mode' line has no uuid — the first prompt is the root.
    expect(byId.get(SESSION_X)).toBe('p1');
    expect(byId.get(SESSION_Y)).toBe('p1');
    expect(byId.get(SESSION_Z)).toBe('z1');
  });

  it('reports chainLen on every part; standalone sessions read 1', () => {
    const all = listSessions(db, {});
    const len = new Map(all.sessions.map((s) => [s.id, s.chainLen]));
    expect(len.get(SESSION_X)).toBe(2);
    expect(len.get(SESSION_Y)).toBe(2);
    expect(len.get(SESSION_Z)).toBe(1);
    expect(all.total).toBe(3);
  });

  it('collapses a chain to its most recent part, keeping standalone sessions', () => {
    const collapsed = listSessions(db, { collapseChains: true });
    const ids = collapsed.sessions.map((s) => s.id);
    expect(ids).toContain(SESSION_Y);
    expect(ids).toContain(SESSION_Z);
    expect(ids).not.toContain(SESSION_X);
    expect(collapsed.total).toBe(2);
  });

  it('never hides a pinned part', () => {
    setSessionMeta(db, SESSION_X, { pinned: true });
    const ids = listSessions(db, { collapseChains: true }).sessions.map((s) => s.id);
    expect(ids).toContain(SESSION_X);
    expect(ids).toContain(SESSION_Y);
    setSessionMeta(db, SESSION_X, { pinned: false });
  });

  it('returns the chain oldest-first from any part', () => {
    for (const id of [SESSION_X, SESSION_Y]) {
      const chain = getSessionChain(db, id);
      expect(chain?.map((s) => s.id)).toEqual([SESSION_X, SESSION_Y]);
    }
    expect(getSessionChain(db, SESSION_Z)?.map((s) => s.id)).toEqual([SESSION_Z]);
    expect(getSessionChain(db, 'nope')).toBeNull();
  });

  it('keeps the root uuid across incremental appends', async () => {
    const file = path.join(projectsDir, '-Users-dev-projects-chainproj', `${SESSION_Y}.jsonl`);
    fs.appendFileSync(
      file,
      prompt(SESSION_Y, 'p4', 'x3', '2026-07-01T11:30:00.000Z', 'one more thing'),
    );
    await indexer.indexFile(file);
    const row = db
      .prepare(`SELECT root_uuid FROM sessions WHERE id = ?`)
      .get(SESSION_Y) as { root_uuid: string | null };
    expect(row.root_uuid).toBe('p1');
  });
});
