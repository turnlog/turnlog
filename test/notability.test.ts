import { beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { Indexer } from '../src/indexer/indexer.js';
import { listSessions, notabilityScores, setSessionMeta } from '../src/server/api.js';
import { SESSION_A, SESSION_EMPTY, copyCorpus, testDb, tmpDir } from './helpers.js';

let db: Database.Database;

beforeAll(async () => {
  db = testDb(tmpDir('turnlog-notable-'));
  await new Indexer(db, { projectsDir: copyCorpus() }).scanAll();
});

describe('derived notability', () => {
  it('scores every root session and no child transcript', () => {
    const scores = notabilityScores(db);
    const roots = db
      .prepare(`SELECT id, parent_session_id AS p FROM sessions`)
      .all() as { id: string; p: string | null }[];
    for (const r of roots) {
      if (r.p === null) expect(scores.has(r.id)).toBe(true);
      else expect(scores.has(r.id)).toBe(false);
    }
  });

  it('ranks the long, costly, error-bearing session over the empty one', () => {
    const scores = notabilityScores(db);
    expect(scores.get(SESSION_A)!).toBeGreaterThan(scores.get(SESSION_EMPTY)!);

    const list = listSessions(db, { sort: 'notable' }).sessions.map((s) => s.id);
    expect(list.indexOf(SESSION_A)).toBeLessThan(list.indexOf(SESSION_EMPTY));
  });

  it('keeps pins above every derived score', () => {
    setSessionMeta(db, SESSION_EMPTY, { pinned: true });
    const list = listSessions(db, { sort: 'notable' }).sessions.map((s) => s.id);
    expect(list[0]).toBe(SESSION_EMPTY);
    setSessionMeta(db, SESSION_EMPTY, { pinned: false });
  });

  it('respects filters and paging like every other sort', () => {
    const all = listSessions(db, { sort: 'notable' });
    const page = listSessions(db, { sort: 'notable', limit: 2, offset: 1 });
    expect(page.sessions.map((s) => s.id)).toEqual(all.sessions.slice(1, 3).map((s) => s.id));
    expect(page.total).toBe(all.total);

    const webapp = listSessions(db, { sort: 'notable', project: '-Users-dev-projects-webapp' });
    for (const s of webapp.sessions) expect(s.projectKey).toBe('-Users-dev-projects-webapp');
  });

  it('flips with dir like every other sort', () => {
    const desc = listSessions(db, { sort: 'notable', dir: 'desc' }).sessions.map((s) => s.id);
    const asc = listSessions(db, { sort: 'notable', dir: 'asc' }).sessions.map((s) => s.id);
    expect(asc.indexOf(SESSION_A)).toBeGreaterThan(desc.indexOf(SESSION_A));
  });
});
