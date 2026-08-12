import { useEffect, useMemo, useRef, useState } from 'react';
import { Virtuoso } from 'react-virtuoso';
import {
  flattenSessions,
  useProjects,
  useSessions,
  useSetSessionMeta,
  useStatus,
  useTags,
  type SessionsQuery,
} from './api';
import Badge from './components/Badge';
import Dropdown from './components/Dropdown';
import Facts from './components/Facts';
import IconButton from './components/IconButton';
import NoteDot from './components/NoteDot';
import Primary from './components/Primary';
import SearchField from './components/SearchField';
import Segmented from './components/Segmented';
import { SkeletonRows } from './components/Skeleton';
import AgentBadge from './components/AgentBadge';
import Tooltip from './components/Tooltip';
import { SHORTCUTS } from './keys';
import {
  Brandmark,
  HistoryIcon,
  PinFilledIcon,
  InfoIcon,
  PinIcon,
  SidebarIcon,
  SortVerticalIcon,
  TuningIcon,
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
  { value: 'event_count', label: 'events' },
  { value: 'tokens', label: 'tokens' },
  // Derived, not asked for: length, cost, errors and file-reach percentile
  // ranks summed server-side — "my important sessions" without homework.
  { value: 'notable', label: 'notable' },
];

/** Tags shown on a sidebar row before the rest collapse into a +N chip. */
const ROW_TAGS = 3;

/**
 * A row's headline figure is whatever the list is sorted by — sort by cost
 * and you read costs, sort by tokens and you read tokens. Sorting by a number
 * you cannot see makes the order look arbitrary.
 *
 * Everything else moves behind the row's info button, so the row carries one
 * figure instead of four.
 */
type Facts = { label: string; value: string }[];

function sessionFacts(s: SessionMeta): Record<string, { value: string; label: string }> {
  return {
    ended_at: { value: fmtDate(s.endedAt ?? s.startedAt), label: 'last activity' },
    started_at: { value: fmtDate(s.startedAt), label: 'started' },
    cost_usd: { value: fmtCost(s.costUsd), label: 'cost' },
    event_count: { value: fmtCount(s.eventCount), label: 'events' },
    tokens: { value: `${fmtTokens(s.inputTokens + s.outputTokens)} tok`, label: 'tokens' },
  };
}

/** A session whose last record is this recent is treated as running now. */
const ACTIVE_MS = 5 * 60_000;

/** One rule, read by the open row and the collapsed tile alike. */
function isLive(s: SessionMeta): boolean {
  return s.endedAt !== null && Date.now() - new Date(s.endedAt).getTime() < ACTIVE_MS;
}

function Item({
  s,
  active,
  sort,
  onTogglePin,
}: {
  s: SessionMeta;
  active: boolean;
  sort: string;
  onTogglePin: (s: SessionMeta) => void;
}) {
  const facts = sessionFacts(s);
  const primary = facts[sort] ?? facts.ended_at!;
  const rest: Facts = Object.entries(facts)
    .filter(([key]) => key !== sort)
    // started and last-activity are the same fact twice on most sessions;
    // only show the one the sort is not already using when they differ.
    .filter(([key]) => !(key === 'started_at' && sort === 'ended_at'))
    .map(([, f]) => ({ label: f.label, value: f.value }));
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
          {isLive(s) && (
            <span className="side-item-live" role="img" aria-label="active in the last 5 minutes" />
          )}
          {s.note && <NoteDot note={s.note} />}
          <IconButton
            fill="ghost"
            label={s.pinned ? 'Unpin session' : 'Pin session to top'}
            tooltip={s.pinned ? 'Unpin' : 'Pin to top'}
            className="side-item-pin"
            active={s.pinned}
            aria-pressed={s.pinned}
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin(s);
            }}
          >
            {s.pinned ? <PinFilledIcon size={13} /> : <PinIcon size={13} />}
          </IconButton>
          <span className="side-item-cost">{primary.value}</span>
        </span>
        <span className="side-item-badges">
          <AgentBadge tool={s.tool} />
          {s.model && <Badge kind="model">{fmtModel(s.model)}</Badge>}
          {s.chainLen > 1 && (
            <Tooltip content={`Resumed conversation — ${s.chainLen} session files`}>
              <Badge className="chain-badge">
                <HistoryIcon />
                {s.chainLen}
              </Badge>
            </Tooltip>
          )}
          {/* The figures the sort is not showing, one hover away — the row
              stays one number wide however many facts a session has. */}
          <Tooltip content={<Facts rows={rest} />}>
            <IconButton fill="ghost" className="side-item-info" label="Session details">
              <InfoIcon />
            </IconButton>
          </Tooltip>
        </span>
        {/* Tags get their own line: they are the user's words and there can be
            several, so they must not compete with the identity badges. */}
        {s.tags.length > 0 && (
          <span className="side-item-tags">
            {s.tags.slice(0, ROW_TAGS).map((t) => (
              <Badge key={t} className="tag-badge-row">
                {t}
              </Badge>
            ))}
            {s.tags.length > ROW_TAGS && (
              <Badge className="tag-badge-row">+{s.tags.length - ROW_TAGS}</Badge>
            )}
          </span>
        )}
      </span>
    </div>
  );
}

/**
 * The collapsed rail: the same list, one tile per session — all of them, in
 * the same order, scrolling. It reads the rows the open list uses, so a filter
 * or a sort you set stays true when the sidebar closes; a collapsed sidebar
 * showing a different set would be a different list wearing the same column.
 */
function RailSessions({
  rows,
  activeId,
  open,
}: {
  rows: SessionMeta[];
  activeId: string | null;
  open: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <nav className="rail-sessions" aria-label="Sessions">
      {rows.map((s) => (
        <Tooltip
          key={s.id}
          content={
            <span className="rail-tip">
              <span className="rail-tip-name">{sessionName(s)}</span>
              <Facts
                rows={Object.values(sessionFacts(s)).map((f) => ({
                  label: f.label,
                  value: f.value,
                }))}
              />
            </span>
          }
        >
          <a
            href={sessionHash(s.id)}
            className={`rail-session ${s.id === activeId ? 'active' : ''}`}
            aria-current={s.id === activeId ? 'page' : undefined}
            aria-label={sessionName(s)}
            tabIndex={open ? -1 : 0}
          >
            <span className={`tile tile-sm ${tileClass(s.projectKey)}`}>
              {projectName(s)[0]?.toUpperCase() ?? '\u00b7'}
            </span>
            {s.pinned && (
              <span className="rail-session-pin" aria-hidden>
                <PinFilledIcon size={9} />
              </span>
            )}
            {isLive(s) && (
              <span
                className="rail-session-live"
                role="img"
                aria-label="active in the last 5 minutes"
              />
            )}
          </a>
        </Tooltip>
      ))}
    </nav>
  );
}

export default function Sidebar({
  activeId,
  onToggle,
  open,
}: {
  activeId: string | null;
  onToggle: () => void;
  open: boolean;
}) {
  // Activity first: the most recently touched session is the one you want.
  const [sort, setSort] = useState<NonNullable<SessionsQuery['sort']>>('ended_at');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const hideEmpty = useHideEmpty();
  const project = useProjectFilter();
  const setProject = setProjectFilter;

  const status = useStatus();
  const projects = useProjects();
  const tags = useTags();
  const [tag, setTag] = useState('');

  // Quick name filter — server-side (matches custom names, CC titles, and
  // projects across ALL sessions, not just loaded pages), debounced.
  const [nameInput, setNameInput] = useState('');
  const [name, setName] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setName(nameInput.trim()), 250);
    return () => clearTimeout(t);
  }, [nameInput]);

  // Resume chains collapse to their tip — the tip file carries the whole
  // copied history, so earlier parts would read as duplicate rows here.
  const sessions = useSessions({
    sort,
    dir,
    project: project || undefined,
    tag: tag || undefined,
    hideEmpty,
    name: name || undefined,
    collapseChains: true,
  });

  const rows = useMemo(() => flattenSessions(sessions.data), [sessions.data]);
  const total = sessions.data?.pages[0]?.total ?? 0;
  const setMeta = useSetSessionMeta();
  const togglePin = (s: SessionMeta) => setMeta.mutate({ id: s.id, patch: { pinned: !s.pinned } });

  // Filter popover — project/sort/direction/empty live behind one button so
  // the always-visible row stays just the name filter. The accent dot on the
  // button is the "a hidden control is narrowing this list" flag.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const controlsRef = useRef<HTMLDivElement>(null);
  const sortActive = sort !== 'ended_at' || dir !== 'desc';
  const activeCount =
    (project ? 1 : 0) + (tag ? 1 : 0) + (hideEmpty ? 1 : 0) + (sortActive ? 1 : 0);
  const resetFilters = () => {
    setProject('');
    setTag('');
    setHideEmpty(false);
    setSort('ended_at');
    setDir('desc');
  };

  useEffect(() => {
    if (!filtersOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!controlsRef.current?.contains(e.target as Node)) setFiltersOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFiltersOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [filtersOpen]);

  return (
    <>
      <div className="rail-mini" aria-hidden={open}>
        <button
          className="rail-brand"
          onClick={onToggle}
          aria-label="Show sessions"
          aria-expanded={open}
          tabIndex={open ? -1 : 0}
        >
          {/* Both glyphs always render and cross-fade — a control that exists
              only on hover is unreachable by keyboard and touch. */}
          <Brandmark size={40} className="rail-brand-mark" />
          <span className="rail-brand-open" aria-hidden>
            <SidebarIcon size={20} />
          </span>
        </button>
        <RailSessions rows={rows} activeId={activeId} open={open} />
      </div>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <a href="#/" className="header-brand" aria-label="Turnlog — overview">
            <Brandmark size={40} />
            <span className="header-title">
              Turnlog
              <em>Search &amp; replay</em>
            </span>
          </a>
          {/* Collapse sits against the edge it moves, and is the last thing your
            eye reaches after the list. quiet, not card: it stands on the
            sidebar's own surface. */}
          <Primary
            fill="quiet"
            label="Hide sessions"
            tooltip="Hide sessions"
            shortcut={SHORTCUTS.sidebar}
            onClick={onToggle}
            icon={<SidebarIcon />}
          />
        </div>
        <div className="sidebar-controls" ref={controlsRef}>
          <div className="sidebar-controls-row">
            <SearchField
              value={nameInput}
              onChange={setNameInput}
              placeholder="Filter sessions…"
              ariaLabel="Filter sessions by name or project"
              icon
              clearable
            />
            <IconButton
              fill="inset"
              label="Session filters and sort"
              tooltip={
                activeCount > 0 ? `Filters & sort — ${activeCount} active` : 'Filters & sort'
              }
              className="filter-btn"
              active={filtersOpen}
              onClick={() => setFiltersOpen(!filtersOpen)}
              aria-expanded={filtersOpen}
            >
              <TuningIcon size={16} />
              {activeCount > 0 && <span className="filter-dot" />}
            </IconButton>
            <span className="sidebar-count">{fmtCount(total)}</span>
          </div>
          {filtersOpen && (
            <div className="filter-pop" role="dialog" aria-label="Session filters">
              <div className="pop-row">
                <span className="pop-label">project</span>
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
              </div>
              <div className="pop-row">
                <span className="pop-label">tag</span>
                <Dropdown
                  className="dd-grow"
                  value={tag}
                  onChange={setTag}
                  ariaLabel="Filter by tag"
                  options={[
                    { value: '', label: 'any tag' },
                    ...(tags.data?.tags.map((t) => ({
                      value: t.tag,
                      label: `${t.tag} (${t.count})`,
                    })) ?? []),
                  ]}
                />
              </div>
              <div className="pop-row">
                <span className="pop-label">sort</span>
                <Dropdown
                  className="dd-grow"
                  value={sort}
                  onChange={(v) => setSort(v as typeof sort)}
                  ariaLabel="Sort by"
                  options={SORTS.map((s) => ({ value: s.value, label: `by ${s.label}` }))}
                />
                <IconButton
                  fill="inset"
                  label={`Direction: ${dir}`}
                  tooltip={dir === 'desc' ? 'Newest first' : 'Oldest first'}
                  className={dir === 'asc' ? 'asc' : ''}
                  onClick={() => setDir(dir === 'desc' ? 'asc' : 'desc')}
                >
                  <SortVerticalIcon size={16} />
                </IconButton>
              </div>
              <div className="pop-row">
                <span className="pop-label">empty</span>
                <Segmented
                  className="share-seg"
                  ariaLabel="Empty sessions"
                  value={hideEmpty ? 'hidden' : 'shown'}
                  onChange={(v) => setHideEmpty(v === 'hidden')}
                  options={[
                    { value: 'shown', label: 'shown' },
                    { value: 'hidden', label: 'hidden' },
                  ]}
                />
              </div>
              {activeCount > 0 && (
                <button className="filter-reset" onClick={resetFilters}>
                  reset filters
                </button>
              )}
            </div>
          )}
        </div>

        {rows.length === 0 && sessions.isLoading ? (
          <SkeletonRows n={9} tile={34} />
        ) : rows.length === 0 ? (
          <div className="sidebar-empty">
            {sessions.isError
              ? (sessions.error as Error).message
              : status.data?.state === 'indexing'
                ? 'indexing…'
                : name || activeCount > 0
                  ? 'no matching sessions'
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
              <Item s={s} active={s.id === activeId} sort={sort} onTogglePin={togglePin} />
            )}
          />
        )}
      </aside>
    </>
  );
}
