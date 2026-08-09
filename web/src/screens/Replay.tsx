import { useEffect, useMemo, useState } from 'react';
import {
  revealSession,
  useBookmarks,
  useErrorIdxs,
  useRelatedSessions,
  useSearch,
  useSession,
  useSessionChildren,
  useSessionContext,
  useSetSessionMeta,
  useToggleBookmark,
  useTurns,
} from '../api';
import { agentInfo } from '../agents';
import AgentBadge from '../components/AgentBadge';
import TagEditor from '../components/TagEditor';
import Badge from '../components/Badge';
import IconButton from '../components/IconButton';
import NoteDot from '../components/NoteDot';
import Segmented from '../components/Segmented';
import { SkeletonRows } from '../components/Skeleton';
import Tooltip from '../components/Tooltip';
import { fmtCount, fmtDate, fmtModel, projectName, sessionName, shortId } from '../format';
import {
  BookmarkFilledIcon,
  ChartIcon,
  ChatIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronUpIcon,
  CloseIcon,
  CmdLensIcon,
  DiffLensIcon,
  ErrorLensIcon,
  FolderIcon,
  MagniferIcon,
  PenIcon,
  PinFilledIcon,
  PinIcon,
} from '../icons';
import { SHORTCUTS } from '../keys';
import { getPref, setPref } from '../prefs';
import { AgentLabelContext } from '../replay/agentContext';
import AnnotatePanel from '../replay/AnnotatePanel';
import { BookmarkContext } from '../replay/bookmarkContext';
import ChainNav from '../replay/ChainNav';
import { ChildSessionsContext } from '../replay/childSessions';
import FilesView from '../replay/Files';
import FindBar from '../replay/FindBar';
import LogView from '../replay/LogView';
import ResumeButton from '../replay/ResumeButton';
import SharePanel from '../replay/SharePanel';
import SpineView from '../replay/Spine';
import StatsPanel from '../replay/Stats';
import { navigate, projectHash, searchHash, sessionHash } from '../router';
import type { Lens, ViewParam } from '../router';

/** Stable identity for the no-subagents case — most sessions. */
const EMPTY_CHILDREN: never[] = [];

type ViewMode = 'spine' | 'log';

/** Lens legend: each dimension owns a color and an icon, everywhere it appears. */
const LENS_LABELS: { value: Lens; label: string; Icon: typeof DiffLensIcon }[] = [
  { value: 'diffs', label: 'diffs', Icon: DiffLensIcon },
  { value: 'commands', label: 'cmds', Icon: CmdLensIcon },
  { value: 'errors', label: 'errors', Icon: ErrorLensIcon },
  { value: 'prompts', label: 'prompts', Icon: ChatIcon },
];

/**
 * "Have I solved this before?" — the other sessions that talk about what this
 * one talks about, one click from where they say it.
 *
 * Quiet on purpose, and absent when there is nothing to show: it is a sideways
 * exit from a session you are already reading, not a recommendation feed. The
 * links carry the matching message's idx, so a click lands on the sentence
 * rather than at the top of a 3,000-message replay.
 */
function RelatedRow({ sessionId }: { sessionId: string }) {
  const related = useRelatedSessions(sessionId);
  const rows = related.data?.sessions ?? [];
  if (rows.length === 0) return null;
  return (
    <div className="replay-related">
      <span className="replay-related-label">related</span>
      {rows.slice(0, 4).map((r) => (
        <a
          key={r.session.id}
          className="replay-related-link"
          href={sessionHash(r.session.id, { m: r.idx })}
          title={`${r.hits} matching message${r.hits === 1 ? '' : 's'}`}
        >
          {sessionName(r.session)}
          {/* Untitled sessions fall back to their project name, so four
              entries can read the same without a date to tell them apart —
              and "when" is half the answer to "have I solved this before". */}
          <span className="replay-related-when">{fmtDate(r.session.startedAt)}</span>
        </a>
      ))}
      <a className="replay-related-all" href={searchHash(`like:${sessionId}`)}>
        see all
      </a>
    </div>
  );
}

export default function Replay({
  sessionId,
  jumpIdx,
  searchQuery,
  lens,
  view,
}: {
  sessionId: string;
  jumpIdx: number | null;
  searchQuery: string | null;
  lens: Lens | null;
  view?: ViewParam | null;
}) {
  const session = useSession(sessionId);
  const turns = useTurns(sessionId);
  const [mode, setMode] = useState<ViewMode>(() => {
    if (view) return view; // ?v= deep link wins over the persisted choice
    return getPref('view') === 'log' ? 'log' : 'spine';
  });
  const setModePersist = (m: ViewMode) => {
    setPref('view', m);
    setMode(m);
  };
  // Sessions without prompts (pure summaries etc.) have no spine to show.
  const spinePossible = turns.data === undefined || turns.data.turns.length > 0;
  const effectiveMode: ViewMode = mode === 'spine' && !spinePossible ? 'log' : mode;
  // A jump target must be visible — match navigation overrides the lens.
  const activeLens = jumpIdx === null ? lens : null;

  const lensCounts: Record<Lens, number> | null = turns.data
    ? turns.data.turns.reduce(
        (acc, t) => {
          acc.diffs += t.edits;
          acc.commands += t.commands;
          acc.errors += t.errors;
          acc.prompts += 1;
          return acc;
        },
        { diffs: 0, commands: 0, errors: 0, prompts: 0 },
      )
    : null;

  const [statsOpen, setStatsOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const setMeta = useSetSessionMeta();

  // Match navigation — session-scoped, so the hit list is complete.
  const search = useSearch(searchQuery ?? '', sessionId);
  const hitIdxs = useMemo(() => {
    if (!searchQuery || !search.data) return [];
    const group = search.data.groups.find((g) => g.session.id === sessionId);
    return group ? [...group.hits.map((h) => h.idx)].sort((a, b) => a - b) : [];
  }, [search.data, searchQuery, sessionId]);
  const hitPos = jumpIdx !== null ? hitIdxs.indexOf(jumpIdx) : -1;

  // In-session find bar: Cmd/Ctrl-F opens it; an incoming ?q= implies it.
  const [findOpen, setFindOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'f' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setFindOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const closeFind = () => {
    setFindOpen(false);
    if (searchQuery) navigate(sessionHash(sessionId));
  };

  // Jump rails: cycle through a sorted idx list via the ?m= mechanism.
  const jumpIn = (list: number[], dir: 1 | -1) => {
    if (list.length === 0) return;
    const cur = jumpIdx ?? -1;
    const target =
      dir === 1
        ? (list.find((i) => i > cur) ?? list[0]!)
        : ([...list].reverse().find((i) => i < cur) ?? list[list.length - 1]!);
    navigate(sessionHash(sessionId, { m: target, q: searchQuery ?? undefined }));
  };
  const errorIdxs = useErrorIdxs(sessionId);
  const jumpError = (dir: 1 | -1) => jumpIn(errorIdxs.data ?? [], dir);

  // Bookmarks: "mark this moment" state, provided to every BlockView below.
  const bookmarks = useBookmarks(sessionId);
  const toggleBookmark = useToggleBookmark(sessionId);
  const bookmarkIdxs = bookmarks.data?.idxs ?? [];
  const jumpBookmark = (dir: 1 | -1) => jumpIn(bookmarkIdxs, dir);
  const bookmarkCtx = useMemo(
    () => ({
      idxs: new Set(bookmarks.data?.idxs ?? []),
      toggle: (idx: number) =>
        toggleBookmark.mutate({ idx, on: !(bookmarks.data?.idxs ?? []).includes(idx) }),
      captions: new Map(
        Object.entries(bookmarks.data?.captions ?? {}).map(([k, v]) => [Number(k), v]),
      ),
      // Writing a caption keeps the bookmark on — it is an edit, not a toggle.
      setCaption: (idx: number, caption: string) =>
        toggleBookmark.mutate({ idx, on: true, caption }),
    }),
    [bookmarks.data, toggleBookmark],
  );

  const goToHit = (idx: number) => {
    navigate(sessionHash(sessionId, { m: idx, q: searchQuery ?? undefined }));
  };

  // File-based subagent transcripts, nested under their Task calls by every
  // BlockView below (log view and expanded spine turns alike).
  const childrenQuery = useSessionChildren(sessionId);
  const childSessions = childrenQuery.data?.children ?? EMPTY_CHILDREN;

  // Context-window data: the stats panel draws the curve; the spine marks
  // turns where a compaction happened.
  const context = useSessionContext(sessionId);
  const compactionIdxs = useMemo(
    () => context.data?.compactions.map((c) => c.idx) ?? [],
    [context.data],
  );

  const s = session.data;

  return (
    <AgentLabelContext.Provider value={agentInfo(s?.tool ?? 'claude-code').label}>
    <BookmarkContext.Provider value={bookmarkCtx}>
    <ChildSessionsContext.Provider value={childSessions}>
    <div className="replay">
      <div className="replay-head">
        <div className="replay-title">
          <Tooltip content="Back to library">
            <a href="#/" className="back-link" aria-label="Back to library">
              <ChevronLeftIcon size={17} />
            </a>
          </Tooltip>
          <div className="replay-heading">
            <span className="replay-project">
              {s?.pinned && <PinFilledIcon size={13} className="replay-pin-mark" />}
              {s ? sessionName(s) : '…'}
            </span>
            <span className="replay-meta">
              <span className="replay-id">{shortId(sessionId)}</span>
              {/* A title displaces the project from the heading — keep it here.
                  Its own class: a project is human-named (sans), the date
                  beside it is machine-measured (mono). */}
              {/* The repo is a place, not a label: from a session, one click
                  to everything every agent did here. */}
              {s && sessionName(s) !== projectName(s) && s.projectKey && (
                <a className="replay-project-sub" href={projectHash(s.projectKey)}>
                  {projectName(s)}
                </a>
              )}
              {s && sessionName(s) !== projectName(s) && !s.projectKey && (
                <span className="replay-project-sub">{projectName(s)}</span>
              )}
              {s && <AgentBadge tool={s.tool} />}
              {s?.model && <Badge kind="model">{fmtModel(s.model)}</Badge>}
              <span className="replay-date">{s ? fmtDate(s.startedAt) : ''}</span>
              {s && s.chainLen > 1 && <ChainNav sessionId={sessionId} />}
              {s?.note && <NoteDot note={s.note} />}
            </span>
            {/* Tags sit under the meta line rather than in it: the row is
                already dense, and a session can carry several. */}
            {s && <TagEditor sessionId={sessionId} tags={s.tags} />}
            <RelatedRow sessionId={sessionId} />
          </div>
          <div className="replay-controls-right">
            <div className="replay-views">
              <Segmented
                ariaLabel="View mode"
                value={activeLens === null ? effectiveMode : ''}
                onChange={(v) => {
                  setModePersist(v);
                  if (activeLens) navigate(sessionHash(sessionId));
                }}
                options={[
                  { value: 'spine', label: 'spine', disabled: !spinePossible },
                  { value: 'log', label: 'log' },
                ]}
              />
            <div className="lens-actions" role="tablist" aria-label="Lens">
              {LENS_LABELS.map(({ value, label, Icon }) => {
                const count = lensCounts?.[value];
                return (
                  <IconButton
                    key={value}
                    label={`${label} lens`}
                    tooltip={
                      count ? (
                        <div className="tooltip-row">
                          {label}
                          <span className="tooltip-num">{fmtCount(count)}</span>
                        </div>
                      ) : (
                        label
                      )
                    }
                    className={`lens-action lens-${value}`}
                    active={activeLens === value}
                    role="tab"
                    aria-selected={activeLens === value}
                    disabled={count === 0}
                    onClick={() =>
                      navigate(
                        activeLens === value
                          ? sessionHash(sessionId)
                          : sessionHash(sessionId, { l: value }),
                      )
                    }
                  >
                    <Icon size={16} />
                  </IconButton>
                );
              })}
            </div>
            </div>
            <div className="replay-actions">
            <IconButton
              label="Find in session"
              tooltip="Find in session"
              shortcut={SHORTCUTS.find}
              active={findOpen || !!searchQuery}
              aria-pressed={findOpen || !!searchQuery}
              onClick={() => (findOpen || searchQuery ? closeFind() : setFindOpen(true))}
            >
              <MagniferIcon size={16} />
            </IconButton>
            <IconButton
              label={s?.pinned ? 'Unpin session' : 'Pin session'}
              tooltip={s?.pinned ? 'Unpin from sidebar top' : 'Pin to sidebar top'}
              active={s?.pinned ?? false}
              aria-pressed={s?.pinned ?? false}
              onClick={() => s && setMeta.mutate({ id: s.id, patch: { pinned: !s.pinned } })}
            >
              {s?.pinned ? <PinFilledIcon size={16} /> : <PinIcon size={16} />}
            </IconButton>
            <IconButton
              label="Edit session name and note"
              tooltip={editOpen ? 'Close editor' : 'Name & note'}
              active={editOpen}
              aria-pressed={editOpen}
              onClick={() => setEditOpen(!editOpen)}
            >
              <PenIcon size={16} />
            </IconButton>
            <IconButton
              label="Show session file in file manager"
              tooltip="Show the session file in your file manager"
              onClick={() => revealSession(sessionId)}
            >
              <FolderIcon size={16} />
            </IconButton>
            {s && <ResumeButton session={s} />}
            <SharePanel sessionId={sessionId} />
            <IconButton
              label="Session stats"
              tooltip={statsOpen ? 'Hide stats' : 'Session stats'}
              active={statsOpen}
              aria-pressed={statsOpen}
              onClick={() => setStatsOpen(!statsOpen)}
            >
              <ChartIcon size={16} />
            </IconButton>
            </div>
          </div>
        </div>
        {editOpen && s && <AnnotatePanel s={s} onClose={() => setEditOpen(false)} />}
        {statsOpen && s && <StatsPanel s={s} sessionId={sessionId} />}
        {(findOpen || searchQuery) && (
          <FindBar
            key={searchQuery ?? ''}
            sessionId={sessionId}
            query={searchQuery ?? ''}
            hitIdxs={hitIdxs}
            onClose={closeFind}
            onCycle={(dir) => jumpIn(hitIdxs, dir)}
          />
        )}
      </div>

      {activeLens === 'diffs' ? (
        /* The diffs lens IS the per-file pivot: files left, that file's
           edits in order right, each with a view-in-session jump. */
        <FilesView sessionId={sessionId} />
      ) : activeLens !== null ? (
        <LogView key={activeLens} sessionId={sessionId} jumpIdx={null} lens={activeLens} />
      ) : effectiveMode === 'spine' ? (
        turns.data ? (
          <SpineView
            sessionId={sessionId}
            data={turns.data}
            currentIdx={jumpIdx}
            compactionIdxs={compactionIdxs}
          />
        ) : turns.isError ? (
          <div className="fullscreen-note">
            <div>
              <h1>Could not load session</h1>
              <p>{(turns.error as Error).message}</p>
            </div>
          </div>
        ) : (
          <SkeletonRows n={8} tile={30} />
        )
      ) : (
        <LogView sessionId={sessionId} jumpIdx={jumpIdx} turns={turns.data?.turns} />
      )}

      <div className="nav-rails">
        {bookmarkIdxs.length > 0 && (
          <div className="error-nav bookmark-nav">
            <BookmarkFilledIcon size={13} className="bookmark-nav-ico" />
            <span className="error-nav-count bookmark-nav-count">{bookmarkIdxs.length}</span>
            <IconButton
              fill="ghost"
              label="Previous bookmark"
              tooltip="Previous bookmark"
              onClick={() => jumpBookmark(-1)}
            >
              <ChevronUpIcon size={16} />
            </IconButton>
            <IconButton
              fill="ghost"
              label="Next bookmark"
              tooltip="Next bookmark"
              onClick={() => jumpBookmark(1)}
            >
              <ChevronDownIcon size={16} />
            </IconButton>
          </div>
        )}
        {(errorIdxs.data?.length ?? 0) > 0 && (
          <div className="error-nav">
            <span className="dot dot-error" />
            <span className="error-nav-count">{errorIdxs.data!.length}</span>
            <IconButton
              fill="ghost"
              label="Previous error"
              tooltip="Previous error"
              onClick={() => jumpError(-1)}
            >
              <ChevronUpIcon size={16} />
            </IconButton>
            <IconButton
              fill="ghost"
              label="Next error"
              tooltip="Next error"
              onClick={() => jumpError(1)}
            >
              <ChevronDownIcon size={16} />
            </IconButton>
          </div>
        )}
      </div>

      {searchQuery && hitIdxs.length > 0 && (
        <div className="match-bar">
          <span className="match-query">“{searchQuery}”</span>
          <span className="match-count">
            {hitPos === -1 ? '–' : hitPos + 1}/{hitIdxs.length}
          </span>
          <IconButton
            fill="ghost"
            label="Previous match"
            tooltip="Previous match"
            onClick={() => goToHit(hitIdxs[(hitPos - 1 + hitIdxs.length) % hitIdxs.length]!)}
          >
            <ChevronUpIcon size={16} />
          </IconButton>
          <IconButton
            fill="ghost"
            label="Next match"
            tooltip="Next match"
            onClick={() => goToHit(hitIdxs[(hitPos + 1) % hitIdxs.length]!)}
          >
            <ChevronDownIcon size={16} />
          </IconButton>
          <IconButton
            fill="ghost"
            label="Clear match navigation"
            tooltip="Clear search"
            onClick={() => navigate(sessionHash(sessionId))}
          >
            <CloseIcon size={14} />
          </IconButton>
        </div>
      )}
    </div>
    </ChildSessionsContext.Provider>
    </BookmarkContext.Provider>
    </AgentLabelContext.Provider>
  );
}
