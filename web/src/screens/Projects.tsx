import { useMemo, useState } from 'react';
import { useProjects } from '../api';
import AgentBadge from '../components/AgentBadge';
import SearchField from '../components/SearchField';
import Segmented from '../components/Segmented';
import { SkeletonRows } from '../components/Skeleton';
import { fmtCost, fmtCount, fmtDate, projectName, tileClass } from '../format';
import { navigate, projectHash } from '../router';
import type { ProjectInfo } from '../types';

/**
 * Every repo you have pointed an agent at.
 *
 * Project pages existed before this did, reachable only if you already knew
 * to search for one — which makes them a secret, not a screen. This is the
 * front door: the list, ordered the way you actually think about repos
 * (what did I touch last), with the agents that worked on each one visible
 * because that is the thing no single-vendor tool can show.
 */

type Sort = 'recent' | 'sessions' | 'cost';

function ProjectCard({ p }: { p: ProjectInfo }) {
  const name = projectName(p);
  return (
    <li>
      <button className="pj-card" onClick={() => navigate(projectHash(p.projectKey))}>
        <span className="pj-top">
          <span className={`tile tile-sm ${tileClass(p.projectKey)}`}>
            {name[0]?.toUpperCase() ?? '·'}
          </span>
          <span className="pj-names">
            <span className="pj-name">{name}</span>
            {p.projectPath && <span className="pj-path">{p.projectPath}</span>}
          </span>
        </span>
        <span className="pj-agents">
          {p.agents.map((tool) => (
            <AgentBadge key={tool} tool={tool} />
          ))}
        </span>
        <span className="pj-figures">
          <span>
            <em>sessions</em> {fmtCount(p.sessionCount)}
          </span>
          <span>
            <em>spend</em> {fmtCost(p.costUsd)}
          </span>
          <span>
            <em>last</em> {fmtDate(p.lastActiveAt)}
          </span>
        </span>
      </button>
    </li>
  );
}

export default function Projects() {
  const projects = useProjects();
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<Sort>('recent');

  const rows = useMemo(() => {
    const list = [...(projects.data ?? [])];
    const q = filter.trim().toLowerCase();
    const matched =
      q === ''
        ? list
        : list.filter((p) =>
            `${projectName(p)} ${p.projectPath ?? ''} ${p.projectKey}`.toLowerCase().includes(q),
          );
    return matched.sort((a, b) => {
      if (sort === 'sessions') return b.sessionCount - a.sessionCount;
      if (sort === 'cost') return b.costUsd - a.costUsd;
      // Recency: a repo with no dated sessions sorts last rather than first.
      return (b.lastActiveAt ?? '').localeCompare(a.lastActiveAt ?? '');
    });
  }, [projects.data, filter, sort]);

  return (
    <div className="projects-screen">
      <header className="pj-head">
        <div>
          <h1>Projects</h1>
          <p className="pj-lede">
            Every repo you&rsquo;ve pointed an agent at — and which agents those were.
          </p>
        </div>
        <div className="screen-controls">
          <SearchField
            value={filter}
            onChange={setFilter}
            placeholder="Filter projects…"
            ariaLabel="Filter projects"
          />
          <Segmented
            fill="card"
            ariaLabel="Sort projects"
            value={sort}
            onChange={setSort}
            options={[
              { value: 'recent', label: 'recent' },
              { value: 'sessions', label: 'sessions' },
              { value: 'cost', label: 'spend' },
            ]}
          />
        </div>
      </header>

      {projects.isLoading ? (
        <SkeletonRows n={6} tile={34} />
      ) : rows.length === 0 ? (
        <div className="fullscreen-note">
          {filter.trim() !== '' ? 'No project matches that.' : 'No projects indexed yet.'}
        </div>
      ) : (
        <ul className="pj-list">
          {rows.map((p) => (
            <ProjectCard key={p.projectKey} p={p} />
          ))}
        </ul>
      )}
    </div>
  );
}
