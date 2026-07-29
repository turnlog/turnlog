import { useEffect, useMemo, useState } from 'react';
import {
  revealSession,
  useBookmarks,
  useErrorIdxs,
  useSearch,
  useSession,
  useSessionChildren,
  useSessionContext,
  useSetSessionMeta,
  useToggleBookmark,
  useTurns,
} from '../api';
import NoteDot from '../components/NoteDot';
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
import { navigate, sessionHash } from '../router';
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
              {/* A title displaces the project from the heading — keep it here. */}
              {s && sessionName(s) !== projectName(s) && (
                <span className="replay-date">{projectName(s)}</span>
              )}
              {s?.tool === 'codex' && <span className="chip chip-tool">codex</span>}
              {s?.model && <span className="chip">{fmtModel(s.model)}</span>}
              <span className="replay-date">{s ? fmtDate(s.startedAt) : ''}</span>
              {s && s.chainLen > 1 && <ChainNav sessionId={sessionId} />}
              {s?.note && <NoteDot note={s.note} />}
            </span>
          </div>
          <div className="replay-controls-right">
            <div className="replay-views">
              <div className="view-toggle" role="tablist" aria-label="View mode">
              <button
                role="tab"
                aria-selected={activeLens === null && effectiveMode === 'spine'}
                className={activeLens === null && effectiveMode === 'spine' ? 'active' : ''}
                disabled={!spinePossible}
                onClick={() => {
                  setModePersist('spine');
                  if (activeLens) navigate(sessionHash(sessionId));
                }}
              >
                spine
              </button>
              <button
                role="tab"
                aria-selected={activeLens === null && effectiveMode === 'log'}
                className={activeLens === null && effectiveMode === 'log' ? 'active' : ''}
                onClick={() => {
                  setModePersist('log');
                  if (activeLens) navigate(sessionHash(sessionId));
                }}
              >
                log
              </button>
            </div>
            <div className="lens-actions" role="tablist" aria-label="Lens">
              {LENS_LABELS.map(({ value, label, Icon }) => {
                const count = lensCounts?.[value];
                return (
                  <Tooltip
                    key={value}
                    content={
                      count ? (
                        <div className="tooltip-row">
                          {label}
                          <span className="tooltip-num">{fmtCount(count)}</span>
                        </div>
                      ) : (
                        label
                      )
                    }
                  >
                    <button
                      role="tab"
                      aria-selected={activeLens === value}
                      aria-label={`${label} lens`}
                      className={`replay-action lens-action lens-${value} ${
                        activeLens === value ? 'active' : ''
                      }`}
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
                    </button>
                  </Tooltip>
                );
              })}
            </div>
            </div>
            <div className="replay-actions">
            <Tooltip content="Find in session" shortcut={SHORTCUTS.find}>
              <button
                className={`replay-action ${findOpen || searchQuery ? 'active' : ''}`}
                onClick={() => (findOpen || searchQuery ? closeFind() : setFindOpen(true))}
                aria-label="Find in session"
                aria-pressed={findOpen || !!searchQuery}
              >
                <MagniferIcon size={16} />
              </button>
            </Tooltip>
            <Tooltip content={s?.pinned ? 'Unpin from sidebar top' : 'Pin to sidebar top'}>
              <button
                className={`replay-action ${s?.pinned ? 'active' : ''}`}
                onClick={() => s && setMeta.mutate({ id: s.id, patch: { pinned: !s.pinned } })}
                aria-label={s?.pinned ? 'Unpin session' : 'Pin session'}
                aria-pressed={s?.pinned ?? false}
              >
                {s?.pinned ? <PinFilledIcon size={16} /> : <PinIcon size={16} />}
              </button>
            </Tooltip>
            <Tooltip content={editOpen ? 'Close editor' : 'Name & note'}>
              <button
                className={`replay-action ${editOpen ? 'active' : ''}`}
                onClick={() => setEditOpen(!editOpen)}
                aria-label="Edit session name and note"
                aria-pressed={editOpen}
              >
                <PenIcon size={16} />
              </button>
            </Tooltip>
            <Tooltip content="Show the session file in your file manager">
              <button
                className="replay-action"
                onClick={() => revealSession(sessionId)}
                aria-label="Show session file in file manager"
              >
                <FolderIcon size={16} />
              </button>
            </Tooltip>
            {s && <ResumeButton session={s} />}
            <SharePanel sessionId={sessionId} />
            <Tooltip content={statsOpen ? 'Hide stats' : 'Session stats'}>
              <button
                className={`replay-action ${statsOpen ? 'active' : ''}`}
                onClick={() => setStatsOpen(!statsOpen)}
                aria-label="Session stats"
                aria-pressed={statsOpen}
              >
                <ChartIcon size={16} />
              </button>
            </Tooltip>
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
            <Tooltip content="Previous bookmark">
              <button onClick={() => jumpBookmark(-1)} aria-label="Previous bookmark">
                <ChevronUpIcon size={16} />
              </button>
            </Tooltip>
            <Tooltip content="Next bookmark">
              <button onClick={() => jumpBookmark(1)} aria-label="Next bookmark">
                <ChevronDownIcon size={16} />
              </button>
            </Tooltip>
          </div>
        )}
        {(errorIdxs.data?.length ?? 0) > 0 && (
          <div className="error-nav">
            <span className="dot dot-accent" />
            <span className="error-nav-count">{errorIdxs.data!.length}</span>
            <Tooltip content="Previous error">
              <button onClick={() => jumpError(-1)} aria-label="Previous error">
                <ChevronUpIcon size={16} />
              </button>
            </Tooltip>
            <Tooltip content="Next error">
              <button onClick={() => jumpError(1)} aria-label="Next error">
                <ChevronDownIcon size={16} />
              </button>
            </Tooltip>
          </div>
        )}
      </div>

      {searchQuery && hitIdxs.length > 0 && (
        <div className="match-bar">
          <span className="match-query">“{searchQuery}”</span>
          <span className="match-count">
            {hitPos === -1 ? '–' : hitPos + 1}/{hitIdxs.length}
          </span>
          <Tooltip content="Previous match">
            <button
              onClick={() => goToHit(hitIdxs[(hitPos - 1 + hitIdxs.length) % hitIdxs.length]!)}
              aria-label="Previous match"
            >
              <ChevronUpIcon size={16} />
            </button>
          </Tooltip>
          <Tooltip content="Next match">
            <button
              onClick={() => goToHit(hitIdxs[(hitPos + 1) % hitIdxs.length]!)}
              aria-label="Next match"
            >
              <ChevronDownIcon size={16} />
            </button>
          </Tooltip>
          <Tooltip content="Clear search">
            <button
              aria-label="Clear match navigation"
              onClick={() => navigate(sessionHash(sessionId))}
            >
              <CloseIcon size={14} />
            </button>
          </Tooltip>
        </div>
      )}
    </div>
    </ChildSessionsContext.Provider>
    </BookmarkContext.Provider>
  );
}
