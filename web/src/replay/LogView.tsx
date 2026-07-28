import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { fetchMessages } from '../api';
import { SkeletonRows } from '../components/Skeleton';
import { fmtCount } from '../format';
import type { Lens } from '../router';
import type { MessageRow, TurnSummary } from '../types';
import { BlockView } from './blocks';
import { buildBlocks, idxToBlockMap } from './thread';

const PAGE = 300;
const JUMP_BACKSCROLL = 40;
const VIRTUOSO_BASE = 10_000_000;

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

export default function LogView({
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
