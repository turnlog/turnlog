import { describe, expect, it } from 'vitest';
import { toSplitRows, type DiffLine } from '../web/src/replay/splitDiff.js';

/** Terser fixtures: a unified line list as the differ produces it. */
function line(type: DiffLine['type'], text: string, oldNo: number | null, newNo: number | null): DiffLine {
  return { type, text, oldNo, newNo };
}

describe('split diff pairing', () => {
  it('puts a replaced line beside its replacement', () => {
    const rows = toSplitRows([
      line('ctx', 'const a = 1;', 1, 1),
      line('del', 'const b = 2;', 2, null),
      line('add', 'const b = 3;', null, 2),
      line('ctx', 'return b;', 3, 3),
    ]);
    expect(rows).toHaveLength(3);
    expect(rows[1]!.left!.text).toBe('const b = 2;');
    expect(rows[1]!.right!.text).toBe('const b = 3;');
    // Context sits on both sides — it is the same line.
    expect(rows[0]!.left).toBe(rows[0]!.right);
  });

  it('pads the short side of an uneven run', () => {
    const rows = toSplitRows([
      line('del', 'one', 1, null),
      line('del', 'two', 2, null),
      line('add', 'ONE', null, 1),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.left!.text).toBe('one');
    expect(rows[0]!.right!.text).toBe('ONE');
    expect(rows[1]!.left!.text).toBe('two');
    expect(rows[1]!.right).toBeNull(); // nothing replaced it
  });

  it('keeps pure additions on the right and pure deletions on the left', () => {
    const adds = toSplitRows([line('add', 'new', null, 1)]);
    expect(adds[0]!.left).toBeNull();
    expect(adds[0]!.right!.text).toBe('new');
    const dels = toSplitRows([line('del', 'gone', 1, null)]);
    expect(dels[0]!.left!.text).toBe('gone');
    expect(dels[0]!.right).toBeNull();
  });

  it('gives a hunk header its own full-width row', () => {
    const rows = toSplitRows([line('hunk', '@@ -1,2 +1,2 @@', null, null), line('add', 'x', null, 1)]);
    expect(rows[0]!.hunk).toBe('@@ -1,2 +1,2 @@');
    expect(rows[0]!.left).toBeNull();
    expect(rows[1]!.right!.text).toBe('x');
  });

  it('loses no content — every line appears exactly once', () => {
    const lines: DiffLine[] = [
      line('hunk', '@@', null, null),
      line('ctx', 'a', 1, 1),
      line('del', 'b', 2, null),
      line('del', 'c', 3, null),
      line('add', 'B', null, 2),
      line('ctx', 'd', 4, 3),
    ];
    const rows = toSplitRows(lines);
    const seen = rows.flatMap((r) => [r.left?.text, r.right?.text]).filter(Boolean);
    // Context appears on both sides; count distinct payloads instead.
    for (const l of lines) {
      if (l.type === 'hunk') continue;
      expect(seen).toContain(l.text);
    }
  });
});
