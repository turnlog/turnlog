import { useMemo, useState } from 'react';
import { useProjects, useSpend } from '../api';
import { navigate } from '../router';
import Calendar from './Calendar';
import { Skel, SkeletonRows } from '../components/Skeleton';
import Tooltip from '../components/Tooltip';
import { fmtCost, fmtCount, fmtModel, fmtTokens, projectName, tileClass } from '../format';
import type { SpendDay, SpendResponse } from '../types';

const PERIODS = [7, 30, 90] as const;

/* ── daily bars ──────────────────────────────────────────────────────
   Single series (magnitude over time): one hue — ink — with the hover
   state in accent. Zero-filled days keep the time axis honest; rounded
   data-ends anchor to the baseline; grid stays recessive; the peak day
   carries the one direct label; every day has a full-height hover
   target with a tooltip. */

const CHART_H = 168;
const LABEL_ZONE = 22;

function fillDays(days: SpendDay[], sinceDays: number): SpendDay[] {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const out: SpendDay[] = [];
  const now = new Date();
  for (let i = sinceDays - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86_400_000);
    const key = d.toISOString().slice(0, 10);
    out.push(byDate.get(key) ?? { date: key, costUsd: 0, tokens: 0, sessions: 0 });
  }
  return out;
}

function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function SpendChart({ data }: { data: SpendResponse }) {
  const days = useMemo(() => fillDays(data.days, data.sinceDays), [data]);
  const [hover, setHover] = useState<number | null>(null);

  const max = Math.max(...days.map((d) => d.costUsd), 0.01);
  const peak = days.reduce((best, d, i) => (d.costUsd > days[best]!.costUsd ? i : best), 0);
  const n = days.length;
  const W = 1000;
  const gap = n > 60 ? 2 : 4; // ≥2px surface gap between marks
  const bw = (W - gap * (n - 1)) / n;
  const plotH = CHART_H - LABEL_ZONE;
  const y = (v: number) => (v / max) * (plotH - 18);

  // Recessive grid: three quarter lines, labels in muted ink.
  const ticks = [0.25, 0.5, 0.75].map((f) => ({ f, v: max * f }));
  const tickEvery = Math.max(1, Math.ceil(n / 6));

  return (
    <div className="spend-chart">
      <svg
        viewBox={`0 0 ${W} ${CHART_H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Daily spend, last ${data.sinceDays} days. Total ${fmtCost(
          data.totals.costUsd,
        )}, peak day ${shortDate(days[peak]!.date)} at ${fmtCost(days[peak]!.costUsd)}.`}
      >
        {ticks.map((t) => (
          <line
            key={t.f}
            x1={0}
            x2={W}
            y1={plotH - y(t.v)}
            y2={plotH - y(t.v)}
            className="spend-grid"
          />
        ))}
        <line x1={0} x2={W} y1={plotH} y2={plotH} className="spend-baseline" />
        {days.map((d, i) => {
          const h = d.costUsd > 0 ? Math.max(y(d.costUsd), 2) : 0;
          const x = i * (bw + gap);
          const r = Math.min(4, bw / 2);
          return (
            <g key={d.date}>
              {h > 0 && (
                <path
                  className={`spend-bar ${hover === i ? 'hovered' : ''}`}
                  d={`M${x},${plotH} v${-(h - r)} q0,${-r} ${r},${-r} h${bw - 2 * r} q${r},0 ${r},${r} v${h - r} z`}
                />
              )}
              {/* full-height hit target (larger than the mark); the Tooltip
                  portals to body so edge bars never clip against the card. */}
              <Tooltip
                content={
                  <>
                    <strong>{fmtCost(d.costUsd)}</strong>
                    <span>
                      {shortDate(d.date)} · {fmtCount(d.sessions)} session
                      {d.sessions === 1 ? '' : 's'} · {fmtTokens(d.tokens)} tok
                    </span>
                  </>
                }
              >
                <rect
                  x={x - gap / 2}
                  y={0}
                  width={bw + gap}
                  height={plotH}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                />
              </Tooltip>
              {i % tickEvery === 0 && (
                <text x={x + bw / 2} y={CHART_H - 6} className="spend-xlabel" textAnchor="middle">
                  {shortDate(d.date)}
                </text>
              )}
            </g>
          );
        })}
        {/* the one direct label: the peak day */}
        {days[peak]!.costUsd > 0 && hover === null && (
          <text
            x={Math.min(Math.max(peak * (bw + gap) + bw / 2, 30), W - 30)}
            y={Math.max(plotH - y(days[peak]!.costUsd) - 8, 12)}
            className="spend-peak-label"
            textAnchor="middle"
          >
            {fmtCost(days[peak]!.costUsd)}
          </text>
        )}
      </svg>
    </div>
  );
}

/* ── exports ─────────────────────────────────────────────────────── */

function download(name: string, mime: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function toCsv(data: SpendResponse): string {
  const lines = ['section,key,cost_usd,tokens,sessions'];
  for (const d of data.days) lines.push(`day,${d.date},${d.costUsd},${d.tokens},${d.sessions}`);
  for (const m of data.byModel) lines.push(`model,${m.key},${m.costUsd},${m.tokens},${m.sessions}`);
  for (const p of data.byProject)
    lines.push(`project,${p.key},${p.costUsd},${p.tokens},${p.sessions}`);
  return lines.join('\n');
}

/* ── screen ──────────────────────────────────────────────────────── */

export default function Spend({ view = 'overview' }: { view?: 'overview' | 'calendar' }) {
  const [days, setDays] = useState<number>(30);
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState('');
  const spend = useSpend(days, applied);
  const projects = useProjects();
  const d = spend.data;

  // Real project names come from the projects endpoint (paths live there).
  const nameOf = useMemo(() => {
    const map = new Map(
      projects.data?.map((p) => [
        p.projectKey,
        projectName({ projectKey: p.projectKey, projectPath: p.projectPath }),
      ]) ?? [],
    );
    return (key: string) => map.get(key) ?? projectName({ projectKey: key, projectPath: null });
  }, [projects.data]);

  return (
    <div className="spend">
      <div className="spend-head">
        <h1>Spend</h1>
        <div className="view-toggle" role="tablist" aria-label="Spend view">
          <button
            role="tab"
            aria-selected={view === 'overview'}
            className={view === 'overview' ? 'active' : ''}
            onClick={() => navigate('#/spend')}
          >
            overview
          </button>
          <button
            role="tab"
            aria-selected={view === 'calendar'}
            className={view === 'calendar' ? 'active' : ''}
            onClick={() => navigate('#/spend?v=calendar')}
          >
            calendar
          </button>
        </div>
        {view === 'overview' && (
        <div className="view-toggle" role="tablist" aria-label="Period">
          {PERIODS.map((p) => (
            <button
              key={p}
              role="tab"
              aria-selected={days === p}
              className={days === p ? 'active' : ''}
              onClick={() => setDays(p)}
            >
              {p}d
            </button>
          ))}
        </div>
        )}
        {view === 'overview' && (
        <form
          className="spend-filter"
          onSubmit={(e) => {
            e.preventDefault();
            setApplied(q);
          }}
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Only work matching… (e.g. websocket)"
            aria-label="Filter spend by search query"
          />
        </form>
        )}
        {view === 'overview' && d && (
          <div className="spend-actions">
            <button className="pill" onClick={() => download('turnlog-spend.csv', 'text/csv', toCsv(d))}>
              CSV
            </button>
            <button
              className="pill"
              onClick={() =>
                download('turnlog-spend.json', 'application/json', JSON.stringify(d, null, 2))
              }
            >
              JSON
            </button>
          </div>
        )}
      </div>

      {view === 'calendar' ? (
        <Calendar />
      ) : d === undefined ? (
        <SkeletonRows n={7} tile={28} />
      ) : (
        <div className="spend-grid-layout">
          <section className="card spend-chart-card">
            <div className="spend-chart-head">
              <div>
                <strong className="spend-total">{fmtCost(d.totals.costUsd)}</strong>
                <span className="spend-total-sub">
                  est. · last {d.sinceDays} days · {fmtCount(d.totals.sessions)} session
                  {d.totals.sessions === 1 ? '' : 's'}
                  {d.query && (
                    <>
                      {' '}
                      matching <em>“{d.query}”</em>
                    </>
                  )}
                  {d.totals.unpricedSessions > 0 && <> · {d.totals.unpricedSessions} unpriced</>}
                </span>
              </div>
            </div>
            <SpendChart data={d} />
          </section>

          <section className="card list-card">
            <div className="list-card-head">
              <h2>By model</h2>
            </div>
            <ul className="split-list">
              {d.byModel.map((m) => (
                <li key={m.key}>
                  <span className={`tile tile-xs ${tileClass(m.key)}`}>
                    {fmtModel(m.key)[0]?.toUpperCase() ?? '·'}
                  </span>
                  <span className="split-name">{fmtModel(m.key)}</span>
                  <span className="split-meta">
                    {fmtTokens(m.tokens)} tok · {fmtCount(m.sessions)}s
                  </span>
                  <span className="split-cost">{fmtCost(m.costUsd)}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="card list-card">
            <div className="list-card-head">
              <h2>By project</h2>
            </div>
            <ul className="split-list">
              {d.byProject.map((p) => (
                <li key={p.key}>
                  <span className={`tile tile-xs ${tileClass(p.key)}`}>
                    {nameOf(p.key)[0]?.toUpperCase() ?? '·'}
                  </span>
                  <span className="split-name">{nameOf(p.key)}</span>
                  <span className="split-meta">
                    {fmtTokens(p.tokens)} tok · {fmtCount(p.sessions)}s
                  </span>
                  <span className="split-cost">{fmtCost(p.costUsd)}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="card dark-card spend-cache-card">
            <div className="dark-card-head">
              <h2>Prompt caching</h2>
              <span className="dark-chip">saved ~{fmtCost(d.totals.cacheSavedUsd)}</span>
            </div>
            <p className="spend-cache-note">
              {fmtTokens(d.totals.cacheReadTokens)} tokens read from cache at ~0.1× the input
              rate ({fmtTokens(d.totals.cacheWriteTokens)} written). Without caching this
              period would cost roughly{' '}
              {fmtCost(d.totals.costUsd + d.totals.cacheSavedUsd)}.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
