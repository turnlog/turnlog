import { useMemo, useState } from 'react';
import { Virtuoso } from 'react-virtuoso';
import {
  flattenSessions,
  useProjects,
  useSessions,
  useStatus,
  type SessionsQuery,
} from './api';
import Dropdown from './components/Dropdown';
import { SkeletonRows } from './components/Skeleton';
import Tooltip from './components/Tooltip';
import { setProjectFilter, useProjectFilter } from './filterStore';
import { fmtCost, fmtCount, fmtDate, fmtModel, fmtTokens, projectName, tileClass } from './format';
import { navigate, sessionHash } from './router';
import type { SessionMeta } from './types';

const SORTS: { value: NonNullable<SessionsQuery['sort']>; label: string }[] = [
  { value: 'started_at', label: 'date' },
  { value: 'cost_usd', label: 'cost' },
  { value: 'turn_count', label: 'turns' },
  { value: 'tokens', label: 'tokens' },
];

function Item({
  s,
  active,
}: {
  s: SessionMeta;
  active: boolean;
}) {
  return (
    <button
      className={`side-item ${active ? 'active' : ''}`}
      onClick={() => navigate(sessionHash(s.id))}
      aria-current={active ? 'page' : undefined}
    >
      <span className={`tile tile-sm ${tileClass(s.projectKey)}`}>
        {projectName(s)[0]?.toUpperCase() ?? '·'}
      </span>
      <span className="side-item-main">
        <span className="side-item-top">
          <span className="side-item-project">{projectName(s)}</span>
          <span className="side-item-cost">{fmtCost(s.costUsd)}</span>
        </span>
        <span className="side-item-sub">
          <span>{fmtDate(s.startedAt)}</span>
          <span>· {fmtCount(s.turnCount)}t</span>
          <span>· {fmtTokens(s.inputTokens + s.outputTokens)} tok</span>
          {s.model && <span className="side-item-model">{fmtModel(s.model)}</span>}
        </span>
      </span>
    </button>
  );
}

export default function Sidebar({ activeId }: { activeId: string | null }) {
  const [sort, setSort] = useState<NonNullable<SessionsQuery['sort']>>('started_at');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const project = useProjectFilter();
  const setProject = setProjectFilter;

  const status = useStatus();
  const projects = useProjects();
  const sessions = useSessions({ sort, dir, project: project || undefined });

  const rows = useMemo(() => flattenSessions(sessions.data), [sessions.data]);
  const total = sessions.data?.pages[0]?.total ?? 0;

  return (
    <aside className="sidebar">
      <div className="sidebar-controls">
        <Dropdown
          value={project}
          onChange={setProject}
          ariaLabel="Filter by project"
          options={[
            { value: '', label: `all projects (${projects.data?.length ?? 0})` },
            ...(projects.data?.map((p) => ({
              value: p.projectKey,
              label: `${projectName(p)} (${p.sessionCount})`,
            })) ?? []),
          ]}
        />
        <div className="sidebar-controls-row">
          <Dropdown
            className="dd-grow"
            value={sort}
            onChange={(v) => setSort(v as typeof sort)}
            ariaLabel="Sort by"
            options={SORTS.map((s) => ({ value: s.value, label: `by ${s.label}` }))}
          />
          <Tooltip content={dir === 'desc' ? 'Newest first' : 'Oldest first'}>
            <button
              className="dir-toggle"
              onClick={() => setDir(dir === 'desc' ? 'asc' : 'desc')}
              aria-label={`Direction: ${dir}`}
            >
              {dir === 'desc' ? '↓' : '↑'}
            </button>
          </Tooltip>
          <span className="sidebar-count">{fmtCount(total)}</span>
        </div>
      </div>

      {rows.length === 0 && sessions.isLoading ? (
        <SkeletonRows n={9} tile={34} />
      ) : rows.length === 0 ? (
        <div className="sidebar-empty">
          {sessions.isError
            ? (sessions.error as Error).message
            : status.data?.state === 'indexing'
              ? 'indexing…'
              : 'no sessions yet'}
        </div>
      ) : (
        <Virtuoso
          className="sidebar-list"
          data={rows}
          endReached={() => {
            if (sessions.hasNextPage && !sessions.isFetchingNextPage) {
              void sessions.fetchNextPage();
            }
          }}
          itemContent={(_i, s) => <Item s={s} active={s.id === activeId} />}
        />
      )}
    </aside>
  );
}
