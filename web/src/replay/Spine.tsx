import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { useTurnRows } from '../api';
import { SkeletonLines } from '../components/Skeleton';
import { fmtTime, fmtTokens } from '../format';
import type { TurnsResponse, TurnSummary } from '../types';
import { BlockView } from './blocks';
import { buildBlocks } from './thread';

/**
 * The turn spine (brainstorm §4a): the session collapsed to its prompts,
 * each with a mechanical summary of what happened underneath. The default
 * anti-scroll view — expand only the turn you care about.
 */

/** Legend colors ride along: edits=mint, cmds=purple, errors=vermilion. */
function summaryParts(t: TurnSummary): { text: string; cls?: string }[] {
  const parts: { text: string; cls?: string }[] = [];
  if (t.reads > 0) parts.push({ text: `${t.reads} read${t.reads === 1 ? '' : 's'}` });
  if (t.edits > 0) parts.push({ text: `${t.edits} edit${t.edits === 1 ? '' : 's'}`, cls: 'm-edits' });
  if (t.commands > 0) parts.push({ text: `${t.commands} cmd${t.commands === 1 ? '' : 's'}`, cls: 'm-cmds' });
  if (t.tasks > 0) parts.push({ text: `${t.tasks} subagent${t.tasks === 1 ? '' : 's'}` });
  if (t.otherTools > 0) parts.push({ text: `${t.otherTools} tool${t.otherTools === 1 ? '' : 's'}` });
  if (t.errors > 0) parts.push({ text: `${t.errors} error${t.errors === 1 ? '' : 's'}`, cls: 'm-errors' });
  if (parts.length === 0) parts.push({ text: 'reply only' });
  if (t.tokensOut > 0) parts.push({ text: `${fmtTokens(t.tokensOut)} tok` });
  return parts;
}

function TurnBody({
  sessionId,
  startIdx,
  endIdx,
  currentIdx,
}: {
  sessionId: string;
  startIdx: number;
  endIdx: number;
  currentIdx: number | null;
}) {
  const rows = useTurnRows(sessionId, startIdx, endIdx, true);
  const blocks = useMemo(() => buildBlocks(rows.data ?? []), [rows.data]);
  if (rows.isLoading) {
    return (
      <div className="turn-body">
        <SkeletonLines n={4} />
      </div>
    );
  }
  if (rows.isError) return <div className="turn-loading">failed to load turn</div>;
  return (
    <div className="turn-body">
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} currentIdx={currentIdx} />
      ))}
    </div>
  );
}

const TurnCard = memo(function TurnCard({
  sessionId,
  turn,
  n,
  open,
  onToggle,
  currentIdx,
}: {
  sessionId: string;
  turn: TurnSummary;
  n: number;
  open: boolean;
  onToggle: () => void;
  currentIdx: number | null;
}) {
  return (
    <div className={`turn ${open ? 'open' : ''}`} data-turn-idx={turn.idx}>
      <button className="turn-head" onClick={onToggle} aria-expanded={open}>
        <span className="turn-n">{n}</span>
        <span className={`caret ${open ? 'open' : ''}`}>▸</span>
        {turn.command ? (
          <span className="chip chip-cmd">{turn.command}</span>
        ) : (
          <span className="turn-text">{turn.text || '(empty prompt)'}</span>
        )}
        <span className="turn-meta">
          {summaryParts(turn).map((p, i) => (
            <span key={i} className={p.cls ?? ''}>
              {p.text}
            </span>
          ))}
        </span>
        <span className="turn-ts">{fmtTime(turn.ts)}</span>
      </button>
      {open && (
        <TurnBody
          sessionId={sessionId}
          startIdx={turn.idx}
          endIdx={turn.endIdx}
          currentIdx={currentIdx}
        />
      )}
    </div>
  );
});

type SpineItem =
  | { type: 'prelude'; count: number; endIdx: number }
  | { type: 'turn'; turn: TurnSummary; n: number };

export default function SpineView({
  sessionId,
  data,
  currentIdx,
}: {
  sessionId: string;
  data: TurnsResponse;
  currentIdx: number | null;
}) {
  const [openTurns, setOpenTurns] = useState<Set<number>>(new Set());
  const [topPos, setTopPos] = useState(0);
  const virtuoso = useRef<VirtuosoHandle>(null);

  const items = useMemo<SpineItem[]>(() => {
    const list: SpineItem[] = [];
    if (data.preludeCount > 0) {
      list.push({
        type: 'prelude',
        count: data.preludeCount,
        endIdx: data.turns[0]?.idx ?? data.total,
      });
    }
    data.turns.forEach((turn, i) => list.push({ type: 'turn', turn, n: i + 1 }));
    return list;
  }, [data]);

  const toggle = (idx: number) => {
    setOpenTurns((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  /** Turn (or prelude, keyed -1) containing a message idx. */
  const containerOf = (idx: number): number => {
    for (let i = data.turns.length - 1; i >= 0; i--) {
      if (data.turns[i]!.idx <= idx) return data.turns[i]!.idx;
    }
    return -1;
  };

  // Jump target (search hit / match nav / error nav): expand its turn and
  // bring it on-screen. Auto-opens replace the previous auto-open so cycling
  // through hits doesn't leave a trail of expanded turns.
  const lastAutoOpened = useRef<number | null>(null);
  useEffect(() => {
    if (currentIdx === null) return;
    const key = containerOf(currentIdx);
    setOpenTurns((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      if (lastAutoOpened.current !== null && lastAutoOpened.current !== key) {
        next.delete(lastAutoOpened.current);
      }
      next.add(key);
      return next;
    });
    const smooth = lastAutoOpened.current !== null; // first landing is instant
    lastAutoOpened.current = key;
    const listPos = items.findIndex((it) =>
      it.type === 'turn' ? it.turn.idx === key : key === -1,
    );
    if (listPos !== -1) {
      // Let the expanded body mount first, then align the turn.
      requestAnimationFrame(() =>
        virtuoso.current?.scrollToIndex({
          index: listPos,
          align: 'start',
          behavior: smooth ? 'smooth' : 'auto',
        }),
      );
    }
    // containerOf/items derive from data, which this effect intentionally
    // tracks via currentIdx only — re-running on refetch would yank scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIdx]);

  const outlineClick = (idx: number, listPos: number) => {
    // Toggle, mirroring the turn header: a second click collapses the turn.
    const wasOpen = openTurns.has(idx);
    toggle(idx);
    if (!wasOpen) {
      virtuoso.current?.scrollToIndex({ index: listPos, align: 'start', behavior: 'smooth' });
    }
  };

  return (
    <div className="spine-wrap">
      <nav className="outline" aria-label="Session outline">
        <div className="outline-title">turns</div>
        <div className="outline-list">
          {items.map((it, listPos) =>
            it.type === 'prelude' ? (
              <button
                key="prelude"
                className={`outline-item dim ${openTurns.has(-1) ? 'active' : ''} ${topPos === listPos ? 'current' : ''}`}
                onClick={() => outlineClick(-1, listPos)}
              >
                <span className="outline-n">·</span> prelude
              </button>
            ) : (
              <button
                key={it.turn.idx}
                className={`outline-item ${openTurns.has(it.turn.idx) ? 'active' : ''} ${it.turn.errors > 0 ? 'has-error' : ''} ${topPos === listPos ? 'current' : ''}`}
                onClick={() => outlineClick(it.turn.idx, listPos)}
                title={it.turn.command ?? it.turn.text}
              >
                <span className="outline-n">{it.n}</span>
                <span className="outline-text">{it.turn.command ?? it.turn.text}</span>
              </button>
            ),
          )}
        </div>
      </nav>

      <Virtuoso
        ref={virtuoso}
        className="spine-list"
        data={items}
        rangeChanged={(range) => setTopPos(range.startIndex)}
        itemContent={(_i, item) =>
          item.type === 'prelude' ? (
            <div className={`turn turn-prelude ${openTurns.has(-1) ? 'open' : ''}`}>
              <button className="turn-head" onClick={() => toggle(-1)} aria-expanded={openTurns.has(-1)}>
                <span className="turn-n">·</span>
                <span className={`caret ${openTurns.has(-1) ? 'open' : ''}`}>▸</span>
                <span className="turn-text dim">
                  session prelude · {item.count} event{item.count === 1 ? '' : 's'}
                </span>
              </button>
              {openTurns.has(-1) && (
                <TurnBody
                  sessionId={sessionId}
                  startIdx={0}
                  endIdx={item.endIdx}
                  currentIdx={currentIdx}
                />
              )}
            </div>
          ) : (
            <TurnCard
              sessionId={sessionId}
              turn={item.turn}
              n={item.n}
              open={openTurns.has(item.turn.idx)}
              onToggle={() => toggle(item.turn.idx)}
              currentIdx={currentIdx}
            />
          )
        }
        components={{ Footer: () => <div className="replay-footer" /> }}
      />
    </div>
  );
}
