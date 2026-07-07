import { useState } from 'react';
import { flattenSessions, useSessions, useStats, useStatus } from '../api';
import { setProjectFilter } from '../filterStore';
import {
  fmtCost,
  fmtCount,
  fmtDate,
  fmtModel,
  fmtTokens,
  projectName,
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
  const name = projectName(s);
  return (
    <li className="recent-row">
      <button className="recent-btn" onClick={() => navigate(sessionHash(s.id))}>
        <span className={`tile tile-sm ${tileClass(s.projectKey)}`}>
          {name[0]?.toUpperCase() ?? '·'}
        </span>
        <span className="recent-main">
          <span className="recent-title">
            {name}
            {s.model && <span className="chip">{fmtModel(s.model)}</span>}
          </span>
          <span className="recent-sub">
            {fmtCost(s.costUsd)} · {fmtCount(s.turnCount)} turns · {fmtDate(s.startedAt)}
          </span>
        </span>
        <span className="circle circle-sm" aria-hidden>
          <ArrowUpRight />
        </span>
      </button>
    </li>
  );
}

export default function Home() {
  const stats = useStats();
  const status = useStatus();
  const recent = useSessions({ sort: 'started_at', dir: 'desc' });
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
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="grep, but for everything your agents ever did…"
            aria-label="Search all sessions"
          />
          <button className="btn-accent" aria-label="Search">
            Search
            <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden>
              <path
                d="M4 12h14M13 6l6 6-6 6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </form>
      </div>

      <div className="bento">
        <section className="card dark-card">
          <div className="dark-card-head">
            <h2>Indexed history</h2>
            <span className="dark-chip">100% local</span>
          </div>
          <div className="dark-numbers">
            <div className="dark-col">
              <span className="dot dot-mint" />
              <em>Sessions</em>
              <strong>{s ? fmtCount(s.sessions) : <Skel w={64} h={30} />}</strong>
            </div>
            <div className="dark-col">
              <span className="dot dot-purple" />
              <em>Turns</em>
              <strong>{s ? fmtCount(s.messages) : <Skel w={96} h={30} />}</strong>
            </div>
            <div className="dark-col">
              <span className="dot dot-accent" />
              <em>Tokens</em>
              <strong>{s ? fmtTokens(s.inputTokens + s.outputTokens) : <Skel w={80} h={30} />}</strong>
            </div>
          </div>
        </section>

        <section className="card accent-card">
          <div className="accent-card-head">
            <h2>Est. spend</h2>
            <a className="circle circle-sm circle-onaccent" href="#/spend" aria-label="Open spend view">
              <ArrowUpRight />
            </a>
          </div>
          <strong className="accent-big">{s ? fmtCost(s.costUsd) : <Skel w={140} h={34} className="skel-onaccent" />}</strong>
          <p>computed locally from the shipped pricing table</p>
        </section>

        <section className="card list-card">
          <div className="list-card-head">
            <h2>Recent sessions</h2>
            <button
              className="see-all"
              onClick={() => window.dispatchEvent(new CustomEvent('turnlog:open-sidebar'))}
            >
              See all
            </button>
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
      </div>
    </div>
  );
}
