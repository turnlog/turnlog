import { useMemo, useState } from 'react';
import { Virtuoso } from 'react-virtuoso';
import {
  flattenSessions,
  useProjects,
  useSessions,
  useStatus,
  useTrialOpenIds,
  type SessionsQuery,
} from './api';
import Dropdown from './components/Dropdown';
import { setProjectFilter, useProjectFilter } from './filterStore';
import { fmtCost, fmtCount, fmtDate, fmtModel, projectName, tileClass } from './format';
import { LockIcon } from './icons';
import { navigate, sessionHash } from './router';
import type { SessionMeta } from './types';

const SORTS: { value: NonNullable<SessionsQuery['sort']>; label: string }[] = [
  { value: 'started_at', label: 'date' },
  { value: 'cost_usd', label: 'cost' },
  { value: 'turn_count', label: 'turns' },
];

export function LockGlyph() {
  return <LockIcon className="lock-glyph" size={12} />;
}

function Item({
  s,
  active,
  locked,
}: {
  s: SessionMeta;
  active: boolean;
  locked: boolean;
}) {
  return (
    <button
      className={`side-item ${active ? 'active' : ''} ${locked ? 'locked' : ''}`}
      onClick={() => {
        if (!locked) navigate(sessionHash(s.id));
      }}
      title={
        locked
          ? 'Trial: the 10 newest sessions are open. A license unlocks your full history.'
          : undefined
      }
      aria-disabled={locked}
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
          {locked && <LockGlyph />}
          <span>{fmtDate(s.startedAt)}</span>
          <span>· {fmtCount(s.turnCount)}t</span>
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

  const licensed = status.data?.licensed ?? true;
  const trialOpen = useTrialOpenIds(!licensed);

  const rows = useMemo(() => flattenSessions(sessions.data), [sessions.data]);
  const total = sessions.data?.pages[0]?.total ?? 0;

  const isLocked = (s: SessionMeta): boolean =>
    !licensed && trialOpen.data !== undefined && !trialOpen.data.has(s.id);

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
          <button
            className="dir-toggle"
            onClick={() => setDir(dir === 'desc' ? 'asc' : 'desc')}
            aria-label={`Direction: ${dir}`}
          >
            {dir === 'desc' ? '↓' : '↑'}
          </button>
          <span className="sidebar-count">{fmtCount(total)}</span>
        </div>
        {!licensed && (
          <div className="sidebar-trial">
            <LockGlyph /> trial — 10 newest open
          </div>
        )}
      </div>

      {rows.length === 0 && !sessions.isLoading ? (
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
          itemContent={(_i, s) => (
            <Item s={s} active={s.id === activeId} locked={isLocked(s)} />
          )}
        />
      )}
    </aside>
  );
}
