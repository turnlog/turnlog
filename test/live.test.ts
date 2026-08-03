import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { Indexer } from '../src/indexer/indexer.js';
import { getLiveSessions, LIVE_WITHIN_MINUTES } from '../src/server/api.js';
import {
  CODEX_SESSION,
  SESSION_A,
  copyCodexCorpus,
  copyCorpus,
  testDb,
  tmpDir,
} from './helpers.js';

/**
 * The corpus is historic, so "active" has to be staged: move a session's
 * ended_at into the window and it should appear, move it out and it should
 * not. That is the whole contract — everything else is shaping.
 */
function setActivity(db: Database.Database, id: string, minutesAgo: number): void {
  const ts = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  db.prepare(`UPDATE sessions SET ended_at = ? WHERE id = ?`).run(ts, id);
}

let db: Database.Database;

beforeEach(async () => {
  db = testDb(tmpDir('turnlog-live-'));
  await new Indexer(db, {
    projectsDir: copyCorpus(),
    codexDir: copyCodexCorpus(),
  }).scanAll();
  // Nothing is recent in a fixture corpus.
  db.prepare(`UPDATE sessions SET ended_at = '2020-01-01T00:00:00.000Z'`).run();
});

describe('the now panel', () => {
  it('is empty when nothing has been written to recently', () => {
    expect(getLiveSessions(db).sessions).toEqual([]);
  });

  it('lists a session written to inside the window', () => {
    setActivity(db, SESSION_A, 1);
    const live = getLiveSessions(db);
    expect(live.sessions.map((s) => s.id)).toEqual([SESSION_A]);
    expect(live.withinMinutes).toBe(LIVE_WITHIN_MINUTES);
  });

  it('drops one that has gone quiet', () => {
    setActivity(db, SESSION_A, LIVE_WITHIN_MINUTES + 1);
    expect(getLiveSessions(db).sessions).toEqual([]);
  });

  it('orders by most recent activity', () => {
    setActivity(db, SESSION_A, 4);
    setActivity(db, CODEX_SESSION, 1);
    expect(getLiveSessions(db).sessions.map((s) => s.id)).toEqual([CODEX_SESSION, SESSION_A]);
  });

  it('shows two different agents at once — the case it exists for', () => {
    setActivity(db, SESSION_A, 2);
    setActivity(db, CODEX_SESSION, 1);
    const live = getLiveSessions(db);
    const tools = new Set(live.sessions.map((s) => s.tool));
    expect(tools.size).toBe(2);
    // Every agent-agnostic fact is present for both, so the rows read alike.
    for (const s of live.sessions) {
      expect(s.eventCount).toBeGreaterThan(0);
      expect(s.lastActivityAt).not.toBeNull();
    }
  });

  it('reports context tokens only where the agent actually says', () => {
    setActivity(db, SESSION_A, 1);
    setActivity(db, CODEX_SESSION, 1);
    const byId = new Map(getLiveSessions(db).sessions.map((s) => [s.id, s]));
    // Claude Code rows carry a running window total.
    expect(byId.get(SESSION_A)?.contextTokens).toBeGreaterThan(0);
    // Codex rows carry per-response deltas — a running total would be a lie,
    // so the field is null and the UI omits it rather than showing a wrong
    // number that happens to render.
    expect(byId.get(CODEX_SESSION)?.contextTokens).toBeNull();
  });

  it('carries the latest prompt, collapsed to one line', () => {
    setActivity(db, SESSION_A, 1);
    const [s] = getLiveSessions(db).sessions;
    expect(s?.lastPrompt).toBeTruthy();
    expect(s?.lastPrompt).not.toMatch(/\n/);
  });

  it('lists a session once, not once per subagent transcript', () => {
    db.prepare(`UPDATE sessions SET ended_at = ?`).run(new Date().toISOString());
    const live = getLiveSessions(db, { limit: 50 });
    const parents = db
      .prepare(`SELECT COUNT(*) c FROM sessions WHERE parent_session_id IS NULL`)
      .get() as { c: number };
    expect(live.sessions).toHaveLength(parents.c);
    expect(new Set(live.sessions.map((s) => s.id)).size).toBe(live.sessions.length);
  });
});
