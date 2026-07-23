import { useEffect, useMemo, useState } from 'react';
import { useLensRows } from '../api';
import { SkeletonRows } from '../components/Skeleton';
import { fmtTime } from '../format';
import { filesHash, navigate, sessionHash } from '../router';
import type { MessageRow } from '../types';
import { EditDiff, WriteDiff } from './DiffView';
import { parseRaw } from './raw';
import { buildBlocks, type Block } from './thread';

/**
 * The outcome pivot (brainstorm §4d): not the conversation — what the
 * session did to the code. Files on the left, that file's edits in order
 * on the right. Grouping happens client-side from the diffs lens, so no
 * schema or endpoint was needed.
 */

export interface FileEdit {
  idx: number;
  ts: string | null;
  tool: string;
  input: Record<string, unknown>;
  failed: boolean;
}

export interface FileGroup {
  path: string;
  edits: FileEdit[];
  errors: number;
  firstIdx: number;
}

export function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

export function fileName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function dirName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 1 ? `${parts.slice(-3, -1).join('/')}/` : '';
}

export function groupByFile(rows: MessageRow[]): FileGroup[] {
  const blocks = buildBlocks(rows);
  const groups = new Map<string, FileGroup>();

  const visit = (block: Block) => {
    if (block.kind === 'orphan-run') {
      block.run.forEach(visit);
      return;
    }
    if (block.kind !== 'tool') return;
    block.run?.forEach(visit);

    const view = parseRaw(block.use);
    const use =
      view.toolUses.find((t) => t.id === block.use.toolUseId) ?? view.toolUses[0];
    if (!use) return;
    const path = str(use.input.file_path) ?? str(use.input.notebook_path);
    if (!path) return;

    const failed = block.result ? parseRaw(block.result).toolResults[0]?.isError === true : false;
    let group = groups.get(path);
    if (!group) {
      group = { path, edits: [], errors: 0, firstIdx: block.use.idx };
      groups.set(path, group);
    }
    group.edits.push({
      idx: block.use.idx,
      ts: block.use.ts,
      tool: use.name,
      input: use.input,
      failed,
    });
    if (failed) group.errors++;
  };

  blocks.forEach(visit);
  return [...groups.values()].sort((a, b) => a.firstIdx - b.firstIdx);
}

export function EditBody({ edit }: { edit: FileEdit }) {
  const path = str(edit.input.file_path) ?? '';
  switch (edit.tool) {
    case 'Edit': {
      const oldS = str(edit.input.old_string);
      const newS = str(edit.input.new_string);
      if (oldS !== null && newS !== null) {
        return <EditDiff path={path} oldString={oldS} newString={newS} />;
      }
      break;
    }
    case 'MultiEdit': {
      if (Array.isArray(edit.input.edits)) {
        return (
          <>
            {edit.input.edits.map((e, i) => {
              const item = e as { old_string?: unknown; new_string?: unknown };
              const oldS = str(item.old_string);
              const newS = str(item.new_string);
              return oldS !== null && newS !== null ? (
                <EditDiff key={i} path={path} oldString={oldS} newString={newS} />
              ) : null;
            })}
          </>
        );
      }
      break;
    }
    case 'Write': {
      const content = str(edit.input.content);
      if (content !== null) return <WriteDiff content={content} />;
      break;
    }
    default:
      break;
  }
  return <div className="tool-note">{edit.tool} — open in session for details</div>;
}

export default function FilesView({ sessionId }: { sessionId: string }) {
  const rows = useLensRows(sessionId, 'diffs');
  const groups = useMemo(() => groupByFile(rows.data ?? []), [rows.data]);
  const [selected, setSelected] = useState<string | null>(null);

  // Select the first file once groups arrive (or keep a still-valid choice).
  useEffect(() => {
    if (groups.length === 0) return;
    setSelected((prev) =>
      prev !== null && groups.some((g) => g.path === prev) ? prev : groups[0]!.path,
    );
  }, [groups]);

  if (rows.isLoading) return <SkeletonRows n={8} tile={28} />;

  if (groups.length === 0) {
    return (
      <div className="fullscreen-note">
        <div>
          <h1>No files touched</h1>
          <p>This session made no Edit/Write tool calls — nothing to pivot on.</p>
        </div>
      </div>
    );
  }

  const current = groups.find((g) => g.path === selected) ?? groups[0]!;

  return (
    <div className="files-wrap">
      <nav className="file-list" aria-label="Touched files">
        <div className="outline-title">
          {groups.length} file{groups.length === 1 ? '' : 's'} touched
        </div>
        <div className="file-list-items">
          {groups.map((g) => (
            <button
              key={g.path}
              className={`file-item ${g.path === current.path ? 'active' : ''}`}
              onClick={() => setSelected(g.path)}
              title={g.path}
            >
              <span className="file-item-name">{fileName(g.path)}</span>
              <span className="file-item-dir">{dirName(g.path)}</span>
              <span className="file-item-meta">
                <span className="m-edits">
                  {g.edits.length} edit{g.edits.length === 1 ? '' : 's'}
                </span>
                {g.errors > 0 && <span className="m-errors">{g.errors} failed</span>}
              </span>
            </button>
          ))}
        </div>
      </nav>

      <div className="file-diffs">
        <div className="file-diffs-head">
          <span className="file-diffs-path">{current.path}</span>
          <a
            className="file-entry-jump fh-head-link"
            href={filesHash({ path: current.path })}
            title="Every session that touched this file"
          >
            history across sessions ↗
          </a>
        </div>
        <div className="file-diffs-body">
          {current.edits.map((edit, i) => (
            <section key={edit.idx} className="file-entry">
              <header className="file-entry-head">
                <span className="turn-n">{i + 1}</span>
                <span className={`chip ${edit.failed ? 'chip-failed' : ''}`}>
                  {edit.tool}
                  {edit.failed ? ' · failed' : ''}
                </span>
                <button
                  className="file-entry-jump"
                  onClick={() => navigate(sessionHash(sessionId, { m: edit.idx }))}
                  title="Open at this point in the session"
                >
                  view in session ↗
                </button>
                <span className="file-entry-ts">{fmtTime(edit.ts)}</span>
              </header>
              <EditBody edit={edit} />
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
