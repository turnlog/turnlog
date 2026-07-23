import { useMemo, useState } from 'react';
import { Virtuoso } from 'react-virtuoso';
import {
  flattenSessions,
  useProjects,
  useSessions,
  useSetSessionMeta,
  useStatus,
  type SessionsQuery,
} from './api';
import Dropdown from './components/Dropdown';
import NoteDot from './components/NoteDot';
import { SkeletonRows } from './components/Skeleton';
import Tooltip from './components/Tooltip';
import {
  Brandmark,
  EyeClosedIcon,
  EyeIcon,
  PinFilledIcon,
  PinIcon,
  SidebarIcon,
  SortVerticalIcon,
} from './icons';
import { setHideEmpty, setProjectFilter, useHideEmpty, useProjectFilter } from './filterStore';
import {
  fmtCost,
  fmtCount,
  fmtDate,
  fmtModel,
  fmtTokens,
  projectName,
  sessionName,
  tileClass,
} from './format';
import { navigate, sessionHash } from './router';
import type { SessionMeta } from './types';

const SORTS: { value: NonNullable<SessionsQuery['sort']>; label: string }[] = [
  { value: 'ended_at', label: 'activity' },
  { value: 'started_at', label: 'date' },
  { value: 'cost_usd', label: 'cost' },
  { value: 'turn_count', label: 'turns' },
  { value: 'tokens', label: 'tokens' },
];

/** A session whose last record is this recent is treated as running now. */
const ACTIVE_MS = 5 * 60_000;

function Item({
  s,
  active,
  onTogglePin,
}: {
  s: SessionMeta;
  active: boolean;
  onTogglePin: (s: SessionMeta) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      className={`side-item ${active ? 'active' : ''} ${s.pinned ? 'pinned' : ''}`}
      onClick={() => navigate(sessionHash(s.id))}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          navigate(sessionHash(s.id));
        }
      }}
      aria-current={active ? 'page' : undefined}
    >
      <span className={`tile tile-sm ${tileClass(s.projectKey)}`}>
        {projectName(s)[0]?.toUpperCase() ?? '·'}
      </span>
      <span className="side-item-main">
        <span className="side-item-top">
          <span className="side-item-project">{sessionName(s)}</span>
          {s.endedAt !== null && Date.now() - new Date(s.endedAt).getTime() < ACTIVE_MS && (
            <span className="side-item-live" role="img" aria-label="active in the last 5 minutes" />
          )}
          {s.note && <NoteDot note={s.note} />}
          <Tooltip content={s.pinned ? 'Unpin' : 'Pin to top'}>
            <button
              className={`side-item-pin ${s.pinned ? 'pinned' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                onTogglePin(s);
              }}
              aria-label={s.pinned ? 'Unpin session' : 'Pin session to top'}
              aria-pressed={s.pinned}
            >
              {s.pinned ? <PinFilledIcon size={13} /> : <PinIcon size={13} />}
            </button>
          </Tooltip>
          <span className="side-item-cost">{fmtCost(s.costUsd)}</span>
        </span>
        <span className="side-item-sub">
          <span>{fmtDate(s.startedAt)}</span>
          <span>· {fmtCount(s.turnCount)}t</span>
          <span>· {fmtTokens(s.inputTokens + s.outputTokens)} tok</span>
          {s.model && <span className="side-item-model">{fmtModel(s.model)}</span>}
        </span>
      </span>
    </div>
  );
}

export default function Sidebar({
  activeId,
  onToggle,
}: {
  activeId: string | null;
  onToggle: () => void;
}) {
  // Activity first: the most recently touched session is the one you want.
  const [sort, setSort] = useState<NonNullable<SessionsQuery['sort']>>('ended_at');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const hideEmpty = useHideEmpty();
  const project = useProjectFilter();
  const setProject = setProjectFilter;

  const status = useStatus();
  const projects = useProjects();
  const sessions = useSessions({ sort, dir, project: project || undefined, hideEmpty });

  const rows = useMemo(() => flattenSessions(sessions.data), [sessions.data]);
  const total = sessions.data?.pages[0]?.total ?? 0;
  const setMeta = useSetSessionMeta();
  const togglePin = (s: SessionMeta) => setMeta.mutate({ id: s.id, patch: { pinned: !s.pinned } });

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <Tooltip content="Hide sessions">
          <button className="circle circle-active" onClick={onToggle} aria-label="Hide sessions">
            <SidebarIcon size={17} />
          </button>
        </Tooltip>
        <a href="#/" className="header-brand" aria-label="Turnlog — overview">
          <Brandmark />
          <span className="header-title">
            Turnlog
            <em>Search &amp; replay</em>
          </span>
        </a>
      </div>
      <div className="sidebar-controls">
        <div className="sidebar-controls-row">
          <Dropdown
            className="dd-grow"
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
          <span className="sidebar-count">{fmtCount(total)}</span>
        </div>
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
              className={`dir-toggle ${dir === 'asc' ? 'asc' : ''}`}
              onClick={() => setDir(dir === 'desc' ? 'asc' : 'desc')}
              aria-label={`Direction: ${dir}`}
            >
              <SortVerticalIcon size={16} />
            </button>
          </Tooltip>
          {/* The eye is the state: open = empty sessions shown, closed = hidden. */}
          <Tooltip content={hideEmpty ? 'Show empty sessions' : 'Hide empty sessions'}>
            <button
              className={`dir-toggle eye-toggle ${hideEmpty ? 'on' : ''}`}
              onClick={() => setHideEmpty(!hideEmpty)}
              aria-label={hideEmpty ? 'Show empty sessions' : 'Hide empty sessions'}
              aria-pressed={hideEmpty}
            >
              {hideEmpty ? <EyeClosedIcon size={16} /> : <EyeIcon size={16} />}
            </button>
          </Tooltip>
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
          itemContent={(_i, s) => (
            <Item s={s} active={s.id === activeId} onTogglePin={togglePin} />
          )}
        />
      )}
    </aside>
  );
}
