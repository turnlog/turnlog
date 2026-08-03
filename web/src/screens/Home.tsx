import { useState } from 'react';
import {
  flattenSessions,
  useHealth,
  useMaintenance,
  useSessions,
  useStats,
  useStatus,
} from '../api';
import { setProjectFilter } from '../filterStore';
import Button from '../components/Button';
import Badge from '../components/Badge';
import Primary from '../components/Primary';
import SearchField from '../components/SearchField';
import {
  fmtBytes,
  fmtCost,
  fmtCount,
  fmtDate,
  fmtModel,
  fmtTokens,
  projectName,
  sessionName,
  tileClass,
} from '../format';
import { navigate, searchHash, sessionHash } from '../router';
import { Skel, SkeletonRows } from '../components/Skeleton';
import type { SessionMeta } from '../types';

function ArrowUpRight({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M7 17L17 7M9 7h8v8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RecentRow({ s }: { s: SessionMeta }) {
  const name = sessionName(s);
  const initial = projectName(s);
  return (
    <li className="recent-row">
      <button className="recent-btn" onClick={() => navigate(sessionHash(s.id))}>
        <span className={`tile tile-sm ${tileClass(s.projectKey)}`}>
          {initial[0]?.toUpperCase() ?? '·'}
        </span>
        <span className="recent-main">
          <span className="recent-title">
            {name}
            {s.model && <Badge kind="model">{fmtModel(s.model)}</Badge>}
          </span>
          <span className="recent-sub">
            {fmtCost(s.costUsd)} · {fmtCount(s.turnCount)} turns · {fmtDate(s.startedAt)}
          </span>
        </span>
        <span className="icon-btn" aria-hidden>
          <ArrowUpRight />
        </span>
      </button>
    </li>
  );
}

/**
 * Index health: the parser's cardinal rule (never crash, never drop) made
 * visible — what was indexed, what was kept without being understood, and
 * what could not be read at all.
 */
function HealthCard() {
  const health = useHealth();
  const maintain = useMaintenance();
  const [done, setDone] = useState<string | null>(null);
  const h = health.data;
  if (!h) return null;
  const skipped = h.skipped.length;

  const run = (action: 'prune' | 'vacuum') => {
    setDone(null);
    maintain.mutate(action, {
      onSuccess: (r) => {
        setDone(
          r.action === 'prune'
            ? r.pruned === 0
              ? 'Nothing to forget — every indexed file is still on disk.'
              : `Forgot ${fmtCount(r.pruned ?? 0)} session${r.pruned === 1 ? '' : 's'} whose files are gone.`
            : (r.freedBytes ?? 0) > 0
              ? `Repacked the index — ${fmtBytes(r.freedBytes ?? 0)} freed.`
              : 'Repacked the index; it was already compact.',
        );
      },
      onError: () => setDone('That did not work — the index is unchanged.'),
    });
  };
  return (
    <section className="card health-card">
      <div className="list-card-head">
        <h2>Index health</h2>
        <span className={`health-state ${skipped > 0 ? 'warn' : ''}`}>
          <span className={`dot ${skipped > 0 ? 'dot-error' : 'dot-ok'}`} />
          {skipped > 0
            ? `${fmtCount(skipped)} file${skipped === 1 ? '' : 's'} skipped`
            : 'everything readable is indexed'}
        </span>
      </div>
      <div className="health-facts">
        {fmtCount(h.indexedFiles)} session files · {fmtCount(h.events)} events ·{' '}
        {fmtBytes(h.dbBytes)} index
        {h.missingFiles > 0 && (
          <>
            {' · '}
            <span className="health-missing">
              {fmtCount(h.missingFiles)} file{h.missingFiles === 1 ? '' : 's'} gone from disk —
              prune forgets them
            </span>
          </>
        )}
      </div>
      {h.unknownEvents > 0 && (
        <div className="health-unknown">
          <span className="health-unknown-lead">
            {fmtCount(h.unknownEvents)} unrecognized event
            {h.unknownEvents === 1 ? '' : 's'} — kept raw, shown collapsed:
          </span>
          {h.unknownTypes.map((t) => (
            <Badge key={t.type} className="health-badge">
              {t.type} ×{fmtCount(t.count)}
            </Badge>
          ))}
        </div>
      )}
      {skipped > 0 && (
        <ul className="health-skipped">
          {h.skipped.map((f) => (
            <li key={f.file}>
              <code>{f.file}</code>
              <span>{f.message}</span>
            </li>
          ))}
        </ul>
      )}
      {/* Housekeeping on our own index only — ~/.claude is never written to. */}
      <div className="health-maintain">
        <span className="health-maintain-label">Maintain</span>
        <Button
          className="health-action"
          onClick={() => run('prune')}
          disabled={maintain.isPending}
        >
          forget deleted files
        </Button>
        <Button
          className="health-action"
          onClick={() => run('vacuum')}
          disabled={maintain.isPending}
        >
          repack index
        </Button>
        <span className="health-maintain-note">
          {maintain.isPending ? 'working…' : (done ?? 'Turnlog only ever writes to its own index.')}
        </span>
      </div>
    </section>
  );
}

export default function Home() {
  const stats = useStats();
  const status = useStatus();
  const recent = useSessions({ sort: 'started_at', dir: 'desc', collapseChains: true });
  const [query, setQuery] = useState('');

  const s = stats.data;
  const empty = s !== undefined && s.sessions === 0;
  const recentRows = flattenSessions(recent.data).slice(0, 5);

  if (empty) {
    return (
      <div className="fullscreen-note">
        <div>
          <h1>No sessions indexed yet</h1>
          <p>
            {status.data?.state === 'indexing'
              ? 'Indexing is running — sessions appear as they are parsed.'
              : 'Run Claude Code, then come back. Turnlog watches ~/.claude/projects live.'}
          </p>
        </div>
      </div>
    );
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) navigate(searchHash(query.trim()));
  };

  return (
    <div className="home">
      <div className="hero">
        <h1>
          Find that session.
          <em>
            {s ? fmtCount(s.sessions) : '…'} sessions on record — just ask your history.
          </em>
        </h1>
        <form className="hero-search" onSubmit={submit}>
          <SearchField
            size="lg"
            value={query}
            onChange={setQuery}
            placeholder="grep, but for everything your agents ever did…"
            ariaLabel="Search all sessions"
          />
          <Primary
            fill="accent"
            type="submit"
            trailing={
              <svg viewBox="0 0 24 24" aria-hidden>
                <path
                  d="M4 12h14M13 6l6 6-6 6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            }
          >
            Search
          </Primary>
        </form>
      </div>

      <div className="bento">
        <section className="card dark-card">
          <div className="dark-card-head">
            <h2>Indexed history</h2>
            <span className="dark-badge">100% local</span>
          </div>
          <div className="dark-numbers">
            <div className="dark-col">
              <span className="dot dot-diff" />
              <em>Sessions</em>
              <strong>{s ? fmtCount(s.sessions) : <Skel w={64} h={30} />}</strong>
            </div>
            <div className="dark-col">
              <span className="dot dot-cmd" />
              <em>Turns</em>
              <strong>{s ? fmtCount(s.messages) : <Skel w={96} h={30} />}</strong>
            </div>
            <div className="dark-col">
              <span className="dot dot-error" />
              <em>Tokens</em>
              <strong>{s ? fmtTokens(s.inputTokens + s.outputTokens) : <Skel w={80} h={30} />}</strong>
            </div>
          </div>
        </section>

        <section className="card accent-card">
          <div className="accent-card-head">
            <h2>Est. spend</h2>
            <a className="icon-btn onaccent" href="#/spend" aria-label="Open spend view">
              <ArrowUpRight />
            </a>
          </div>
          <strong className="accent-big">{s ? fmtCost(s.costUsd) : <Skel w={140} h={34} className="skel-onaccent" />}</strong>
          <p>computed locally from the shipped pricing table</p>
        </section>

        <section className="card list-card">
          <div className="list-card-head">
            <h2>Recent sessions</h2>
          </div>
          {recent.isLoading && recentRows.length === 0 ? (
            <SkeletonRows n={4} tile={36} />
          ) : (
            <ul className="recent-list">
              {recentRows.map((r) => (
                <RecentRow key={r.id} s={r} />
              ))}
            </ul>
          )}
        </section>

        <section className="card list-card">
          <div className="list-card-head">
            <h2>Projects</h2>
          </div>
          <ul className="project-list">
            {s?.projects.slice(0, 6).map((p) => (
              <li key={p.projectKey}>
                <button
                  className="project-row"
                  onClick={() => setProjectFilter(p.projectKey)}
                  title="Show in sidebar"
                >
                  <span className={`tile tile-xs ${tileClass(p.projectKey)}`}>
                    {projectName(p)[0]?.toUpperCase() ?? '·'}
                  </span>
                  <span className="project-name">{projectName(p)}</span>
                  <span className="project-count">
                    {fmtCount(p.sessionCount)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <HealthCard />
      </div>
    </div>
  );
}
