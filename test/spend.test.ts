import { beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { Indexer } from '../src/indexer/indexer.js';
import { getSpend, listProjects, searchMessages } from '../src/server/api.js';
import { SESSION_C, copyCorpus, testDb, tmpDir } from './helpers.js';

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
});
