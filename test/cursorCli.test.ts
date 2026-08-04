import { beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { Indexer } from '../src/indexer/indexer.js';
import { getSession, listSessions, searchMessages } from '../src/server/api.js';
import {
  CURSOR_SESSION,
  CURSOR_SUBAGENT,
  SESSION_A,
  copyCorpus,
  copyCursorCliCorpus,
  testDb,
  tmpDir,
} from './helpers.js';

let db: Database.Database;
let cursorCliDir: string;

beforeAll(async () => {
  db = testDb(tmpDir('turnlog-cursorcli-'));
  cursorCliDir = copyCursorCliCorpus();
  await new Indexer(db, { projectsDir: copyCorpus(), cursorCliDir }).scanAll();
});

describe('cursor cli indexing', () => {
  it('indexes transcripts with tool stamped and the id from the filename', () => {
    const s = getSession(db, CURSOR_SESSION)!;
    expect(s.tool).toBe('cursor');
    expect(s.parentSessionId).toBeNull();
  });

  it('normalizes the dir-id to CC project-key form — one repo, one project', () => {
    // The transcript dir is Users-dev-projects-webapp (no leading dash);
    // CC's munging for the same cwd is -Users-dev-projects-webapp.
    const cursor = getSession(db, CURSOR_SESSION)!;
    const cc = getSession(db, SESSION_A)!;
    expect(cursor.projectKey).toBe(cc.projectKey);
  });

  it('falls back to file mtime for started/ended — transcripts carry no ts', () => {
    const s = getSession(db, CURSOR_SESSION)!;
    expect(s.startedAt).not.toBeNull();
    expect(s.endedAt).not.toBeNull();
    // The fallback is a real ISO timestamp, sortable next to CC's.
    expect(s.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    // Not hidden from the default date-ordered list.
    const listed = listSessions(db, {}).sessions.map((x) => x.id);
    expect(listed).toContain(CURSOR_SESSION);
  });

  it('nests the subagent transcript as a hidden child of its session', () => {
    const child = getSession(db, CURSOR_SUBAGENT)!;
    expect(child.parentSessionId).toBe(CURSOR_SESSION);
    const listed = listSessions(db, {}).sessions.map((x) => x.id);
    expect(listed).not.toContain(CURSOR_SUBAGENT);
  });

  it('rolls the subagent into the parent aggregates', () => {
    const parent = getSession(db, CURSOR_SESSION)!;
    // 14 own records (one blank-free file) + 4 subagent records.
    expect(parent.eventCount).toBeGreaterThan(14);
  });

  it('answers agent:cursor searches', () => {
    const res = searchMessages(db, { query: 'agent:cursor backoff' });
    expect(res.groups.map((g) => g.session.id)).toContain(CURSOR_SESSION);
    const none = searchMessages(db, { query: 'agent:codex backoff' });
    expect(none.groups.map((g) => g.session.id)).not.toContain(CURSOR_SESSION);
  });

  it('stays unpriced honestly — no usage means no cost, not a wrong one', () => {
    const s = getSession(db, CURSOR_SESSION)!;
    expect(s.costUsd).toBeNull();
    expect(s.inputTokens + s.outputTokens).toBe(0);
  });
});
