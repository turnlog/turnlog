import { useEffect, useMemo, useRef, useState } from 'react';
import {
  useDeleteSavedSearch,
  useHealth,
  useSavedSearches,
  useSaveSearch,
  useSearch,
  useSearchTimeline,
} from '../api';
import { agentInfo } from '../agents';
import Badge from '../components/Badge';
import IconButton from '../components/IconButton';
import SearchField from '../components/SearchField';
import Segmented from '../components/Segmented';
import { SkeletonRows } from '../components/Skeleton';
import Tooltip from '../components/Tooltip';
import { CloseIcon } from '../icons';
import {
  DAY_MS,
  dayKey,
  fmtCost,
  fmtCount,
  fmtDate,
  fmtTime,
  projectName,
  sessionName,
  startOfDay,
  startOfWeek,
  tileClass,
} from '../format';
import { navigate, searchHash, sessionHash } from '../router';
import { SNIPPET_CLOSE, SNIPPET_OPEN, type SearchHit, type TimelineSession } from '../types';

/**
 * FTS5 snippets arrive with U+E000/U+E001 marking match boundaries — chosen
 * server-side so the text needs no HTML unescaping here; we just split on
 * the markers and let React escape everything.
 */
function Snippet({ text }: { text: string }) {
  const parts = useMemo(() => {
    const out: { mark: boolean; text: string }[] = [];
    let mark = false;
    let buf = '';
    for (const ch of text) {
      if (ch === SNIPPET_OPEN || ch === SNIPPET_CLOSE) {
        if (buf) out.push({ mark, text: buf });
        buf = '';
        mark = ch === SNIPPET_OPEN;
      } else {
        buf += ch;
      }
    }
    if (buf) out.push({ mark, text: buf });
    return out;
  }, [text]);

  return (
    <span className="snippet">
      {parts.map((p, i) =>
        p.mark ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>,
      )}
    </span>
  );
}

function kindLabel(hit: SearchHit, tool: string): string {
  if (hit.kind === 'tool_use' || hit.kind === 'tool_result') {
    return hit.toolName ?? hit.kind.replace('_', ' ');
  }
  if (hit.kind === 'prompt') return 'you';
  if (hit.kind === 'assistant') return agentInfo(tool).label;
  return hit.kind;
}

const DEBOUNCE_MS = 200;

/* ── search-anchored timeline ───────────────────────────────────────── */

/** Past this span, day columns collapse into week columns. */
const WEEKLY_PAST_DAYS = 180;

interface TimelineBucket {
  key: string;
  date: Date;
  sessions: TimelineSession[];
}

/**
 * Continuous day (or week) buckets from the first matched session to the
 * last — gaps stay visible; an empty month IS the answer to "when did this
 * keep coming up?".
 */
function buildBuckets(sessions: TimelineSession[]): { buckets: TimelineBucket[]; weekly: boolean } {
  const dated = sessions.filter((t) => t.session.startedAt !== null);
  if (dated.length === 0) return { buckets: [], weekly: false };
  const first = startOfDay(new Date(dated[0]!.session.startedAt!));
  const last = startOfDay(new Date(dated[dated.length - 1]!.session.startedAt!));
  const spanDays = Math.round((last.getTime() - first.getTime()) / DAY_MS) + 1;
  const weekly = spanDays > WEEKLY_PAST_DAYS;

  // Weeks bucket on their Monday, like the calendar grid.
  const start = weekly ? startOfWeek(first) : first;

  const buckets: TimelineBucket[] = [];
  const byKey = new Map<string, TimelineBucket>();
  for (
    const d = new Date(start);
    d.getTime() <= last.getTime();
    d.setDate(d.getDate() + (weekly ? 7 : 1))
  ) {
    const bucket = { key: dayKey(d), date: new Date(d), sessions: [] };
    buckets.push(bucket);
    byKey.set(bucket.key, bucket);
  }
  for (const t of dated) {
    const day = startOfDay(new Date(t.session.startedAt!));
    byKey.get(dayKey(weekly ? startOfWeek(day) : day))?.sessions.push(t);
  }
  return { buckets, weekly };
}

/** Month labels above the strip, each spanning its buckets. */
function monthSpans(buckets: TimelineBucket[]): { label: string; span: number }[] {
  const out: { label: string; span: number }[] = [];
  for (const b of buckets) {
    const label = b.date.toLocaleDateString('en-US', {
      month: 'short',
      ...(b.date.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }),
    });
    const lastSpan = out[out.length - 1];
    if (lastSpan && lastSpan.label === label) lastSpan.span++;
    else out.push({ label, span: 1 });
  }
  return out;
}

function TimelineView({ query }: { query: string }) {
  const timeline = useSearchTimeline(query);
  const sessions = timeline.data?.sessions ?? [];
  const { buckets, weekly } = useMemo(() => buildBuckets(sessions), [sessions]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Most recent activity is the likely target — start scrolled to the end.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [timeline.data]);

  if (query === '') return null;
  if (timeline.isLoading && sessions.length === 0) return <SkeletonRows n={3} tile={28} />;
  if (buckets.length === 0) {
    return (
      <div className="fullscreen-note">
        <div>
          <h1>No matches</h1>
          <p>Nothing to place on the timeline — try a broader query.</p>
        </div>
      </div>
    );
  }

  const firstDay = buckets[0]!.date;
  const lastDay = buckets[buckets.length - 1]!.date;
  const fmtSpanDay = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div className="tl-card">
      <div className="tl-scroll" ref={scrollRef}>
        <div className="tl-inner">
          <div className="tl-months">
            {monthSpans(buckets).map((m, i) => (
              <span key={i} className="tl-month" style={{ ['--span' as string]: m.span }}>
                {m.label}
              </span>
            ))}
          </div>
          <div className="tl-strip">
            {buckets.map((b) => (
              <div
                key={b.key}
                className={`tl-col ${!weekly && (b.date.getDay() === 0 || b.date.getDay() === 6) ? 'weekend' : ''}`}
              >
                {b.sessions.map((t) => (
                  <Tooltip
                    key={t.session.id}
                    content={
                      <div className="tooltip-row">
                        {sessionName(t.session)}
                        <span className="tooltip-num">
                          {fmtDate(t.session.startedAt)} · {t.hits} hit{t.hits === 1 ? '' : 's'}
                        </span>
                      </div>
                    }
                  >
                    <button
                      className={`tl-dot ${tileClass(t.session.projectKey)} ${t.hits >= 5 ? 'big' : ''}`}
                      onClick={() =>
                        navigate(
                          sessionHash(t.session.id, {
                            ...(t.firstIdx !== null ? { m: t.firstIdx } : {}),
                            q: query,
                          }),
                        )
                      }
                      aria-label={`Open ${sessionName(t.session)}, ${t.hits} hits, ${fmtDate(t.session.startedAt)}`}
                    />
                  </Tooltip>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="tl-foot">
        {fmtCount(sessions.length)} session{sessions.length === 1 ? '' : 's'} ·{' '}
        {fmtSpanDay(firstDay)} — {fmtSpanDay(lastDay)}
        {weekly ? ' · one column per week' : ''}
      </div>
    </div>
  );
}

/** Saved-search badges + the save control for the current query. */
function SavedSearches({ query }: { query: string }) {
  const saved = useSavedSearches();
  const save = useSaveSearch();
  const remove = useDeleteSavedSearch();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');

  const alreadySaved = saved.data?.some((s) => s.query === query) ?? false;
  const submit = () => {
    save.mutate({ name: name.trim() || null, query });
    setNaming(false);
    setName('');
  };

  if ((saved.data?.length ?? 0) === 0 && query === '') return null;

  return (
    <div className="saved-row">
      {saved.data?.map((s) => (
        <span key={s.id} className="saved-badge">
          <button
            className="saved-badge-run"
            onClick={() => navigate(searchHash(s.query))}
            title={s.query}
          >
            {s.name}
          </button>
          <IconButton
            fill="ghost"
            label={`Delete saved search ${s.name}`}
            tooltip="Delete saved search"
            className="saved-badge-x"
            onClick={() => remove.mutate(s.id)}
          >
            <CloseIcon size={11} />
          </IconButton>
        </span>
      ))}
      {query !== '' && !alreadySaved && !naming && (
        <button className="saved-add" onClick={() => setNaming(true)}>
          + save this search
        </button>
      )}
      {naming && (
        <form
          className="saved-name-form"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setNaming(false);
            }}
            placeholder={query}
            aria-label="Name for this saved search"
          />
          <button type="submit">save</button>
        </form>
      )}
    </div>
  );
}

export default function Search({
  query,
  view = 'list',
}: {
  query: string;
  view?: 'list' | 'timeline';
}) {
  const [input, setInput] = useState(query);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounce typing into the URL — the URL is the search state.
  useEffect(() => {
    if (input === query) return;
    const t = setTimeout(() => {
      window.location.replace(searchHash(input.trim(), view));
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [input, query, view]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Deep search is a per-search choice, not a saved preference: it is slower
  // and noisier, so it should be a thing you reach for on a query that failed.
  const [deep, setDeep] = useState(false);
  const health = useHealth();
  const deepBuilt = health.data?.deepSearch === true;
  const search = useSearch(query, undefined, deep && deepBuilt);
  const groups = search.data?.groups ?? [];

  // Flat list of hits for keyboard navigation.
  const flat = useMemo(
    () =>
      groups.flatMap((g) =>
        g.hits.map((h) => ({
          sessionId: g.session.id,
          idx: h.idx,
          key: `${g.session.id}:${h.uuid}`,
        })),
      ),
    [groups],
  );
  const [active, setActive] = useState(0);
  useEffect(() => setActive(0), [query, deep]);

  const openHit = (sessionId: string, idx: number) => {
    navigate(sessionHash(sessionId, { m: idx, q: query }));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (flat.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, flat.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && document.activeElement === inputRef.current) {
      const hit = flat[active];
      if (hit) {
        e.preventDefault();
        openHit(hit.sessionId, hit.idx);
      }
    }
  };

  useEffect(() => {
    document.querySelector(`[data-hit="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  let flatPos = 0;

  return (
    <div className="search-screen" onKeyDown={onKeyDown}>
      <div className="search-head">
        <SearchField
          size="lg"
          inputRef={inputRef}
          value={input}
          onChange={setInput}
          placeholder="Search every turn of every session…"
          ariaLabel="Search"
        />
        <SavedSearches query={query} />
        <div className="search-meta">
          {query === '' ? (
            <span>
              Matches identifiers too: try <code>useWebSocket</code> or a trailing <code>*</code>{' '}
              for prefixes.
            </span>
          ) : search.isLoading ? (
            <span>searching…</span>
          ) : (
            <span>
              {fmtCount(search.data?.totalHits ?? 0)} hit
              {(search.data?.totalHits ?? 0) === 1 ? '' : 's'} in {groups.length} session
              {groups.length === 1 ? '' : 's'}
              {search.data?.aggregates && search.data.aggregates.matchedSessions > 0 && (
                <>
                  {' · '}this work cost{' '}
                  <strong>{fmtCost(search.data.aggregates.totalCostUsd)}</strong> est.
                  {' across '}
                  {fmtCount(search.data.aggregates.totalTurns)} turns
                </>
              )}
              {' · '}
              <kbd>↑</kbd>
              <kbd>↓</kbd> navigate · <kbd>enter</kbd> open
            </span>
          )}
        </div>
        {/* Refine by what the results actually contain, rather than knowing
            the grammar. Appends the operator; the cheat line below still
            teaches the full language. */}
        {search.data?.facets && query !== '' && (
          <div className="search-facets">
            {[
              ...search.data.facets.agents,
              ...search.data.facets.tools,
              ...search.data.facets.kinds,
              ...search.data.facets.projects,
            ].map((f) => (
              <button
                key={f.operator}
                className="facet-chip"
                onClick={() => {
                  const next = `${query} ${f.operator}`.trim();
                  setInput(next);
                  navigate(searchHash(next, view));
                }}
              >
                {f.label ?? f.value}
                <em>{fmtCount(f.count)}</em>
              </button>
            ))}
          </div>
        )}
        <div className="search-ops">
          narrow with <code>tool:Bash</code> <code>kind:prompt</code> <code>is:error</code>{' '}
          <code>is:pinned</code> <code>has:note</code> <code>has:bookmark</code>{' '}
          <code>project:name</code> <code>model:opus</code> <code>path:api.ts</code>{' '}
          <code>before:2026-07</code> <code>after:7d</code> <code>after:yesterday</code>
          {query !== '' && deepBuilt && (
            <Segmented
              fill="card"
              className="search-deep"
              ariaLabel="Match mode"
              value={deep ? 'deep' : 'words'}
              onChange={(v) => setDeep(v === 'deep')}
              options={[
                { value: 'words', label: 'words' },
                { value: 'deep', label: 'inside words' },
              ]}
            />
          )}
          {query !== '' && (
            <Segmented
              fill="card"
              className="search-view"
              ariaLabel="Result view"
              value={view}
              onChange={(v) => navigate(searchHash(query, v))}
              options={[
                { value: 'list', label: 'hits' },
                { value: 'timeline', label: 'timeline' },
              ]}
            />
          )}
        </div>
      </div>

      {view === 'timeline' ? (
        <TimelineView query={query} />
      ) : (
        <div className="search-results">
          {search.isLoading && groups.length === 0 && query !== '' && (
            <SkeletonRows n={6} tile={28} />
          )}
          {groups.map((g) => (
            <section key={g.session.id} className="search-group">
              <header className="search-group-head">
                <button
                  className="search-group-title"
                  onClick={() => navigate(sessionHash(g.session.id))}
                >
                  {sessionName(g.session)}
                </button>
                <span className="search-group-meta">
                  {fmtDate(g.session.startedAt)} · {fmtCount(g.session.eventCount)} events ·{' '}
                  {fmtCost(g.session.costUsd)}
                </span>
                <span className="search-group-count">
                  {g.hits.length} hit{g.hits.length === 1 ? '' : 's'}
                </span>
              </header>
              {g.hits.map((h) => {
                const pos = flatPos++;
                return (
                  <button
                    key={h.uuid}
                    data-hit={pos}
                    className={`search-hit ${pos === active ? 'active' : ''}`}
                    onClick={() => openHit(g.session.id, h.idx)}
                    onMouseEnter={() => setActive(pos)}
                  >
                    <Badge>{kindLabel(h, g.session.tool)}</Badge>
                    <Snippet text={h.snippet} />
                    <span className="search-hit-ts">{fmtTime(h.ts)}</span>
                  </button>
                );
              })}
            </section>
          ))}
          {query !== '' && !search.isLoading && groups.length === 0 && (
            <div className="fullscreen-note">
              <div>
                <h1>No matches</h1>
                <p>
                  Words are matched whole (with <code>_</code> <code>$</code> <code>.</code>{' '}
                  counting as word characters). Add <code>*</code> for prefix search.
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
