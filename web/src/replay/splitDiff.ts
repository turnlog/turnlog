/**
 * Unified diff lines → before/after columns. Pure on purpose: the pairing
 * rule is real logic worth testing, and a module that reaches the DOM or the
 * API cannot be imported by the test suite (see thread.ts, same split).
 */

export interface DiffLine {
  type: 'add' | 'del' | 'ctx' | 'hunk';
  text: string;
  oldNo: number | null;
  newNo: number | null;
}

/** One side-by-side row: the same change, before on the left, after on the
 *  right. Either half may be empty where a run of adds and dels is uneven. */
export interface SplitRow {
  left: DiffLine | null;
  right: DiffLine | null;
  hunk?: string;
}

/**
 * Consecutive del/add runs are zipped positionally — del[i] beside add[i] —
 * which is what a reader expects from a replaced block and costs no diff
 * library. Context lines sit on both sides; a hunk header spans the row.
 */
export function toSplitRows(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  for (let i = 0; i < lines.length; ) {
    const line = lines[i]!;
    if (line.type === 'hunk') {
      rows.push({ left: null, right: null, hunk: line.text });
      i += 1;
    } else if (line.type === 'ctx') {
      rows.push({ left: line, right: line });
      i += 1;
    } else {
      const dels: DiffLine[] = [];
      const adds: DiffLine[] = [];
      while (i < lines.length && lines[i]!.type === 'del') dels.push(lines[i++]!);
      while (i < lines.length && lines[i]!.type === 'add') adds.push(lines[i++]!);
      const n = Math.max(dels.length, adds.length);
      for (let k = 0; k < n; k += 1) {
        rows.push({ left: dels[k] ?? null, right: adds[k] ?? null });
      }
    }
  }
  return rows;
}
