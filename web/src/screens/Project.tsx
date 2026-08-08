import { useLive, useProject, useSessions } from '../api';
import AgentBadge from '../components/AgentBadge';
import Badge from '../components/Badge';
import IconButton from '../components/IconButton';
import { SkeletonRows } from '../components/Skeleton';
import Tooltip from '../components/Tooltip';
import { fmtCost, fmtCount, fmtDate, fmtTokens, sessionName } from '../format';
import { CodeFileIcon, MagniferIcon } from '../icons';
import { filesHash, navigate, searchHash, sessionHash } from '../router';
import type { SessionMeta } from '../types';

/**
 * One repo, every agent that touched it.
 *
 * The cross-agent promise ("one timeline of every agent you've pointed at a
 * repo") was true but had no address: it lived as a filter on three separate
 * screens. This makes it a place you can link to. Everything here is an
 * existing query — the point is the assembly, not new data.
 *
 * Named from the path's last segment like everywhere else, so a project reads
 * as the repo you call it, not as the munged key the index stores.
 */

function projectTitle(projectPath: string | null, projectKey: string): string {
  if (projectPath && projectPath !== '') {
    const parts = projectPath.split(/[\\/]/).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1]!;
  }
  const segs = projectKey.split('-').filter(Boolean);
  return segs.length > 0 ? segs[segs.length - 1]! : '(unknown)';
}

function fileName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1]! : p;
}

function SessionRow({ s }: { s: SessionMeta }) {
  return (
    <li className="proj-row">
      <button className="proj-row-btn" onClick={() => navigate(sessionHash(s.id))}>
        <span className="proj-row-main">
          <AgentBadge tool={s.tool} />
          <span className="proj-row-title">{sessionName(s)}</span>
        </span>
        <span className="proj-row-meta">
          <span>{fmtDate(s.startedAt)}</span>
          <span>{fmtCount(s.eventCount)} events</span>
          <span>{fmtCost(s.costUsd)}</span>
        </span>
      </button>
    </li>
  );
}

export default function Project({ projectKey }: { projectKey: string }) {
  const project = useProject(projectKey);
  const sessions = useSessions({ project: projectKey, collapseChains: true });
  const live = useLive();

  const rows = sessions.data?.pages.flatMap((p) => p.sessions) ?? [];
  const p = project.data;
  // A live session in THIS repo — the Now card's question, scoped to the page
  // you are on. Absent most of the time, which is the point.
  const running = (live.data?.sessions ?? []).filter((s) => s.projectKey === projectKey);

  if (project.isError) {
    return (
      <div className="project-screen">
        <div className="fullscreen-note">
          No project by that name is indexed. <a href="#/">Back to sessions</a>
        </div>
      </div>
    );
  }

  const title = p ? projectTitle(p.projectPath, p.projectKey) : '…';

  return (
    <div className="project-screen">
      <header className="proj-head">
        <div className="proj-head-main">
          <h1>{title}</h1>
          {p?.projectPath && (
            <p className="proj-path">
              {p.projectPath}
              {/* The history is safe either way — it lives in the agent's own
                  data dir, not the repo. Saying so beats a path that quietly
                  points nowhere. */}
              {p.pathExists === false && (
                <Tooltip content="The folder is gone or moved. These sessions are still complete — agent logs live outside the repo.">
                  <span className="proj-path-gone">not on disk</span>
                </Tooltip>
              )}
            </p>
          )}
        </div>
        <div className="proj-head-actions">
          <Tooltip content="Search inside this project">
            <IconButton
              label={`Search within ${title}`}
              onClick={() => navigate(searchHash(`project:${projectKey}`))}
            >
              <MagniferIcon size={16} />
            </IconButton>
          </Tooltip>
        </div>
      </header>

      {p && (
        <>
          <div className="stat-strip proj-stats">
            <div className="stat-tile">
              <div className="stat-value">{fmtCount(p.sessionCount)}</div>
              <div className="stat-label">sessions</div>
            </div>
            <div className="stat-tile">
              <div className="stat-value">{fmtCount(p.eventCount)}</div>
              <div className="stat-label">events</div>
            </div>
            <div className="stat-tile">
              <div className="stat-value">{fmtTokens(p.inputTokens + p.outputTokens)}</div>
              <div className="stat-label">tokens</div>
            </div>
            <div className="stat-tile">
              <div className="stat-value">{fmtCost(p.costUsd)}</div>
              <div className="stat-label">est. spend</div>
            </div>
            <div className="stat-tile">
              <div className="stat-value">{fmtDate(p.firstAt)}</div>
              <div className="stat-sub">to {fmtDate(p.lastAt)}</div>
              <div className="stat-label">active</div>
            </div>
          </div>

          {/* The differentiator, stated: who worked here, and how much. */}
          <div className="proj-agents">
            {p.agents.map((a) => (
              <button
                key={a.tool}
                className="proj-agent"
                onClick={() => navigate(searchHash(`project:${projectKey} agent:${a.tool}`))}
                title={`Search ${a.tool} sessions in this project`}
              >
                <AgentBadge tool={a.tool} />
                <span className="proj-agent-n">{fmtCount(a.sessions)}</span>
              </button>
            ))}
            {p.tags.length > 0 && (
              <span className="proj-tags">
                {p.tags.map((t) => (
                  <button
                    key={t.tag}
                    className="tag-badge-row proj-tag"
                    onClick={() => navigate(searchHash(`project:${projectKey} tag:"${t.tag}"`))}
                  >
                    {t.tag}
                    <em>{t.count}</em>
                  </button>
                ))}
              </span>
            )}
          </div>
        </>
      )}

      {running.length > 0 && (
        <section className="card proj-live">
          <div className="list-card-head">
            <h2>
              <span className="now-pulse" aria-hidden />
              Running here now
            </h2>
          </div>
          <ul className="now-list">
            {running.map((s) => (
              <li key={s.id}>
                <button className="now-row" onClick={() => navigate(sessionHash(s.id))}>
                  <span className="now-row-top">
                    <AgentBadge tool={s.tool} />
                    <span className="now-project">{s.name || title}</span>
                    <span className="now-figures">
                      <span>
                        <em>events</em> {fmtCount(s.eventCount)}
                      </span>
                      <span>
                        <em>cost</em> {fmtCost(s.costUsd)}
                      </span>
                    </span>
                  </span>
                  {s.lastPrompt && <span className="now-prompt">{s.lastPrompt}</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="proj-body">
        <section className="card proj-sessions">
          <div className="list-card-head">
            <h2>Sessions</h2>
            <span className="proj-note">every agent, newest first</span>
          </div>
          {sessions.isLoading && rows.length === 0 ? (
            <SkeletonRows n={6} tile={30} />
          ) : rows.length === 0 ? (
            <div className="tool-note">no sessions in this project</div>
          ) : (
            <>
              <ul className="proj-list">
                {rows.map((s) => (
                  <SessionRow key={s.id} s={s} />
                ))}
              </ul>
              {sessions.hasNextPage && (
                <button
                  className="clamp-toggle proj-more"
                  onClick={() => void sessions.fetchNextPage()}
                  disabled={sessions.isFetchingNextPage}
                >
                  {sessions.isFetchingNextPage ? 'loading…' : 'show more'}
                </button>
              )}
            </>
          )}
        </section>

        <section className="card proj-files">
          <div className="list-card-head">
            <h2>Most-touched files</h2>
          </div>
          {!p ? (
            <SkeletonRows n={5} tile={20} />
          ) : p.topFiles.length === 0 ? (
            <div className="tool-note">no file edits recorded in this project</div>
          ) : (
            <ul className="proj-files-list">
              {p.topFiles.map((f) => (
                <li key={f.path}>
                  <button
                    className="proj-file"
                    onClick={() => navigate(filesHash({ path: f.path }))}
                    title={f.path}
                  >
                    <CodeFileIcon size={14} />
                    <span className="proj-file-name">{fileName(f.path)}</span>
                    <Badge>{fmtCount(f.sessions)}</Badge>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
