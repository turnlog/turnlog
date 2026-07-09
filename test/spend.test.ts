import { beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { Indexer } from '../src/indexer/indexer.js';
import { getSpend, listProjects, searchMessages } from '../src/server/api.js';
import { SESSION_C, SESSION_D, SUBAGENT_D, copyCorpus, testDb, tmpDir } from './helpers.js';

let db: Database.Database;

beforeAll(async () => {
  db = testDb(tmpDir('turnlog-spend-'));
  await new Indexer(db, { projectsDir: copyCorpus() }).scanAll();
});

// Corpus sessions start 2026-07-01/02 — a wide window covers them all.
const WIDE = 100_000;

describe('getSpend', () => {
  it('rolls up daily by session start date', () => {
    const res = getSpend(db, { days: WIDE });
    expect(res.totals.sessions).toBeGreaterThanOrEqual(3);
    expect(res.totals.costUsd).toBeGreaterThan(0);
    expect(res.days.length).toBeGreaterThanOrEqual(2);
    expect(res.days.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date))).toBe(true);
    // days sum to totals
    const sum = res.days.reduce((n, d) => n + d.costUsd, 0);
    expect(sum).toBeCloseTo(res.totals.costUsd, 6);
  });

  it('splits by model and project', () => {
    const res = getSpend(db, { days: WIDE });
    expect(res.byModel.some((m) => m.key.includes('sonnet'))).toBe(true);
    expect(res.byProject.length).toBeGreaterThanOrEqual(2);
  });

  it('attributes byModel per message, excluding placeholder models', () => {
    const res = getSpend(db, { days: WIDE });
    // The haiku usage comes from a sidechain + a subagent transcript — a
    // session-level split would fold it into the session's main model.
    const haiku = res.byModel.find((m) => m.key.includes('haiku'));
    expect(haiku).toBeDefined();
    expect(haiku!.tokens).toBeGreaterThan(0);
    expect(res.byModel.some((m) => m.key.startsWith('<'))).toBe(false);
  });

  it('buckets days by the machine-local calendar day', () => {
    const res = getSpend(db, { days: WIDE });
    const pad = (n: number) => String(n).padStart(2, '0');
    const d = new Date('2026-07-01T10:00:00.000Z');
    const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    expect(res.days.map((x) => x.date)).toContain(local);
  });

  it('narrows to the FTS match set with q', () => {
    const all = getSpend(db, { days: WIDE });
    const scoped = getSpend(db, { days: WIDE, query: 'quantum_flux_capacitor' });
    expect(scoped.query).toBe('quantum_flux_capacitor');
    expect(scoped.totals.sessions).toBe(1);
    expect(scoped.totals.costUsd).toBeLessThan(all.totals.costUsd);
  });

  it('estimates cache savings when cache reads exist', () => {
    const res = getSpend(db, { days: WIDE });
    expect(res.totals.cacheReadTokens).toBeGreaterThan(0);
    expect(res.totals.cacheSavedUsd).toBeGreaterThan(0);
  });

  it('honors the window cutoff', () => {
    const res = getSpend(db, { days: 1 }); // corpus sessions are in the past
    expect(res.totals.sessions).toBe(0);
    expect(res.days).toHaveLength(0);
  });
});

describe('search aggregates + project rollup', () => {
  it('aggregates over the full match set', () => {
    const res = searchMessages(db, { query: 'quantum_flux_capacitor' });
    expect(res.aggregates).not.toBeNull();
    expect(res.aggregates!.matchedSessions).toBe(1);
    expect(res.aggregates!.totalCostUsd).toBeGreaterThan(0);
  });

  it('skips aggregates for session-scoped find', () => {
    const res = searchMessages(db, { query: 'flux', sessionId: SESSION_C });
    expect(res.aggregates).toBeNull();
  });

  it('projects carry a cost rollup', () => {
    const projects = listProjects(db);
    expect(projects.every((p) => typeof p.costUsd === 'number')).toBe(true);
    expect(projects.some((p) => p.costUsd > 0)).toBe(true);
  });

  it('resolves a hit inside a subagent transcript to the parent session', () => {
    const res = searchMessages(db, { query: 'todo_sweep_gamma' });
    expect(res.totalHits).toBe(1);
    // The hit itself belongs to the subagent session (openable in replay)...
    expect(res.groups[0]!.session.id).toBe(SUBAGENT_D);
    expect(res.groups[0]!.session.parentSessionId).toBe(SESSION_D);
    // ...but the money aggregate counts the parent's rolled-up total, once.
    expect(res.aggregates!.matchedSessions).toBe(1);
    expect(res.aggregates!.totalCostUsd).toBeCloseTo(0.01219, 5);
  });
});

describe('listSessions date range', () => {
  it('sorts by total tokens', async () => {
    const { listSessions } = await import('../src/server/api.js');
    const res = listSessions(db, { sort: 'tokens', dir: 'desc' });
    const totals = res.sessions.map((s) => s.inputTokens + s.outputTokens);
    expect(totals).toEqual([...totals].sort((a, b) => b - a));
    expect(totals[0]).toBeGreaterThan(0);
  });

  it('bounds by started_at', async () => {
    const { listSessions } = await import('../src/server/api.js');
    const day = listSessions(db, { since: '2026-07-02T00:00:00Z', until: '2026-07-03T00:00:00Z' });
    expect(day.total).toBeGreaterThanOrEqual(1);
    expect(
      day.sessions.every(
        (s) => s.startedAt !== null && s.startedAt >= '2026-07-02' && s.startedAt < '2026-07-03',
      ),
    ).toBe(true);
    const none = listSessions(db, { since: '2030-01-01T00:00:00Z' });
    expect(none.total).toBe(0);
  });
});
