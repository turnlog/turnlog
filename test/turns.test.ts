import { beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { Indexer } from '../src/indexer/indexer.js';
import { listMessages, listTurns } from '../src/server/api.js';
import { SESSION_C, SESSION_D, copyCorpus, testDb, tmpDir } from './helpers.js';

let db: Database.Database;

beforeAll(async () => {
  db = testDb(tmpDir('turnlog-turns-'));
  await new Indexer(db, { projectsDir: copyCorpus() }).scanAll();
});

describe('listTurns', () => {
  it('returns null for unknown sessions', () => {
    expect(listTurns(db, 'nope')).toBeNull();
  });

  it('builds one turn per main-chain prompt with mechanical counts', () => {
    const res = listTurns(db, SESSION_C)!;
    expect(res.turns).toHaveLength(1);

    const turn = res.turns[0]!;
    expect(turn.text).toContain('quantum_flux_capacitor');
    expect(turn.command).toBeNull();
    expect(turn.commands).toBe(1); // the failing npm test
    expect(turn.edits).toBe(1); // the null-safety fix
    expect(turn.errors).toBe(1); // is_error normalized out of raw JSON
    expect(turn.tokensOut).toBeGreaterThan(0);
  });

  it('turn ranges cover the whole session, prelude included', () => {
    const res = listTurns(db, SESSION_C)!;
    const first = res.turns[0]!;
    expect(first.idx).toBe(res.preludeCount === 0 ? 0 : res.preludeCount);
    expect(res.turns[res.turns.length - 1]!.endIdx).toBe(res.total);
  });

  it('does not treat injected meta records as turn boundaries', () => {
    // SESSION_D has one real prompt plus an isMeta caveat record — the caveat
    // must not open a second turn (it's kind 'meta', not 'prompt').
    const res = listTurns(db, SESSION_D)!;
    expect(res.turns).toHaveLength(1);
    expect(res.turns[0]!.tasks).toBe(1); // the subagent launch
  });

  it('endIdx bounds fetch exactly the turn rows', () => {
    const res = listTurns(db, SESSION_C)!;
    const turn = res.turns[0]!;
    const msgs = listMessages(db, SESSION_C, {
      afterIdx: turn.idx - 1,
      limit: turn.endIdx - turn.idx,
    })!;
    expect(msgs.messages[0]!.idx).toBe(turn.idx);
    expect(msgs.messages.some((m) => m.isError)).toBe(true);
  });
});
