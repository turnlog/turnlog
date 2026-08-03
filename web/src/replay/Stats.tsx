import { useMemo } from 'react';
import { useSessionContext, useTurns } from '../api';
import { fmtCost, fmtCount, fmtDuration, fmtTokens } from '../format';
import { navigate, sessionHash } from '../router';
import type { SessionMeta } from '../types';

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

export default function StatsPanel({ s, sessionId }: { s: SessionMeta; sessionId: string }) {
  return (
    <>
      <div className="stat-strip replay-stats">
        <Tile label="events" value={fmtCount(s.eventCount)} />
        <Tile label="duration" value={fmtDuration(s.startedAt, s.endedAt)} />
        <Tile label="tokens in / out" value={`${fmtTokens(s.inputTokens)} / ${fmtTokens(s.outputTokens)}`} />
        <Tile label="cache read / write" value={`${fmtTokens(s.cacheReadTokens)} / ${fmtTokens(s.cacheWriteTokens)}`} />
        <Tile label="files touched" value={fmtCount(s.filesTouchedCount)} />
        <Tile label="est. cost" value={fmtCost(s.costUsd)} />
      </div>
      <ContextStrip sessionId={sessionId} />
    </>
  );
}

/** Chart-internal coordinates; the SVG stretches to the card width. */
const CTX_W = 720;
const CTX_H = 84;
/** Rendering cap — long sessions bucket down to this many columns (max wins). */
const CTX_MAX_COLS = 240;

/**
 * The context-window timeline: how full the window was at every API response
 * (input + cache read + cache write — data the index already holds), with
 * compaction boundaries marked. Answers "when did the context fill, and did
 * the compaction cost it the plot?" — the diagnostic spend can't give.
 */
function ContextStrip({ sessionId }: { sessionId: string }) {
  const ctx = useSessionContext(sessionId);
  const points = ctx.data?.points ?? [];
  const compactions = ctx.data?.compactions ?? [];
  const turns = useTurns(sessionId);

  const { line, area, max, cols, marks } = useMemo(() => {
    if (points.length < 2) {
      return { line: '', area: '', max: 0, cols: [] as number[], marks: [] as number[] };
    }
    const bucket = Math.max(1, Math.ceil(points.length / CTX_MAX_COLS));
    const cols: number[] = [];
    for (let i = 0; i < points.length; i += bucket) {
      let m = 0;
      for (let j = i; j < Math.min(i + bucket, points.length); j++) {
        m = Math.max(m, points[j]!.context);
      }
      cols.push(m);
    }
    const max = Math.max(...cols);
    const x = (i: number) => (i / (cols.length - 1)) * CTX_W;
    const y = (v: number) => CTX_H - (v / max) * (CTX_H - 6);
    const line = cols.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
    const area = `${line}L${CTX_W},${CTX_H}L0,${CTX_H}Z`;
    // A compaction sits between the last response before it and the first
    // after — place its marker at that seam.
    const marks = compactions.map((c) => {
      const after = points.findIndex((p) => p.idx > c.idx);
      const pos = after === -1 ? points.length - 1 : Math.max(0, after - 0.5);
      // Bucketing rounds up — clamp so a boundary near the session's end
      // never lands past the right edge of the viewBox.
      return Math.min((pos / bucket / (cols.length - 1)) * CTX_W, CTX_W);
    });
    return { line, area, max, cols, marks };
  }, [points, compactions]);

  if (points.length < 2) return null;

  /** The turn number holding a message idx — jump badges speak in turns. */
  const turnOf = (idx: number): number | null => {
    const list = turns.data?.turns ?? [];
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i]!.idx <= idx) return i + 1;
    }
    return null;
  };

  return (
    <div className="ctx-strip">
      <div className="ctx-head">
        <span className="ctx-title">context window</span>
        <span className="ctx-meta">
          peak {fmtTokens(max)} tok · {fmtCount(points.length)} responses
          {compactions.length > 0 &&
            ` · ${compactions.length} compaction${compactions.length === 1 ? '' : 's'}`}
        </span>
      </div>
      <svg
        className="ctx-svg"
        viewBox={`0 0 ${CTX_W} ${CTX_H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Context size over ${cols.length} responses, peak ${fmtTokens(max)} tokens`}
      >
        <path className="ctx-area" d={area} />
        <path className="ctx-line" d={line} vectorEffect="non-scaling-stroke" />
        {marks.map((x, i) => (
          <line
            key={i}
            className="ctx-compact-line"
            x1={x}
            y1={0}
            x2={x}
            y2={CTX_H}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      {compactions.length > 0 && (
        <div className="ctx-compactions">
          {compactions.map((c) => {
            const turn = turnOf(c.idx);
            return (
              <button
                key={c.idx}
                className="badge badge-summary ctx-compact-badge"
                onClick={() => navigate(sessionHash(sessionId, { m: c.idx }))}
                aria-label="Jump to the compaction point"
              >
                compacted{turn !== null ? ` · turn ${turn}` : ''}
                {c.preTokens !== null ? ` · was ${fmtTokens(c.preTokens)} tok` : ''}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
