import { useMemo, useState } from 'react';
import { structuredPatch } from 'diff';
import Segmented from '../components/Segmented';
import { setPref, usePref } from '../prefs';
import { toSplitRows, type DiffLine } from './splitDiff';

const COLLAPSED_LINES = 24;

/** 'split' puts before and after side by side; unified is the default. */
export type DiffMode = 'unified' | 'split';

export function useDiffMode(): DiffMode {
  return usePref('diffMode') === 'split' ? 'split' : 'unified';
}

function patchToLines(oldStr: string, newStr: string, path: string): DiffLine[] {
  const patch = structuredPatch(path, path, oldStr, newStr, '', '', { context: 3 });
  const lines: DiffLine[] = [];
  for (const hunk of patch.hunks) {
    lines.push({
      type: 'hunk',
      text: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
      oldNo: null,
      newNo: null,
    });
    let oldNo = hunk.oldStart;
    let newNo = hunk.newStart;
    for (const raw of hunk.lines) {
      const marker = raw[0];
      const text = raw.slice(1);
      if (marker === '+') lines.push({ type: 'add', text, oldNo: null, newNo: newNo++ });
      else if (marker === '-') lines.push({ type: 'del', text, oldNo: oldNo++, newNo: null });
      else lines.push({ type: 'ctx', text, oldNo: oldNo++, newNo: newNo++ });
    }
  }
  return lines;
}

function allAddedLines(content: string): DiffLine[] {
  return content
    .split('\n')
    .map((text, i) => ({ type: 'add' as const, text, oldNo: null, newNo: i + 1 }));
}

export function DiffStats({ lines }: { lines: DiffLine[] }) {
  const adds = lines.filter((l) => l.type === 'add').length;
  const dels = lines.filter((l) => l.type === 'del').length;
  return (
    <span className="diff-stats">
      {adds > 0 && <span className="diff-stat-add">+{adds}</span>}
      {dels > 0 && <span className="diff-stat-del">−{dels}</span>}
    </span>
  );
}

function UnifiedRows({ lines }: { lines: DiffLine[] }) {
  return (
    <table>
      <tbody>
        {lines.map((line, i) => (
          <tr key={i} className={`diff-${line.type}`}>
            <td className="diff-no">{line.oldNo ?? ''}</td>
            <td className="diff-no">{line.newNo ?? ''}</td>
            <td className="diff-sign">
              {line.type === 'add' ? '+' : line.type === 'del' ? '−' : ''}
            </td>
            <td className="diff-text">{line.text}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SplitRows({ lines }: { lines: DiffLine[] }) {
  const rows = useMemo(() => toSplitRows(lines), [lines]);
  return (
    <table className="diff-split">
      <tbody>
        {rows.map((row, i) =>
          row.hunk !== undefined ? (
            <tr key={i} className="diff-hunk">
              <td className="diff-no" />
              <td className="diff-text" colSpan={3}>
                {row.hunk}
              </td>
            </tr>
          ) : (
            <tr key={i}>
              <td className="diff-no">{row.left?.oldNo ?? ''}</td>
              <td className={`diff-text diff-side ${row.left ? `diff-${row.left.type}` : 'diff-none'}`}>
                {row.left?.text ?? ''}
              </td>
              <td className="diff-no">{row.right?.newNo ?? ''}</td>
              <td className={`diff-text diff-side ${row.right ? `diff-${row.right.type}` : 'diff-none'}`}>
                {row.right?.text ?? ''}
              </td>
            </tr>
          ),
        )}
      </tbody>
    </table>
  );
}

function DiffTable({ lines }: { lines: DiffLine[] }) {
  const [expanded, setExpanded] = useState(false);
  const mode = useDiffMode();
  const shown = expanded ? lines : lines.slice(0, COLLAPSED_LINES);
  const hidden = lines.length - shown.length;

  return (
    <div className={`diff ${mode === 'split' ? 'is-split' : ''}`}>
      {mode === 'split' ? <SplitRows lines={shown} /> : <UnifiedRows lines={shown} />}
      {hidden > 0 && (
        <button className="diff-expand" onClick={() => setExpanded(true)}>
          show {hidden} more line{hidden === 1 ? '' : 's'}
        </button>
      )}
      {expanded && lines.length > COLLAPSED_LINES && (
        <button className="diff-expand" onClick={() => setExpanded(false)}>
          collapse
        </button>
      )}
    </div>
  );
}

/** The toggle itself — one control, wherever diffs are the point. */
export function DiffModeToggle() {
  const mode = useDiffMode();
  return (
    <Segmented
      value={mode}
      onChange={(v) => setPref('diffMode', v)}
      options={[
        { value: 'unified', label: 'unified' },
        { value: 'split', label: 'split' },
      ]}
      ariaLabel="Diff layout"
    />
  );
}

export function EditDiff({
  path,
  oldString,
  newString,
}: {
  path: string;
  oldString: string;
  newString: string;
}) {
  const lines = useMemo(() => {
    try {
      return patchToLines(oldString, newString, path);
    } catch {
      return null;
    }
  }, [oldString, newString, path]);
  if (!lines) return null;
  return <DiffTable lines={lines} />;
}

export function WriteDiff({ content }: { content: string }) {
  const lines = useMemo(() => allAddedLines(content), [content]);
  return <DiffTable lines={lines} />;
}
