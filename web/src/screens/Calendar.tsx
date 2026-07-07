import { useMemo, useState } from 'react';
import { useSessionsRange } from '../api';
import { SkeletonRows } from '../components/Skeleton';
import Tooltip from '../components/Tooltip';
import { fmtCost, fmtCount, fmtTime, projectName, tileClass } from '../format';
import { navigate, sessionHash } from '../router';
import type { SessionMeta } from '../types';

/**
 * The calendar (roadmap Phase 2.7): sessions placed in time. Week view is a
 * day-column × time-axis grid; month view is a per-day heat of cost/count.
 * "When did I work / what was I doing Tuesday afternoon".
 */

const DAY_MS = 86_400_000;
const MIN_SPAN_H = 8;
const COL_H = 640;
const INNER_H = COL_H - 34; // column body height below the day header, px

type Mode = 'week' | 'month';

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function startOfWeek(d: Date): Date {
  const date = startOfDay(d);
  const dow = (date.getDay() + 6) % 7; // Monday = 0
  return new Date(date.getTime() - dow * DAY_MS);
}
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}
function sameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}

interface Placed {
  s: SessionMeta;
  startH: number;
  endH: number;
  lane: number;
  lanes: number;
}

/** Greedy lane assignment for overlapping sessions within one day. */
function placeDay(sessions: { s: SessionMeta; startH: number; endH: number }[]): Placed[] {
  const sorted = [...sessions].sort((a, b) => a.startH - b.startH);
  const laneEnds: number[] = [];
  const placed = sorted.map((item) => {
    let lane = laneEnds.findIndex((end) => end <= item.startH);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = item.endH;
    return { ...item, lane, lanes: 1 };
  });
  const lanes = Math.max(1, laneEnds.length);
  return placed.map((p) => ({ ...p, lanes }));
}

function BlockTip({ s }: { s: SessionMeta }) {
  return (
    <>
      <strong>{projectName(s)}</strong>
      <span>
        {fmtTime(s.startedAt)}
        {s.endedAt ? `–${fmtTime(s.endedAt)}` : ''} · {fmtCount(s.turnCount)} turns ·{' '}
        {fmtCost(s.costUsd)}
      </span>
    </>
  );
}

export default function Calendar() {
  const [mode, setMode] = useState<Mode>('week');
  const [anchor, setAnchor] = useState(() => new Date());

  // Fetch range depends on mode.
  const weekStart = useMemo(() => startOfWeek(anchor), [anchor]);
  const monthGrid = useMemo(() => {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const gridStart = startOfWeek(first);
    const daysInMonth = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();
    const offset = (first.getDay() + 6) % 7;
    const weeks = Math.ceil((offset + daysInMonth) / 7);
    return { gridStart, weeks, month: anchor.getMonth() };
  }, [anchor]);

  const [rangeStart, rangeEnd] =
    mode === 'week'
      ? [weekStart, new Date(weekStart.getTime() + 7 * DAY_MS)]
      : [monthGrid.gridStart, new Date(monthGrid.gridStart.getTime() + monthGrid.weeks * 7 * DAY_MS)];
  const sessions = useSessionsRange(rangeStart.toISOString(), rangeEnd.toISOString());

  const buckets = useMemo(() => {
    const map = new Map<string, SessionMeta[]>();
    for (const s of sessions.data ?? []) {
      if (!s.startedAt) continue;
      const key = dayKey(new Date(s.startedAt));
      (map.get(key) ?? map.set(key, []).get(key)!).push(s);
    }
    return map;
  }, [sessions.data]);

  const today = new Date();
  const jump = (deltaDays: number) => setAnchor(new Date(anchor.getTime() + deltaDays * DAY_MS));
  const jumpMonth = (delta: number) =>
    setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + delta, 1));

  const rangeLabel =
    mode === 'week'
      ? `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${new Date(
          weekStart.getTime() + 6 * DAY_MS,
        ).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
      : anchor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const isCurrentPeriod =
    mode === 'week'
      ? startOfWeek(today).getTime() === weekStart.getTime()
      : today.getFullYear() === anchor.getFullYear() && today.getMonth() === anchor.getMonth();

  return (
    <div className="calendar">
      <div className="calendar-head">
        <div className="view-toggle" role="tablist" aria-label="Calendar mode">
          <button
            role="tab"
            aria-selected={mode === 'week'}
            className={mode === 'week' ? 'active' : ''}
            onClick={() => setMode('week')}
          >
            week
          </button>
          <button
            role="tab"
            aria-selected={mode === 'month'}
            className={mode === 'month' ? 'active' : ''}
            onClick={() => setMode('month')}
          >
            month
          </button>
        </div>
        <span className="calendar-range">{rangeLabel}</span>
        <div className="calendar-nav">
          <Tooltip content={mode === 'week' ? 'Previous week' : 'Previous month'}>
            <button
              className="circle circle-sm"
              onClick={() => (mode === 'week' ? jump(-7) : jumpMonth(-1))}
              aria-label={mode === 'week' ? 'Previous week' : 'Previous month'}
            >
              ←
            </button>
          </Tooltip>
          <button className="pill" disabled={isCurrentPeriod} onClick={() => setAnchor(new Date())}>
            {mode === 'week' ? 'This week' : 'This month'}
          </button>
          <Tooltip content={mode === 'week' ? 'Next week' : 'Next month'}>
            <button
              className="circle circle-sm"
              onClick={() => (mode === 'week' ? jump(7) : jumpMonth(1))}
              aria-label={mode === 'week' ? 'Next week' : 'Next month'}
              disabled={isCurrentPeriod}
            >
              →
            </button>
          </Tooltip>
        </div>
      </div>

      {sessions.isLoading ? (
        <SkeletonRows n={6} tile={30} />
      ) : mode === 'week' ? (
        <WeekGrid weekStart={weekStart} buckets={buckets} today={today} />
      ) : (
        <MonthGrid
          grid={monthGrid}
          buckets={buckets}
          today={today}
          onPickDay={(d) => {
            setAnchor(d);
            setMode('week');
          }}
        />
      )}
    </div>
  );
}

/* ── week grid ───────────────────────────────────────────────────────── */

function WeekGrid({
  weekStart,
  buckets,
  today,
}: {
  weekStart: Date;
  buckets: Map<string, SessionMeta[]>;
  today: Date;
}) {
  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(weekStart.getTime() + i * DAY_MS);
      const list = buckets.get(dayKey(date)) ?? [];
      const placed = list.map((s) => {
        const start = new Date(s.startedAt!);
        const end = s.endedAt ? new Date(s.endedAt) : new Date(start.getTime() + 15 * 60_000);
        const startH = start.getHours() + start.getMinutes() / 60;
        const endH = Math.min(
          (end.getTime() - startOfDay(start).getTime()) / 3_600_000,
          24,
        );
        return { s, startH, endH: Math.max(endH, startH + 0.25) };
      });
      return placeDay(placed);
    });
  }, [weekStart, buckets]);

  const [h0, h1] = useMemo(() => {
    const all = days.flat();
    if (all.length === 0) return [9, 9 + MIN_SPAN_H];
    let lo = Math.floor(Math.min(...all.map((p) => p.startH)));
    let hi = Math.ceil(Math.max(...all.map((p) => p.endH)));
    while (hi - lo < MIN_SPAN_H) {
      if (lo > 0) lo--;
      else hi++;
    }
    return [Math.max(0, lo), Math.min(24, hi)];
  }, [days]);
  const span = h1 - h0;
  const yPct = (h: number) => ((h - h0) / span) * 100;
  const isThisWeek = startOfWeek(today).getTime() === weekStart.getTime();

  const hourTicks = useMemo(() => {
    const step = span > 14 ? 4 : 2;
    const ticks: number[] = [];
    for (let h = Math.ceil(h0 / step) * step; h <= h1; h += step) ticks.push(h);
    return ticks;
  }, [h0, h1, span]);

  return (
    <div className="card calendar-card">
      <div className="calendar-grid" style={{ height: COL_H }}>
        <div className="calendar-gutter">
          {hourTicks.map((h) => (
            <span key={h} className="calendar-hour" style={{ top: `${yPct(h)}%` }}>
              {String(h).padStart(2, '0')}:00
            </span>
          ))}
        </div>
        {days.map((placed, i) => {
          const date = new Date(weekStart.getTime() + i * DAY_MS);
          const isToday = sameDay(date, today) && isThisWeek;
          return (
            <div key={i} className={`calendar-day ${isToday ? 'today' : ''}`}>
              <div className="calendar-day-head">
                <span className="calendar-dow">
                  {date.toLocaleDateString('en-US', { weekday: 'short' })}
                </span>
                <span className={`calendar-date ${isToday ? 'today' : ''}`}>{date.getDate()}</span>
              </div>
              <div className="calendar-col">
                {hourTicks.map((h) => (
                  <span key={h} className="calendar-line" style={{ top: `${yPct(h)}%` }} />
                ))}
                {placed.map(({ s, startH, endH, lane, lanes }) => {
                  const top = yPct(startH);
                  // Real height in px — never inflated, so blocks never bleed
                  // over their neighbours. Content degrades to fit the space:
                  // full (name + cost) → compact (name) → bar (color only,
                  // details on hover). Many concurrent lanes force compact.
                  const realPx = ((yPct(endH) - top) / 100) * INNER_H;
                  const tier =
                    realPx >= 42 && lanes <= 2 ? 'full' : realPx >= 20 ? 'compact' : 'bar';
                  const heightPx = Math.max(realPx, tier === 'bar' ? 5 : realPx);
                  return (
                    <Tooltip key={s.id} content={<BlockTip s={s} />}>
                      <button
                        className={`calendar-block tier-${tier} ${tileClass(s.projectKey)}`}
                        style={{
                          top: `${top}%`,
                          height: `${heightPx}px`,
                          left: `${(lane / lanes) * 100}%`,
                          width: `calc(${100 / lanes}% - 3px)`,
                        }}
                        onClick={() => navigate(sessionHash(s.id))}
                      >
                        {tier !== 'bar' && (
                          <span className="calendar-block-name">{projectName(s)}</span>
                        )}
                        {tier === 'full' && (
                          <span className="calendar-block-meta">{fmtCost(s.costUsd)}</span>
                        )}
                      </button>
                    </Tooltip>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── month grid ──────────────────────────────────────────────────────── */

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function MonthGrid({
  grid,
  buckets,
  today,
  onPickDay,
}: {
  grid: { gridStart: Date; weeks: number; month: number };
  buckets: Map<string, SessionMeta[]>;
  today: Date;
  onPickDay: (d: Date) => void;
}) {
  const maxCost = useMemo(() => {
    let m = 0;
    for (let i = 0; i < grid.weeks * 7; i++) {
      const d = new Date(grid.gridStart.getTime() + i * DAY_MS);
      const list = buckets.get(dayKey(d)) ?? [];
      m = Math.max(m, list.reduce((n, s) => n + (s.costUsd ?? 0), 0));
    }
    return Math.max(m, 0.01);
  }, [grid, buckets]);

  return (
    <div className="card calendar-card month">
      <div className="month-dow-row">
        {DOW.map((d) => (
          <span key={d} className="month-dow">
            {d}
          </span>
        ))}
      </div>
      <div className="month-grid" style={{ gridTemplateRows: `repeat(${grid.weeks}, 1fr)` }}>
        {Array.from({ length: grid.weeks * 7 }, (_, i) => {
          const date = new Date(grid.gridStart.getTime() + i * DAY_MS);
          const list = buckets.get(dayKey(date)) ?? [];
          const cost = list.reduce((n, s) => n + (s.costUsd ?? 0), 0);
          const other = date.getMonth() !== grid.month;
          const isToday = sameDay(date, today);
          const projects = [...new Set(list.map((s) => s.projectKey))].slice(0, 4);
          const heat = cost > 0 ? 0.06 + (cost / maxCost) * 0.32 : 0;
          const cell = (
            <button
              className={`month-cell ${other ? 'other' : ''} ${list.length ? 'has' : ''}`}
              style={heat > 0 ? { background: `rgba(240,102,63,${heat})` } : undefined}
              onClick={() => list.length && onPickDay(date)}
              disabled={list.length === 0}
            >
              <span className={`month-date ${isToday ? 'today' : ''}`}>{date.getDate()}</span>
              {list.length > 0 && (
                <>
                  <span className="month-cost">{fmtCost(cost)}</span>
                  <span className="month-dots">
                    {projects.map((p) => (
                      <span key={p ?? '·'} className={`tile-dot ${tileClass(p)}`} />
                    ))}
                    <span className="month-count">{list.length}</span>
                  </span>
                </>
              )}
            </button>
          );
          return list.length > 0 ? (
            <Tooltip
              key={i}
              content={
                <>
                  <strong>
                    {date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                  </strong>
                  <span>
                    {fmtCount(list.length)} session{list.length === 1 ? '' : 's'} · {fmtCost(cost)} ·{' '}
                    {projects.map((p) => projectName({ projectKey: p, projectPath: null })).join(', ')}
                  </span>
                </>
              }
            >
              {cell}
            </Tooltip>
          ) : (
            // display:contents wrapper so the button is the grid item and
            // stretches to the column (Tooltip does this for filled cells).
            <div key={i} className="month-cell-wrap">
              {cell}
            </div>
          );
        })}
      </div>
    </div>
  );
}
