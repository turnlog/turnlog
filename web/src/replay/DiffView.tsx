import { useMemo, useState } from 'react';
import { structuredPatch } from 'diff';

const COLLAPSED_LINES = 24;

interface DiffLine {
  type: 'add' | 'del' | 'ctx' | 'hunk';
  text: string;
  oldNo: number | null;
  newNo: number | null;
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

function DiffTable({ lines }: { lines: DiffLine[] }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? lines : lines.slice(0, COLLAPSED_LINES);
  const hidden = lines.length - shown.length;

  return (
    <div className="diff">
      <table>
        <tbody>
          {shown.map((line, i) => (
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
