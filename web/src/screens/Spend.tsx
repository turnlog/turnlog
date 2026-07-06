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

/**
 * HTML/div bars, not SVG — a full-width SVG with preserveAspectRatio="none"
 * stretches its text labels. Divs scale the bars and leave text at natural
 * size. Single series (magnitude over time): ink bars, accent on hover,
 * recessive grid, one direct label on the peak. Bars top out at 88% to leave
 * headroom for that label; hit target is the full-height column; the portal
 * Tooltip carries per-day detail.
 */
const BAR_MAX_PCT = 88;

function SpendChart({ data }: { data: SpendResponse }) {
  const days = useMemo(() => fillDays(data.days, data.sinceDays), [data]);
  const max = Math.max(...days.map((d) => d.costUsd), 0.01);
  const peak = days.reduce((best, d, i) => (d.costUsd > days[best]!.costUsd ? i : best), 0);
  const n = days.length;
  const gap = n > 45 ? 2 : 4; // ≥2px surface gap between marks
  const tickEvery = Math.max(1, Math.ceil(n / 6));
  const barPct = (v: number) => (v > 0 ? Math.max((v / max) * BAR_MAX_PCT, 1.5) : 0);

  return (
    <div
      className="spend-chart"
      role="img"
      aria-label={`Daily spend, last ${data.sinceDays} days. Total ${fmtCost(
        data.totals.costUsd,
      )}, peak ${shortDate(days[peak]!.date)} at ${fmtCost(days[peak]!.costUsd)}.`}
    >
      <div className="spend-plot" style={{ gap }}>
        {[0.25, 0.5, 0.75].map((f) => (
          <div key={f} className="spend-gridline" style={{ bottom: `${f * BAR_MAX_PCT}%` }} />
        ))}
        <div className="spend-baseline" />
        {days.map((d, i) => (
          <Tooltip
            key={d.date}
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
            {/* the column is the full-height hit target */}
            <div className="spend-col">
              {d.costUsd > 0 && (
                <div className="spend-bar" style={{ height: `${barPct(d.costUsd)}%` }} />
              )}
              {i === peak && d.costUsd > 0 && (
                <span className="spend-peak" style={{ bottom: `calc(${barPct(d.costUsd)}% + 5px)` }}>
                  {fmtCost(d.costUsd)}
                </span>
              )}
            </div>
          </Tooltip>
        ))}
      </div>
      <div className="spend-axis" style={{ gap }}>
        {days.map((d, i) => (
          <span key={d.date}>{i % tickEvery === 0 ? shortDate(d.date) : ''}</span>
        ))}
      </div>
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
