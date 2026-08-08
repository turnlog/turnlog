import { beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { Indexer } from '../src/indexer/indexer.js';
import { getProject, getSpend, listProjects, setSessionTags } from '../src/server/api.js';
import {
  CODEX_SESSION,
  SESSION_A,
  copyCodexCorpus,
  copyCorpus,
  testDb,
  tmpDir,
} from './helpers.js';

let db: Database.Database;
const WEBAPP = '-Users-dev-projects-webapp';

beforeAll(async () => {
  db = testDb(tmpDir('turnlog-project-'));
  await new Indexer(db, {
    projectsDir: copyCorpus(),
    codexDir: copyCodexCorpus(),
  }).scanAll();
});

describe('project page data', () => {
  it('rolls one repo up across every agent that worked on it', () => {
    const p = getProject(db, WEBAPP)!;
    expect(p.projectKey).toBe(WEBAPP);
    expect(p.projectPath).toBe('/Users/dev/projects/webapp');
    // The corpus puts CC sessions A and B plus the Codex rollout in this repo.
    expect(p.sessionCount).toBeGreaterThanOrEqual(3);
    const tools = p.agents.map((a) => a.tool).sort();
    expect(tools).toContain('claude-code');
    expect(tools).toContain('codex');
    expect(p.agents.reduce((n, a) => n + a.sessions, 0)).toBe(p.sessionCount);
  });

  it('matches the project key exactly — never the operator LIKE', () => {
    // `project:` filters with %…%, which would fold a neighbour repo into
    // this page. A page about one repo must be about exactly that repo.
    db.prepare(
      `INSERT INTO sessions (id, project_key, file_path, adapter_version, event_count, cost_usd)
       VALUES (?, ?, ?, 1, 5, 9.99)`,
    ).run('decoy-1', `${WEBAPP}-v2`, '/fake/decoy.jsonl');

    const p = getProject(db, WEBAPP)!;
    expect(p.sessionCount).toBeGreaterThanOrEqual(3);
    // The decoy is its own project, with its own page.
    const decoy = getProject(db, `${WEBAPP}-v2`)!;
    expect(decoy.sessionCount).toBe(1);
    expect(p.sessionCount).not.toBe(p.sessionCount + decoy.sessionCount);
    db.prepare(`DELETE FROM sessions WHERE id = 'decoy-1'`).run();
  });

  it('agrees with the spend screen on what the repo cost', () => {
    // Both go through DUP_ROWIDS_SQL — one definition of a resume duplicate,
    // so a repo cannot show two different totals on two screens.
    const p = getProject(db, WEBAPP)!;
    const spend = getSpend(db, { days: 3650 });
    const fromSpend = spend.byProject.find((x) => x.key === WEBAPP)!;
    expect(p.costUsd).toBeCloseTo(fromSpend.costUsd, 6);
  });

  it('lists the files this repo touched most, busiest first', () => {
    const p = getProject(db, WEBAPP)!;
    expect(p.topFiles.length).toBeGreaterThan(0);
    for (let i = 1; i < p.topFiles.length; i += 1) {
      expect(p.topFiles[i - 1]!.sessions).toBeGreaterThanOrEqual(p.topFiles[i]!.sessions);
    }
    expect(p.topFiles.some((f) => f.path.includes('useWebSocket'))).toBe(true);
  });

  it('surfaces the tags used on this repo', () => {
    setSessionTags(db, SESSION_A, ['refactor', 'billing']);
    setSessionTags(db, CODEX_SESSION, ['refactor']);
    const p = getProject(db, WEBAPP)!;
    const tags = Object.fromEntries(p.tags.map((t) => [t.tag, t.count]));
    expect(tags.refactor).toBe(2); // both agents' sessions carry it
    expect(tags.billing).toBe(1);
    // Busiest first.
    expect(p.tags[0]!.tag).toBe('refactor');
  });

  it('reports the active span and totals', () => {
    const p = getProject(db, WEBAPP)!;
    expect(p.firstAt).not.toBeNull();
    expect(p.lastAt).not.toBeNull();
    expect(p.firstAt! <= p.lastAt!).toBe(true);
    expect(p.eventCount).toBeGreaterThan(0);
    expect(p.inputTokens + p.outputTokens).toBeGreaterThan(0);
  });

  it('returns null for a project that is not indexed', () => {
    expect(getProject(db, '-no-such-project')).toBeNull();
  });

  it('says when the repo is no longer on disk, and keeps its history anyway', () => {
    // Moved, renamed, or deleted: agent logs live in the agent's own data
    // dir, so the sessions survive the folder. The page says so rather than
    // showing a path that silently points nowhere.
    db.prepare(
      `INSERT INTO sessions (id, project_key, project_path, file_path, adapter_version, event_count)
       VALUES (?, ?, ?, ?, 1, 3)`,
    ).run('gone-1', '-gone-repo', '/nowhere/that/exists', '/fake/gone.jsonl');

    const gone = getProject(db, '-gone-repo')!;
    expect(gone.pathExists).toBe(false);
    expect(gone.sessionCount).toBe(1); // history intact

    const here = getProject(db, WEBAPP)!;
    expect(here.pathExists).toBe(false); // the fixture path is synthetic too
    db.prepare(`DELETE FROM sessions WHERE id = 'gone-1'`).run();
  });
});

describe('the projects index', () => {
  it('carries what the list needs: agents present and last activity', () => {
    const list = listProjects(db);
    const webapp = list.find((p) => p.projectKey === WEBAPP)!;
    // The cross-agent point, visible without opening the project.
    expect(webapp.agents.sort()).toEqual(['claude-code', 'codex']);
    expect(webapp.lastActiveAt).not.toBeNull();
    expect(webapp.sessionCount).toBeGreaterThanOrEqual(3);
  });

  it('dedupes the agent list rather than repeating one per session', () => {
    const list = listProjects(db);
    for (const p of list) {
      expect(new Set(p.agents).size).toBe(p.agents.length);
    }
  });
});
