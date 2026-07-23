import { useEffect, useMemo, useState } from 'react';
import { useFileHistory, useFiles, useLensRows } from '../api';
import { SkeletonRows } from '../components/Skeleton';
import { fmtCost, fmtDate, fmtTime, projectName, sessionName, tileClass } from '../format';
import { dirName, EditBody, fileName, groupByFile } from '../replay/Files';
import { filesHash, navigate, sessionHash } from '../router';
import type { SessionMeta } from '../types';

/**
 * Cross-session file history — "git blame for agent edits". Left: every
 * touched file matching a path fragment. Right: the sessions that touched
 * the selected file, newest first; expanding one loads that session's diffs
 * (client-side, same grouping the replay pivot uses) filtered to this path.
 */

const DEBOUNCE_MS = 250;

function SessionEdits({ session, path }: { session: SessionMeta; path: string }) {
  const rows = useLensRows(session.id, 'diffs');
  const group = useMemo(
    () => groupByFile(rows.data ?? []).find((g) => g.path === path),
    [rows.data, path],
  );
  if (rows.isLoading) return <SkeletonRows n={2} tile={20} />;
  if (!group) {
    return <div className="tool-note">no edit details recorded in this session</div>;
  }
  return (
    <>
      {group.edits.map((edit, i) => (
        <section key={edit.idx} className="file-entry">
          <header className="file-entry-head">
            <span className="turn-n">{i + 1}</span>
            <span className={`chip ${edit.failed ? 'chip-failed' : ''}`}>
              {edit.tool}
              {edit.failed ? ' · failed' : ''}
            </span>
            <button
              className="file-entry-jump"
              onClick={() => navigate(sessionHash(session.id, { m: edit.idx }))}
              title="Open at this point in the session"
            >
              view in session ↗
            </button>
            <span className="file-entry-ts">{fmtTime(edit.ts)}</span>
          </header>
          <EditBody edit={edit} />
        </section>
      ))}
    </>
  );
}

export default function FileHistory({ query, path }: { query: string; path: string | null }) {
  const [input, setInput] = useState(query);

  // Debounce typing into the URL — the URL is the screen state.
  useEffect(() => {
    if (input === query) return;
    const t = setTimeout(() => {
      window.location.replace(filesHash({ q: input.trim(), path: path ?? undefined }));
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [input, query, path]);

  const files = useFiles(query);
  const history = useFileHistory(path);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => setOpen(null), [path]);

  return (
    <div className="files-wrap">
      <nav className="file-list" aria-label="Touched files">
        <div className="fh-search">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Filter by path…"
            aria-label="Filter files by path"
          />
        </div>
        <div className="outline-title">
          {files.data ? `${files.data.length} file${files.data.length === 1 ? '' : 's'}` : '…'}
        </div>
        <div className="file-list-items">
          {files.data?.map((f) => (
            <button
              key={f.path}
              className={`file-item ${f.path === path ? 'active' : ''}`}
              onClick={() => navigate(filesHash({ q: query, path: f.path }))}
              title={f.path}
            >
              <span className="file-item-name">{fileName(f.path)}</span>
              <span className="file-item-dir">{dirName(f.path)}</span>
              <span className="file-item-meta">
                <span>
                  {f.sessions} session{f.sessions === 1 ? '' : 's'}
                </span>
                {f.lastTouched && <span>{fmtDate(f.lastTouched)}</span>}
              </span>
            </button>
          ))}
        </div>
      </nav>

      <div className="file-diffs">
        {path === null ? (
          <div className="fullscreen-note">
            <div>
              <h1>File history</h1>
              <p>
                Every session that ever touched a file, with the edits in order —
                pick a file on the left, or filter by path.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="file-diffs-head">
              <span className="file-diffs-path">{path}</span>
            </div>
            <div className="file-diffs-body">
              {history.isLoading ? (
                <SkeletonRows n={5} tile={26} />
              ) : (
                <>
                  {history.data?.sessions.map((s) => (
                    <section key={s.id} className="fh-session">
                      <button
                        className="fh-session-head"
                        onClick={() => setOpen(open === s.id ? null : s.id)}
                        aria-expanded={open === s.id}
                      >
                        <span className={`tile tile-sm ${tileClass(s.projectKey)}`}>
                          {projectName(s)[0]?.toUpperCase() ?? '·'}
                        </span>
                        <span className="fh-session-name">{sessionName(s)}</span>
                        <span className="fh-session-meta">
                          <span>{fmtDate(s.startedAt)}</span>
                          <span>{fmtCost(s.costUsd)}</span>
                        </span>
                      </button>
                      {open === s.id && (
                        <div className="fh-session-body">
                          <SessionEdits session={s} path={path} />
                        </div>
                      )}
                    </section>
                  ))}
                  {history.data && history.data.sessions.length === 0 && (
                    <div className="tool-note">no sessions recorded touching this file</div>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
