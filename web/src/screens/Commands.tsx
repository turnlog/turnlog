import { useEffect, useState } from 'react';
import { useCommandHistory, useCommands } from '../api';
import Badge from '../components/Badge';
import { SkeletonRows } from '../components/Skeleton';
import { fmtDate, fmtTime, projectName, sessionName, tileClass } from '../format';
import { CheckIcon, CopyIcon } from '../icons';
import { commandsHash, navigate, searchHash, sessionHash } from '../router';
import type { CommandRun, SessionMeta } from '../types';
import './files.css';
import './Commands.css';

/**
 * Cross-session command history — the Files screen's pattern on the other
 * big dimension (40% of all tool calls). Left: commands grouped by
 * signature (paths, ids, numbers normalized away), most-run first. Right:
 * the sessions that ran the selected one, each expanding to its verbatim
 * runs with exit status and view-in-session jumps.
 */

const DEBOUNCE_MS = 250;

function CopySample({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard denied — nothing actionable */
    }
  };
  return (
    <button
      className={`copy-prompt ${copied ? 'ok' : ''}`}
      onClick={copy}
      aria-label={copied ? 'Command copied' : 'Copy this command'}
      title={copied ? 'Copied' : 'Copy this command'}
    >
      {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
    </button>
  );
}

function SessionRuns({ session, runs }: { session: SessionMeta; runs: CommandRun[] }) {
  return (
    <>
      {runs.map((run, i) => (
        <section key={run.idx} className="file-entry">
          <header className="file-entry-head">
            <span className="turn-n">{i + 1}</span>
            <Badge kind={run.failed ? 'failed' : 'default'}>
              {run.failed ? 'failed' : 'ran'}
            </Badge>
            <button
              className="file-entry-jump"
              onClick={() => navigate(sessionHash(session.id, { m: run.idx }))}
            >
              view in session ↗
            </button>
            <span className="file-entry-ts">{fmtTime(run.ts)}</span>
          </header>
          <div className="cmd-run">
            <code>{run.command}</code>
            <CopySample text={run.command} />
          </div>
        </section>
      ))}
    </>
  );
}

export default function Commands({ query, sig }: { query: string; sig: string | null }) {
  const [input, setInput] = useState(query);

  // Debounce typing into the URL — the URL is the screen state.
  useEffect(() => {
    if (input === query) return;
    const t = setTimeout(() => {
      window.location.replace(commandsHash({ q: input.trim(), sig: sig ?? undefined }));
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [input, query, sig]);

  const commands = useCommands(query);
  const history = useCommandHistory(sig);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => setOpen(null), [sig]);

  const selected = commands.data?.commands.find((c) => c.signature === sig);

  return (
    <div className="files-wrap">
      <nav className="file-list" aria-label="Commands">
        <div className="fh-search">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Filter commands…"
            aria-label="Filter commands by text"
          />
        </div>
        <div className="outline-title">
          {commands.data
            ? `${commands.data.distinct.toLocaleString()} command${commands.data.distinct === 1 ? '' : 's'} · ${commands.data.totalRuns.toLocaleString()} runs`
            : '…'}
        </div>
        <div className="file-list-items">
          {commands.data?.commands.map((c) => (
            <button
              key={c.signature}
              className={`file-item ${c.signature === sig ? 'active' : ''}`}
              onClick={() => navigate(commandsHash({ q: query, sig: c.signature }))}
              title={c.sample}
            >
              <span className="file-item-name cmd-sig">{c.signature}</span>
              <span className="file-item-meta">
                <span>
                  {c.runs} run{c.runs === 1 ? '' : 's'} ·{' '}
                  {c.sessions} session{c.sessions === 1 ? '' : 's'}
                </span>
                {c.fails > 0 && <span className="cmd-fails">{c.fails} failed</span>}
                {c.lastAt && <span>{fmtDate(c.lastAt)}</span>}
              </span>
            </button>
          ))}
        </div>
      </nav>

      <div className="file-diffs">
        {sig === null ? (
          <div className="fullscreen-note">
            <div>
              <h1>Commands</h1>
              <p>
                Every command your agents ever ran, grouped across sessions —
                pick one on the left, or filter. Paths, ids and numbers are
                normalized away so reruns of the same command group together.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="file-diffs-head">
              <span className="file-diffs-path cmd-sig">{selected?.sample ?? sig}</span>
              {selected && <CopySample text={selected.sample} />}
              <button
                className="file-entry-jump"
                onClick={() => navigate(searchHash(`cmd:"${firstToken(sig)}"`))}
                title="Search sessions running this command"
              >
                search ↗
              </button>
            </div>
            <div className="file-diffs-body">
              {history.isLoading ? (
                <SkeletonRows n={5} tile={26} />
              ) : (
                <>
                  {history.data?.sessions.map(({ session: s, runs }) => (
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
                          <span>
                            {runs.length} run{runs.length === 1 ? '' : 's'}
                          </span>
                          <span>{fmtDate(s.startedAt)}</span>
                        </span>
                      </button>
                      {open === s.id && (
                        <div className="fh-session-body">
                          <SessionRuns session={s} runs={runs} />
                        </div>
                      )}
                    </section>
                  ))}
                  {history.data && history.data.sessions.length === 0 && (
                    <div className="tool-note">no sessions recorded running this command</div>
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

/** The command's head word — a stable, placeholder-free `cmd:` search seed. */
function firstToken(sig: string): string {
  return sig.split(/\s+/, 1)[0] ?? sig;
}
