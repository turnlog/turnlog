import { revealSession, useDisk } from '../api';
import { SkeletonRows } from '../components/Skeleton';
import Tooltip from '../components/Tooltip';
import { fmtBytes, fmtDate, projectName, sessionName, tileClass } from '../format';
import { FolderIcon } from '../icons';
import { navigate, sessionHash } from '../router';

/**
 * Disk usage: sessions ranked by on-disk bytes (subagent transcript files
 * rolled into their parent) — "what's eating my ~/.claude". Deliberately
 * read-only: Turnlog never deletes another tool's files, so the affordance
 * here is reveal-in-file-manager and the user deletes by hand.
 */
export default function Disk() {
  const disk = useDisk();
  const d = disk.data;
  if (!d) return <SkeletonRows n={8} tile={28} />;

  const max = d.sessions[0]?.bytes ?? 1;

  return (
    <div className="disk">
      <div className="disk-total">
        <strong>{fmtBytes(d.totalBytes)}</strong>
        <span>
          across {d.fileCount} session file{d.fileCount === 1 ? '' : 's'} — largest first
        </span>
      </div>
      <section className="card disk-list">
        {d.sessions.map((s) => (
          <div key={s.id} className="disk-row">
            <div
              className="disk-row-bar"
              style={{ width: `${Math.max((s.bytes / max) * 100, 0.5)}%` }}
              aria-hidden
            />
            <button
              className="disk-row-main"
              onClick={() => navigate(sessionHash(s.id))}
              title="Open session"
            >
              <span className={`tile tile-sm ${tileClass(s.projectKey)}`}>
                {projectName(s)[0]?.toUpperCase() ?? '·'}
              </span>
              <span className="disk-row-name">{sessionName(s)}</span>
              <span className="disk-row-date">{fmtDate(s.startedAt)}</span>
              <span className="disk-row-bytes">{fmtBytes(s.bytes)}</span>
            </button>
            <Tooltip content="Show the session file in your file manager">
              <button
                className="disk-row-reveal"
                onClick={() => revealSession(s.id)}
                aria-label="Show session file in file manager"
              >
                <FolderIcon size={15} />
              </button>
            </Tooltip>
          </div>
        ))}
      </section>
      <p className="disk-note">
        Turnlog never deletes session files. To reclaim space, reveal a file and delete it
        yourself — it stays in the index until the next{' '}
        <code>turnlog index --rebuild</code>.
      </p>
    </div>
  );
}
