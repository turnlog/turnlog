import { useEffect, useMemo, useRef, useState } from 'react';
import { useSessionsRange } from '../api';
import { agentInfo } from '../agents';
import { useHideEmpty } from '../filterStore';
import Button from '../components/Button';
import IconButton from '../components/IconButton';
import Segmented from '../components/Segmented';
import { SkeletonRows } from '../components/Skeleton';
import Tooltip from '../components/Tooltip';
import {
  DAY_MS,
  dayKey,
  fmtCost,
  fmtCount,
  fmtTime,
  fmtTokens,
  projectName,
  sessionName,
  startOfDay,
  startOfWeek,
  tileClass,
} from '../format';
import { ChevronLeftIcon, ChevronRightIcon } from '../icons';
import { navigate, sessionHash } from '../router';
import { getPref, setPref } from '../prefs';
import type { SessionMeta } from '../types';

/**
 * The calendar: sessions placed in time. Week view is a
 * day-row × time-axis timeline (days stack vertically, hours run across —
 * sessions read as horizontal Gantt-style blocks); month view is a per-day
 * heat of cost/count. "When did I work / what was I doing Tuesday afternoon".
 */

const MIN_SPAN_H = 8;
const ROW_H = 56; // px per day row; lanes divide it when sessions overlap
const HEAD_W = 64; // day-label gutter (row head width + gap), px

type Mode = 'week' | 'month';
type ColorBy = 'project' | 'agent';

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
      <strong>{sessionName(s)}</strong>
      <span>
        {fmtTime(s.startedAt)}
        {s.endedAt ? `–${fmtTime(s.endedAt)}` : ''} · {fmtCount(s.turnCount)} turns ·{' '}
        {fmtTokens(s.inputTokens + s.outputTokens)} tok · {fmtCost(s.costUsd)} ·{' '}
        {agentInfo(s.tool).label}
      </span>
    </>
  );
}

export default function Calendar() {
  const [mode, setMode] = useState<Mode>('week');
  const [anchor, setAnchor] = useState(() => new Date());
  // Blocks color by project (default) or by agent; the OTHER dimension
  // becomes the edge stripe, so both signals stay visible either way.
  const [colorBy, setColorBy] = useState<ColorBy>(() =>
    getPref('calendarColor') === 'agent' ? 'agent' : 'project',
  );
  const setColorByPersist = (v: ColorBy) => {
    setPref('calendarColor', v);
    setColorBy(v);
  };

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
      : [
          monthGrid.gridStart,
          new Date(monthGrid.gridStart.getTime() + monthGrid.weeks * 7 * DAY_MS),
        ];
  const hideEmpty = useHideEmpty();
  const sessions = useSessionsRange(rangeStart.toISOString(), rangeEnd.toISOString(), hideEmpty);

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
        <Segmented
          fill="card"
          ariaLabel="Calendar mode"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'week', label: 'week' },
            { value: 'month', label: 'month' },
          ]}
        />
        <Segmented
          fill="card"
          ariaLabel="Color blocks by"
          value={colorBy}
          onChange={setColorByPersist}
          options={[
            { value: 'project', label: 'projects' },
            { value: 'agent', label: 'agents' },
          ]}
        />
        <span className="calendar-range">{rangeLabel}</span>
        <div className="calendar-nav">
          <IconButton
            fill="card"
            label={mode === 'week' ? 'Previous week' : 'Previous month'}
            tooltip={mode === 'week' ? 'Previous week' : 'Previous month'}
            onClick={() => (mode === 'week' ? jump(-7) : jumpMonth(-1))}
          >
            <ChevronLeftIcon size={16} />
          </IconButton>
          <Button fill="card" disabled={isCurrentPeriod} onClick={() => setAnchor(new Date())}>
            {mode === 'week' ? 'This week' : 'This month'}
          </Button>
          <IconButton
            fill="card"
            label={mode === 'week' ? 'Next week' : 'Next month'}
            tooltip={mode === 'week' ? 'Next week' : 'Next month'}
            onClick={() => (mode === 'week' ? jump(7) : jumpMonth(1))}
            disabled={isCurrentPeriod}
          >
            <ChevronRightIcon size={16} />
          </IconButton>
        </div>
      </div>

      {sessions.isLoading ? (
        <SkeletonRows n={6} tile={30} />
      ) : mode === 'week' ? (
        <WeekGrid weekStart={weekStart} buckets={buckets} today={today} colorBy={colorBy} />
      ) : (
        <MonthGrid
          grid={monthGrid}
          buckets={buckets}
          today={today}
          colorBy={colorBy}
          onPickDay={(d) => {
            setAnchor(d);
            setMode('week');
          }}
        />
      )}
    </div>
  );
}

/* ── week grid (day rows × time columns) ─────────────────────────────── */

/** Track width in px, kept current via ResizeObserver — tier decisions need it. */
function useTrackWidth(): [React.RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(960);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setW(Math.max(el.clientWidth - HEAD_W, 1));
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function WeekGrid({
  weekStart,
  buckets,
  today,
  colorBy,
}: {
  weekStart: Date;
  buckets: Map<string, SessionMeta[]>;
  today: Date;
  colorBy: ColorBy;
}) {
  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(weekStart.getTime() + i * DAY_MS);
      const list = buckets.get(dayKey(date)) ?? [];
      const placed = list.map((s) => {
        const start = new Date(s.startedAt!);
        const end = s.endedAt ? new Date(s.endedAt) : new Date(start.getTime() + 15 * 60_000);
        const startH = start.getHours() + start.getMinutes() / 60;
        const endH = Math.min((end.getTime() - startOfDay(start).getTime()) / 3_600_000, 24);
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
  const xPct = (h: number) => ((h - h0) / span) * 100;
  const isThisWeek = startOfWeek(today).getTime() === weekStart.getTime();
  const [gridRef, trackW] = useTrackWidth();

  const hourTicks = useMemo(() => {
    const step = span > 14 ? 4 : 2;
    const ticks: number[] = [];
    for (let h = Math.ceil(h0 / step) * step; h <= h1; h += step) ticks.push(h);
    return ticks;
  }, [h0, h1, span]);

  return (
    <div className="card calendar-card">
      <div className="calendar-week" ref={gridRef}>
        <div className="calendar-axis">
          {hourTicks.map((h) => (
            <span key={h} className="calendar-axis-hour" style={{ left: `${xPct(h)}%` }}>
              {String(h).padStart(2, '0')}:00
            </span>
          ))}
        </div>
        {days.map((placed, i) => {
          const date = new Date(weekStart.getTime() + i * DAY_MS);
          const isToday = sameDay(date, today) && isThisWeek;
          return (
            <div key={i} className={`calendar-week-row ${isToday ? 'today' : ''}`}>
              <div className="calendar-row-head">
                <span className="calendar-dow">
                  {date.toLocaleDateString('en-US', { weekday: 'short' })}
                </span>
                <span className={`calendar-date ${isToday ? 'today' : ''}`}>{date.getDate()}</span>
              </div>
              <div className="calendar-row-track" style={{ height: ROW_H }}>
                {hourTicks.map((h) => (
                  <span key={h} className="calendar-vline" style={{ left: `${xPct(h)}%` }} />
                ))}
                {placed.map(({ s, startH, endH, lane, lanes }) => {
                  const left = xPct(startH);
                  // Real width in px — never inflated, so blocks never bleed
                  // over their neighbours. Content degrades to fit the space:
                  // full (name + cost) → compact (name) → bar (color only,
                  // details on hover). Stacked lanes shrink the row share.
                  const widthPx = ((xPct(endH) - left) / 100) * trackW;
                  const laneH = ROW_H / lanes;
                  const tier =
                    widthPx >= 96 && laneH >= 18
                      ? 'full'
                      : widthPx >= 40 && laneH >= 13
                        ? 'compact'
                        : 'bar';
                  return (
                    <Tooltip key={s.id} content={<BlockTip s={s} />}>
                      <button
                        className={`calendar-block tier-${tier} ${tileClass(s.projectKey)} ${agentInfo(s.tool).colorClass} ${colorBy === 'agent' ? 'mode-agent' : ''}`}
                        style={{
                          left: `${left}%`,
                          width: `max(${Math.max(widthPx, 0)}px, 5px)`,
                          top: `calc(${(lane / lanes) * 100}% + 1.5px)`,
                          height: `calc(${100 / lanes}% - 3px)`,
                        }}
                        onClick={() => navigate(sessionHash(s.id))}
                      >
                        {tier !== 'bar' && (
                          <span className="calendar-block-name">{sessionName(s)}</span>
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
  colorBy,
  onPickDay,
}: {
  grid: { gridStart: Date; weeks: number; month: number };
  buckets: Map<string, SessionMeta[]>;
  today: Date;
  colorBy: ColorBy;
  onPickDay: (d: Date) => void;
}) {
  const maxCost = useMemo(() => {
    let m = 0;
    for (let i = 0; i < grid.weeks * 7; i++) {
      const d = new Date(grid.gridStart.getTime() + i * DAY_MS);
      const list = buckets.get(dayKey(d)) ?? [];
      m = Math.max(
        m,
        list.reduce((n, s) => n + (s.costUsd ?? 0), 0),
      );
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
          const tokens = list.reduce((n, s) => n + s.inputTokens + s.outputTokens, 0);
          const other = date.getMonth() !== grid.month;
          const isToday = sameDay(date, today);
          const dotClasses =
            colorBy === 'agent'
              ? [...new Set(list.map((s) => agentInfo(s.tool).colorClass))].slice(0, 4)
              : [...new Set(list.map((s) => tileClass(s.projectKey)))].slice(0, 4);
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
                    {dotClasses.map((c) => (
                      <span key={c} className={`tile-dot ${c}`} />
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
                    {date.toLocaleDateString('en-US', {
                      weekday: 'long',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </strong>
                  <span>
                    {fmtCount(list.length)} session{list.length === 1 ? '' : 's'} ·{' '}
                    {fmtTokens(tokens)} tok · {fmtCost(cost)} ·{' '}
                    {[...new Set(list.map((s) => s.projectKey))]
                      .map((p) => projectName({ projectKey: p, projectPath: null }))
                      .join(', ')}
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
