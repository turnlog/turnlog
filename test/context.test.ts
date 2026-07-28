import { beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { Indexer } from '../src/indexer/indexer.js';
import { getSessionContext } from '../src/server/api.js';
import { SESSION_A, SESSION_EMPTY, copyCorpus, testDb, tmpDir } from './helpers.js';

let db: Database.Database;

beforeAll(async () => {
  db = testDb(tmpDir('turnlog-context-'));
  await new Indexer(db, { projectsDir: copyCorpus() }).scanAll();
});

describe('getSessionContext (context-window timeline)', () => {
  it('yields one point per API response with the prompt-side token sum', () => {
    const res = getSessionContext(db, SESSION_A)!;
    // Session A's main chain: five usage-bearing responses (msg_01A…01F,
    // minus the sidechain msg_01E) — input + cache read + cache write each.
    expect(res.points.map((p) => p.context)).toEqual([5500, 5540, 5830, 5850, 6090]);
    const idxs = res.points.map((p) => p.idx);
    expect([...idxs].sort((a, b) => a - b)).toEqual(idxs);
    for (const p of res.points) expect(p.ts).not.toBeNull();
  });

  it('excludes sidechain responses — subagents run their own context', () => {
    const res = getSessionContext(db, SESSION_A)!;
    // The sidechain response's prompt side is 600 tokens; it must not appear.
    expect(res.points.some((p) => p.context === 600)).toBe(false);
  });

  it('surfaces compact_boundary records with CC’s preTokens', () => {
    const res = getSessionContext(db, SESSION_A)!;
    expect(res.compactions).toHaveLength(1);
    const c = res.compactions[0]!;
    expect(c.preTokens).toBe(168_000);
    // The boundary sits after the last counted response in file order.
    expect(c.idx).toBeGreaterThan(res.points[res.points.length - 1]!.idx);
  });

  it('handles sessions with no usage rows and unknown ids', () => {
    const empty = getSessionContext(db, SESSION_EMPTY)!;
    expect(empty.points).toHaveLength(0);
    expect(empty.compactions).toHaveLength(0);
    expect(getSessionContext(db, 'no-such-session')).toBeNull();
  });
});
