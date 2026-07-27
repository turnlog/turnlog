import { describe, expect, it } from 'vitest';
import type { MessageRow } from '../src/server/apiTypes.js';
import { buildBlocks, findAbandoned } from '../web/src/replay/thread.js';

/**
 * The replay's half of branch handling (the server's half is
 * `findAbandonedIdxs`, covered in turns.test.ts). Rows here mirror the shapes
 * real logs produce: one JSONL line per content block, tool results pairing by
 * id, and the occasional interrupted-and-retyped prompt.
 */

function row(o: Partial<MessageRow> & { idx: number; uuid: string }): MessageRow {
  return {
    parentUuid: null,
    role: null,
    kind: 'assistant',
    toolName: null,
    toolUseId: null,
    messageId: null,
    ts: null,
    isSidechain: false,
    isError: false,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: null,
    model: null,
    text: '',
    raw: '{}',
    ...o,
  };
}

/** The real shape from a live log: "in whi" interrupted, then retyped. */
const INTERRUPTED: MessageRow[] = [
  row({ idx: 483, uuid: 'sys', kind: 'system', text: 'turn_duration' }),
  row({ idx: 484, uuid: 'dead', parentUuid: 'sys', kind: 'prompt', text: 'in whi' }),
  row({ idx: 487, uuid: 'live', parentUuid: 'sys', kind: 'prompt', text: 'in which tab?' }),
  row({ idx: 488, uuid: 'a1', parentUuid: 'live', text: 'Untracked land in the working lens.' }),
];

describe('findAbandoned', () => {
  it('marks the interrupted attempt, not the retry', () => {
    expect([...findAbandoned(INTERRUPTED)]).toEqual([484]);
  });

  it('follows the dead branch into its subtree', () => {
    const dead = findAbandoned([
      row({ idx: 0, uuid: 'p' }),
      row({ idx: 1, uuid: 'x', parentUuid: 'p', kind: 'prompt' }),
      row({ idx: 2, uuid: 'x2', parentUuid: 'x' }),
      row({ idx: 3, uuid: 'x3', parentUuid: 'x2', kind: 'tool_use', toolUseId: 't1' }),
      row({ idx: 4, uuid: 'y', parentUuid: 'p', kind: 'prompt' }),
    ]);
    expect([...dead].sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it('leaves one response’s content-block lines alone', () => {
    // CC writes a line per block: same message id, and the tool_result for the
    // first block lands as a sibling of the second. Neither is a branch.
    expect(
      findAbandoned([
        row({ idx: 0, uuid: 'a', kind: 'tool_use', messageId: 'm1', toolUseId: 't1' }),
        row({ idx: 1, uuid: 'b', parentUuid: 'a', kind: 'tool_use', messageId: 'm1' }),
        row({ idx: 2, uuid: 'c', parentUuid: 'a', kind: 'tool_result', toolUseId: 't1' }),
      ]).size,
    ).toBe(0);
  });

  it('ignores sidechain forks — subagent runs branch by design', () => {
    expect(
      findAbandoned([
        row({ idx: 0, uuid: 'a' }),
        row({ idx: 1, uuid: 'b', parentUuid: 'a', kind: 'prompt', isSidechain: true }),
        row({ idx: 2, uuid: 'c', parentUuid: 'a', kind: 'prompt', isSidechain: true }),
      ]).size,
    ).toBe(0);
  });
});

describe('buildBlocks with a branch', () => {
  it('folds the abandoned attempt into its own block, in place', () => {
    const blocks = buildBlocks(INTERRUPTED);
    const kinds = blocks.map((b) => b.kind);
    expect(kinds).toContain('abandoned');

    const abandoned = blocks.find((b) => b.kind === 'abandoned')!;
    expect(abandoned.repIdx).toBe(484);
    expect(abandoned.kind === 'abandoned' && abandoned.run).toHaveLength(1);

    // The dead prompt is gone from the main flow but never dropped.
    const flat = blocks.filter((b) => b.kind === 'message');
    expect(flat.map((b) => (b.kind === 'message' ? b.row.text : ''))).not.toContain('in whi');
    // Position: after the system row it forked from, before the live prompt.
    expect(blocks.map((b) => b.repIdx)).toEqual([483, 484, 487, 488]);
  });

  it('leaves branch-free sessions untouched', () => {
    const plain = [
      row({ idx: 0, uuid: 'p', kind: 'prompt', text: 'hi' }),
      row({ idx: 1, uuid: 'a', parentUuid: 'p', text: 'hello' }),
    ];
    expect(buildBlocks(plain).some((b) => b.kind === 'abandoned')).toBe(false);
  });
});
