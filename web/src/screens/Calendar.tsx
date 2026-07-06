import { useMemo, useState } from 'react';
import { useSessionsRange, useStatus, useTrialOpenIds } from '../api';
import { SkeletonRows } from '../components/Skeleton';
import { fmtCost, fmtCount, fmtTime, projectName, tileClass } from '../format';
import { navigate, sessionHash } from '../router';
import type { SessionMeta } from '../types';

/**
 * The calendar (roadmap Phase 2.7): a week of day columns × a time axis,
 * sessions as project-colored blocks at their real start times and
 * durations — "what was I doing Tuesday afternoon".
 */

const DAY_MS = 86_400_000;
const MIN_SPAN_H = 8;
const MIN_BLOCK_PX = 22;
const COL_H = 640;

function startOfWeek(d: Date): Date {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (date.getDay() + 6) % 7; // Monday = 0
  return new Date(date.getTime() - dow * DAY_MS);
}

interface Placed {
  s: SessionMeta;
  startH: number; // hours since local midnight
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

export default function Calendar() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const weekEnd = useMemo(() => new Date(weekStart.getTime() + 7 * DAY_MS), [weekStart]);
  const sessions = useSessionsRange(weekStart.toISOString(), weekEnd.toISOString());

  const status = useStatus();
  const licensed = status.data?.licensed ?? true;
  const trialOpen = useTrialOpenIds(!licensed);
  const isLocked = (s: SessionMeta) =>
    !licensed && trialOpen.data !== undefined && !trialOpen.data.has(s.id);

  const days = useMemo(() => {
    const buckets: { s: SessionMeta; startH: number; endH: number }[][] = Array.from(
      { length: 7 },
      () => [],
    );
    for (const s of sessions.data ?? []) {
      if (!s.startedAt) continue;
      const start = new Date(s.startedAt);
      const end = s.endedAt ? new Date(s.endedAt) : new Date(start.getTime() + 15 * 60_000);
      const dayIdx = Math.floor(
        (startOfWeek(start).getTime() === weekStart.getTime()
          ? start.getTime() - weekStart.getTime()
          : -1) / DAY_MS,
      );
      if (dayIdx < 0 || dayIdx > 6) continue;
      const startH = start.getHours() + start.getMinutes() / 60;
      // Blocks clamp to their start day — multi-day sessions cap at midnight.
      const endSameDay = Math.min(
        (end.getTime() - (weekStart.getTime() + dayIdx * DAY_MS)) / 3_600_000,
        24,
      );
      buckets[dayIdx]!.push({ s, startH, endH: Math.max(endSameDay, startH + 0.25) });
    }
    return buckets.map(placeDay);
  }, [sessions.data, weekStart]);

  // Dynamic hour window over the whole week, minimum 8h span.
  const [h0, h1] = useMemo(() => {
    const all = days.flat();
    if (all.length === 0) return [9, 9 + MIN_SPAN_H];
    let lo = Math.floor(Math.min(...all.map((p) => p.startH)));
    let hi = Math.ceil(Math.max(...all.map((p) => p.endH)));
    while (hi - lo < MIN_SPAN_H) {
      if (lo > 0) lo--;
      else hi++;
    }
    return [Math.max(0, lo - 0), Math.min(24, hi)];
  }, [days]);
  const span = h1 - h0;
  const yPct = (h: number) => ((h - h0) / span) * 100;

  const today = new Date();
  const isThisWeek = startOfWeek(today).getTime() === weekStart.getTime();
  const fmtRange = `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${new Date(
    weekEnd.getTime() - DAY_MS,
  ).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

  const hourTicks = useMemo(() => {
    const step = span > 14 ? 4 : 2;
    const ticks: number[] = [];
    for (let h = Math.ceil(h0 / step) * step; h <= h1; h += step) ticks.push(h);
    return ticks;
  }, [h0, h1, span]);

  return (
    <div className="calendar">
      <div className="calendar-head">
        <span className="calendar-range">{fmtRange}</span>
        <div className="calendar-nav">
          <button
            className="circle circle-sm"
            onClick={() => setWeekStart(new Date(weekStart.getTime() - 7 * DAY_MS))}
            aria-label="Previous week"
          >
            ←
          </button>
          <button
            className="pill"
            disabled={isThisWeek}
            onClick={() => setWeekStart(startOfWeek(new Date()))}
          >
            This week
          </button>
          <button
            className="circle circle-sm"
            onClick={() => setWeekStart(new Date(weekStart.getTime() + 7 * DAY_MS))}
            aria-label="Next week"
            disabled={isThisWeek}
          >
            →
          </button>
        </div>
      </div>

      {sessions.isLoading ? (
        <SkeletonRows n={6} tile={30} />
      ) : (
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
              const isToday =
                date.toDateString() === today.toDateString() && isThisWeek;
              return (
                <div key={i} className={`calendar-day ${isToday ? 'today' : ''}`}>
                  <div className="calendar-day-head">
                    <span className="calendar-dow">
                      {date.toLocaleDateString('en-US', { weekday: 'short' })}
                    </span>
                    <span className={`calendar-date ${isToday ? 'today' : ''}`}>
                      {date.getDate()}
                    </span>
                  </div>
                  <div className="calendar-col">
                    {hourTicks.map((h) => (
                      <span key={h} className="calendar-line" style={{ top: `${yPct(h)}%` }} />
                    ))}
                    {placed.map(({ s, startH, endH, lane, lanes }) => {
                      const locked = isLocked(s);
                      const top = yPct(startH);
                      const height = Math.max(
                        yPct(endH) - top,
                        (MIN_BLOCK_PX / (COL_H - 34)) * 100,
                      );
                      return (
                        <button
                          key={s.id}
                          className={`calendar-block ${tileClass(s.projectKey)} ${locked ? 'locked' : ''}`}
                          style={{
                            top: `${top}%`,
                            height: `${height}%`,
                            left: `${(lane / lanes) * 100}%`,
                            width: `calc(${100 / lanes}% - 3px)`,
                          }}
                          onClick={() => {
                            if (!locked) navigate(sessionHash(s.id));
                          }}
                          title={`${projectName(s)} · ${fmtTime(s.startedAt)}–${fmtTime(
                            s.endedAt,
                          )} · ${fmtCount(s.turnCount)} turns · ${fmtCost(s.costUsd)}${
                            locked ? ' · locked (trial)' : ''
                          }`}
                        >
                          <span className="calendar-block-name">{projectName(s)}</span>
                          <span className="calendar-block-meta">{fmtCost(s.costUsd)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
