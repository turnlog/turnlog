import { beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { Indexer } from '../src/indexer/indexer.js';
import { findAbandonedIdxs, listMessages, listTurns } from '../src/server/api.js';
import { SESSION_B, SESSION_C, SESSION_D, copyCorpus, testDb, tmpDir } from './helpers.js';

let db: Database.Database;

beforeAll(async () => {
  db = testDb(tmpDir('turnlog-turns-'));
  await new Indexer(db, { projectsDir: copyCorpus() }).scanAll();
});

describe('findAbandonedIdxs', () => {
  const row = (o: Partial<Parameters<typeof findAbandonedIdxs>[0][0]>) => ({
    uuid: 'u',
    parentUuid: null,
    idx: 0,
    kind: 'prompt',
    messageId: null,
    ...o,
  });

  it('claims the dead sibling and everything under it', () => {
    const dead = findAbandonedIdxs([
      row({ uuid: 'a', idx: 0, kind: 'assistant' }),
      row({ uuid: 'b', parentUuid: 'a', idx: 1 }),
      row({ uuid: 'b2', parentUuid: 'b', idx: 2, kind: 'assistant' }),
      row({ uuid: 'c', parentUuid: 'a', idx: 3 }),
      row({ uuid: 'c2', parentUuid: 'c', idx: 4, kind: 'assistant' }),
    ]);
    expect([...dead].sort((x, y) => x - y)).toEqual([1, 2]);
  });

  it('does not mistake one response’s lines or a tool result for a fork', () => {
    // CC writes a line per content block: same message id, shared parent.
    expect(
      findAbandonedIdxs([
        row({ uuid: 'a', idx: 0, kind: 'assistant', messageId: 'm1' }),
        row({ uuid: 'b', parentUuid: 'a', idx: 1, kind: 'tool_use', messageId: 'm1' }),
        row({ uuid: 'c', parentUuid: 'a', idx: 2, kind: 'tool_result' }),
      ]).size,
    ).toBe(0);
    // Injected bookkeeping hangs off whatever preceded it.
    expect(
      findAbandonedIdxs([
        row({ uuid: 'a', idx: 0, kind: 'assistant' }),
        row({ uuid: 'b', parentUuid: 'a', idx: 1, kind: 'meta' }),
        row({ uuid: 'c', parentUuid: 'a', idx: 2, kind: 'prompt' }),
      ]).size,
    ).toBe(0);
  });

  it('ignores sidechains — subagent runs branch by design', () => {
    expect(
      findAbandonedIdxs([
        row({ uuid: 'a', idx: 0, kind: 'assistant' }),
        row({ uuid: 'b', parentUuid: 'a', idx: 1, isSidechain: true }),
        row({ uuid: 'c', parentUuid: 'a', idx: 2, isSidechain: true }),
      ]).size,
    ).toBe(0);
  });
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

  it('skips prompts on abandoned branches — an interrupted attempt is not a turn', () => {
    // Session B forks at b3: "yes draft the rel" (interrupted, with an
    // assistant line under it) and the retyped prompt the session continued on.
    const res = listTurns(db, SESSION_B)!;
    expect(res.turns).toHaveLength(2);
    expect(res.turns.map((t) => t.text)).toEqual([
      'Summarize the changelog since v2.0',
      'yes, draft the release notes grouped by feature',
    ]);
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
