import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import {
  fetchExport,
  fetchMessages,
  useErrorIdxs,
  useSearch,
  useSession,
  useStatus,
  useTrialOpenIds,
  useTurns,
} from '../api';
import {
  fmtCost,
  fmtCount,
  fmtDate,
  fmtDuration,
  fmtModel,
  fmtTokens,
  projectName,
  shortId,
} from '../format';
import { navigate, sessionHash } from '../router';
import { BlockView } from '../replay/blocks';
import FilesView from '../replay/Files';
import SpineView from '../replay/Spine';
import { buildBlocks, idxToBlockMap } from '../replay/thread';
import { SkeletonRows } from '../components/Skeleton';
import type { MessageRow, SessionMeta, TurnSummary } from '../types';
import type { Lens, ViewParam } from '../router';

const PAGE = 300;
const JUMP_BACKSCROLL = 40;
const VIRTUOSO_BASE = 10_000_000;

type ViewMode = 'spine' | 'log' | 'files';

/**
 * A contiguous window of messages, growable in both directions. The API
 * pages forward-only (`after_idx`), so "earlier" is a bounded fetch of
 * exactly the gap above the window. (Log view only — the spine fetches
 * per-turn ranges instead.)
 */
function useMessageWindow(sessionId: string, startIdx: number | null, lens: Lens | null = null) {
  const [rows, setRows] = useState<MessageRow[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const busy = useRef(false);

  const merge = useCallback((incoming: MessageRow[], newTotal: number) => {
    setTotal(newTotal);
    if (incoming.length === 0) return;
    setRows((prev) => {
      const byIdx = new Map(prev.map((r) => [r.idx, r]));
      for (const r of incoming) byIdx.set(r.idx, r);
      return [...byIdx.values()].sort((a, b) => a.idx - b.idx);
    });
  }, []);

  const run = useCallback(
    async (afterIdx: number, limit: number) => {
      if (busy.current) return;
      busy.current = true;
      try {
        const res = await fetchMessages(sessionId, afterIdx, limit, lens);
        merge(res.messages, res.total);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'failed to load messages');
      } finally {
        busy.current = false;
        setLoading(false);
      }
    },
    [sessionId, merge, lens],
  );

  useEffect(() => {
    const after = startIdx === null ? -1 : Math.max(-1, startIdx - JUMP_BACKSCROLL - 1);
    void run(after, PAGE);
    // One window per mounted view; Replay keys views by session id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const loadOlder = useCallback(async () => {
    const first = rows[0]?.idx;
    if (first === undefined || first <= 0) return;
    const after = Math.max(-1, first - PAGE - 1);
    await run(after, first - after - 1);
  }, [rows, run]);

  const loadNewer = useCallback(async () => {
    const last = rows[rows.length - 1]?.idx;
    await run(last ?? -1, PAGE);
  }, [rows, run]);

  const ensureLoaded = useCallback(
    async (target: number) => {
      for (let i = 0; i < 60; i++) {
        const res = await fetchMessages(
          sessionId,
          Math.max(-1, target - JUMP_BACKSCROLL - 1),
          PAGE,
          lens,
        ).catch(() => null);
        if (!res) return;
        merge(res.messages, res.total);
        if (res.messages.some((r) => r.idx === target) || res.messages.length === 0) return;
      }
    },
    [sessionId, merge, lens],
  );

  return { rows, total, error, loading, loadOlder, loadNewer, ensureLoaded };
}

function LogView({
  sessionId,
  jumpIdx,
  lens = null,
  turns,
}: {
  sessionId: string;
  jumpIdx: number | null;
  lens?: Lens | null;
  turns?: TurnSummary[];
}) {
  const win = useMessageWindow(sessionId, jumpIdx, lens);
  const [topIdx, setTopIdx] = useState<number | null>(null);
  const blocks = useMemo(() => buildBlocks(win.rows), [win.rows]);
  const idxMap = useMemo(() => idxToBlockMap(blocks), [blocks]);
  const idxMapRef = useRef(idxMap);
  idxMapRef.current = idxMap;

  // Prepends shift list positions; firstItemIndex keeps virtuoso anchored.
  const [firstItemIndex, setFirstItemIndex] = useState(VIRTUOSO_BASE);
  const prevFirstRep = useRef<number | null>(null);
  useEffect(() => {
    const firstRep = blocks[0]?.repIdx ?? null;
    const prev = prevFirstRep.current;
    if (firstRep !== null && prev !== null && firstRep < prev) {
      const prepended = blocks.filter((b) => b.repIdx < prev).length;
      setFirstItemIndex((v) => v - prepended);
    }
    if (firstRep !== null) prevFirstRep.current = firstRep;
  }, [blocks]);

  const virtuoso = useRef<VirtuosoHandle>(null);
  const atBottom = useRef(false);

  const scrollToIdx = useCallback(
    (target: number, smooth: boolean, attempt = 0) => {
      const pos = idxMapRef.current.get(target);
      if (pos !== undefined) {
        virtuoso.current?.scrollToIndex({
          index: firstItemIndex + pos,
          align: 'center',
          behavior: smooth ? 'smooth' : 'auto',
        });
      } else if (attempt < 20) {
        requestAnimationFrame(() => scrollToIdx(target, smooth, attempt + 1));
      }
    },
    [firstItemIndex],
  );

  // Jump target changed (initial open or match navigation).
  const lastJump = useRef<number | null>(null);
  useEffect(() => {
    if (jumpIdx === null || lastJump.current === jumpIdx) return;
    const smooth = lastJump.current !== null; // first landing is instant
    lastJump.current = jumpIdx;
    let alive = true;
    void win.ensureLoaded(jumpIdx).then(() => {
      if (alive) requestAnimationFrame(() => scrollToIdx(jumpIdx, smooth));
    });
    return () => {
      alive = false;
    };
  }, [jumpIdx, win.ensureLoaded, scrollToIdx, win]);

  // Live tail: follow an in-flight session while the user sits at the bottom.
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible' && atBottom.current) void win.loadNewer();
    }, 3500);
    return () => clearInterval(t);
  }, [win.loadNewer, win]);

  if (win.loading && win.rows.length === 0) {
    return <SkeletonRows n={8} tile={30} />;
  }
  if (win.error && win.rows.length === 0) {
    return (
      <div className="fullscreen-note">
        <div>
          <h1>Could not load session</h1>
          <p>{win.error}</p>
        </div>
      </div>
    );
  }

  const firstIdx = win.rows[0]?.idx;
  // Lens windows start from the session beginning (jump targets override the
  // lens), so "earlier" only exists in the unfiltered view.
  const hasEarlier = lens === null && firstIdx !== undefined && firstIdx > 0;

  // Sticky "you are here": the turn containing the topmost visible block.
  const currentTurn =
    turns && topIdx !== null
      ? [...turns].reverse().find((t) => t.idx <= topIdx)
      : undefined;
  const turnNumber = currentTurn && turns ? turns.indexOf(currentTurn) + 1 : null;

  return (
    <div className="log-wrap">
      {currentTurn && (
        <div className="you-are-here" title={currentTurn.command ?? currentTurn.text}>
          <span className="turn-n">{turnNumber}</span>
          <span className="yah-text">{currentTurn.command ?? currentTurn.text}</span>
        </div>
      )}
    <Virtuoso
      ref={virtuoso}
      className="replay-list"
      data={blocks}
      firstItemIndex={firstItemIndex}
      endReached={() => void win.loadNewer()}
      rangeChanged={(range) => {
        const block = blocks[range.startIndex - firstItemIndex];
        if (block) setTopIdx(block.repIdx);
      }}
      atBottomStateChange={(v) => {
        atBottom.current = v;
      }}
      components={{
        Header: () =>
          hasEarlier ? (
            <div className="load-earlier">
              <button onClick={() => void win.loadOlder()}>
                ↑ load earlier ({fmtCount(firstIdx)} events above)
              </button>
            </div>
          ) : null,
        Footer: () => <div className="replay-footer" />,
      }}
      itemContent={(_i, block) => (
        <BlockView
          block={block}
          currentIdx={jumpIdx}
          defaultOpen={lens !== null && lens !== 'prompts'}
        />
      )}
    />
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-tile">
      <div>
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  );
}

function StatsPanel({ s }: { s: SessionMeta }) {
  return (
    <div className="stat-strip replay-stats">
      <Tile label="turns" value={fmtCount(s.turnCount)} />
      <Tile label="duration" value={fmtDuration(s.startedAt, s.endedAt)} />
      <Tile label="tokens in / out" value={`${fmtTokens(s.inputTokens)} / ${fmtTokens(s.outputTokens)}`} />
      <Tile label="cache read / write" value={`${fmtTokens(s.cacheReadTokens)} / ${fmtTokens(s.cacheWriteTokens)}`} />
      <Tile label="files touched" value={fmtCount(s.filesTouchedCount)} />
      <Tile label="est. cost" value={fmtCost(s.costUsd)} />
    </div>
  );
}

function LockedPanel({ s }: { s: SessionMeta | undefined }) {
  return (
    <div className="fullscreen-note">
      <div>
        <h1>This session is part of your locked history</h1>
        {s && (
          <p className="locked-meta">
            {projectName(s)} · {fmtDate(s.startedAt)} · {fmtCount(s.turnCount)} turns ·{' '}
            {fmtCost(s.costUsd)}
          </p>
        )}
        <p>
          The trial opens your 10 newest sessions. A license unlocks everything Turnlog
          has already indexed — including this one.
        </p>
        <p>
          <a href="#/">← back to the library</a>
        </p>
      </div>
    </div>
  );
}

/** In-session find (4e): drives the same ?q= the global search uses. */
function FindBar({
  sessionId,
  query,
  hitIdxs,
  onClose,
}: {
  sessionId: string;
  query: string;
  hitIdxs: number[];
  onClose: () => void;
}) {
  const [value, setValue] = useState(query);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Debounce into the URL — q is the single source of find state.
  useEffect(() => {
    if (value.trim() === query) return;
    const t = setTimeout(() => {
      navigate(
        value.trim()
          ? sessionHash(sessionId, { q: value.trim() })
          : sessionHash(sessionId),
      );
    }, 250);
    return () => clearTimeout(t);
  }, [value, query, sessionId]);

  return (
    <div className="find-bar">
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          } else if (e.key === 'Enter' && hitIdxs.length > 0) {
            e.preventDefault();
            navigate(sessionHash(sessionId, { m: hitIdxs[0]!, q: value.trim() }));
          }
        }}
        placeholder="Find in this session…"
        aria-label="Find in session"
      />
      <span className="find-count">
        {query ? `${fmtCount(hitIdxs.length)} hit${hitIdxs.length === 1 ? '' : 's'}` : ''}
      </span>
      <button onClick={onClose} aria-label="Close find">
        ✕
      </button>
    </div>
  );
}

/** Lens legend: each dimension owns a color, everywhere it appears. */
const LENS_LABELS: { value: Lens; label: string; dot: string }[] = [
  { value: 'diffs', label: 'diffs', dot: 'dot-mint' },
  { value: 'commands', label: 'cmds', dot: 'dot-purple' },
  { value: 'errors', label: 'errors', dot: 'dot-accent' },
  { value: 'prompts', label: 'prompts', dot: 'dot-ink' },
];

function ExportButton({ sessionId }: { sessionId: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(await fetchExport(sessionId));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard denied — ignore */
    }
  };
  const download = async () => {
    const md = await fetchExport(sessionId).catch(() => null);
    if (md === null) return;
    const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sessionId.slice(0, 8)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="export-ctl">
      <button className="stats-toggle" onClick={copy} title="Copy session as markdown">
        {copied ? 'copied ✓' : 'copy md'}
      </button>
      <button className="stats-toggle icon" onClick={download} title="Download markdown" aria-label="Download markdown">
        ↓
      </button>
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
  const status = useStatus();
  const licensed = status.data?.licensed ?? true;
  const trialOpen = useTrialOpenIds(!licensed);
  const locked =
    !licensed && trialOpen.data !== undefined && !trialOpen.data.has(sessionId);

  const turns = useTurns(sessionId);
  const [mode, setMode] = useState<ViewMode>(() => {
    if (view) return view; // ?v= deep link wins over the persisted choice
    const stored = localStorage.getItem('turnlog-view');
    return stored === 'log' || stored === 'files' ? stored : 'spine';
  });
  const setModePersist = (m: ViewMode) => {
    localStorage.setItem('turnlog-view', m);
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

  // Match navigation — session-scoped, so the hit list is complete (4e).
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

  // Error jump markers (4c): cycle through failing results in either view.
  const errorIdxs = useErrorIdxs(sessionId);
  const jumpError = (dir: 1 | -1) => {
    const list = errorIdxs.data ?? [];
    if (list.length === 0) return;
    const cur = jumpIdx ?? -1;
    const target =
      dir === 1
        ? (list.find((i) => i > cur) ?? list[0]!)
        : ([...list].reverse().find((i) => i < cur) ?? list[list.length - 1]!);
    navigate(sessionHash(sessionId, { m: target, q: searchQuery ?? undefined }));
  };

  const goToHit = (idx: number) => {
    navigate(sessionHash(sessionId, { m: idx, q: searchQuery ?? undefined }));
  };

  if (locked) return <LockedPanel s={session.data} />;

  const s = session.data;

  return (
    <div className="replay">
      <div className="replay-head">
        <div className="replay-title">
          <a href="#/" className="back-link">
            ←
          </a>
          <span className="replay-project">{s ? projectName(s) : '…'}</span>
          <span className="replay-id">{shortId(sessionId)}</span>
          {s?.model && <span className="chip">{fmtModel(s.model)}</span>}
          <span className="replay-date">{s ? fmtDate(s.startedAt) : ''}</span>
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
            <button
              role="tab"
              aria-selected={activeLens === null && effectiveMode === 'files'}
              className={activeLens === null && effectiveMode === 'files' ? 'active' : ''}
              onClick={() => {
                setModePersist('files');
                if (activeLens) navigate(sessionHash(sessionId));
              }}
            >
              files
            </button>
          </div>
          <div className="view-toggle lens-toggle" role="tablist" aria-label="Lens">
            {LENS_LABELS.map(({ value, label, dot }) => {
              const count = lensCounts?.[value];
              return (
                <button
                  key={value}
                  role="tab"
                  aria-selected={activeLens === value}
                  className={activeLens === value ? 'active' : ''}
                  disabled={count === 0}
                  onClick={() =>
                    navigate(
                      activeLens === value
                        ? sessionHash(sessionId)
                        : sessionHash(sessionId, { l: value }),
                    )
                  }
                >
                  <span className={`dot ${dot}`} />
                  {label}
                  {count !== null && count !== undefined && count > 0 && (
                    <span className="lens-count">{count}</span>
                  )}
                </button>
              );
            })}
          </div>
          <ExportButton sessionId={sessionId} />
          <button
            className={`stats-toggle ${statsOpen ? 'active' : ''}`}
            onClick={() => setStatsOpen(!statsOpen)}
          >
            stats
          </button>
        </div>
        {statsOpen && s && <StatsPanel s={s} />}
        {(findOpen || searchQuery) && (
          <FindBar
            key={searchQuery ?? ''}
            sessionId={sessionId}
            query={searchQuery ?? ''}
            hitIdxs={hitIdxs}
            onClose={closeFind}
          />
        )}
      </div>

      {activeLens !== null ? (
        <LogView key={activeLens} sessionId={sessionId} jumpIdx={null} lens={activeLens} />
      ) : effectiveMode === 'files' && jumpIdx === null ? (
        <FilesView sessionId={sessionId} />
      ) : effectiveMode === 'spine' || (effectiveMode === 'files' && jumpIdx !== null) ? (
        turns.data ? (
          <SpineView sessionId={sessionId} data={turns.data} currentIdx={jumpIdx} />
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

      {(errorIdxs.data?.length ?? 0) > 0 && (
        <div className="error-nav" title="Jump between failing tool results">
          <span className="dot dot-accent" />
          <span className="error-nav-count">{errorIdxs.data!.length}</span>
          <button onClick={() => jumpError(-1)} aria-label="Previous error">
            ↑
          </button>
          <button onClick={() => jumpError(1)} aria-label="Next error">
            ↓
          </button>
        </div>
      )}

      {searchQuery && hitIdxs.length > 0 && (
        <div className="match-bar">
          <span className="match-query">“{searchQuery}”</span>
          <span className="match-count">
            {hitPos === -1 ? '–' : hitPos + 1}/{hitIdxs.length}
          </span>
          <button
            onClick={() => goToHit(hitIdxs[(hitPos - 1 + hitIdxs.length) % hitIdxs.length]!)}
            aria-label="Previous match"
          >
            ↑
          </button>
          <button
            onClick={() => goToHit(hitIdxs[(hitPos + 1) % hitIdxs.length]!)}
            aria-label="Next match"
          >
            ↓
          </button>
          <button
            aria-label="Clear match navigation"
            onClick={() => navigate(sessionHash(sessionId))}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
