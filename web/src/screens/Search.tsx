import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearch } from '../api';
import { SkeletonRows } from '../components/Skeleton';
import { fmtCost, fmtCount, fmtDate, fmtTime, projectName, sessionName } from '../format';
import { navigate, searchHash, sessionHash } from '../router';
import { SNIPPET_CLOSE, SNIPPET_OPEN, type SearchHit } from '../types';

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
      {parts.map((p, i) => (p.mark ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
    </span>
  );
}

function kindLabel(hit: SearchHit): string {
  if (hit.kind === 'tool_use' || hit.kind === 'tool_result') {
    return hit.toolName ?? hit.kind.replace('_', ' ');
  }
  if (hit.kind === 'prompt') return 'you';
  if (hit.kind === 'assistant') return 'claude';
  return hit.kind;
}

const DEBOUNCE_MS = 200;

export default function Search({ query }: { query: string }) {
  const [input, setInput] = useState(query);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounce typing into the URL — the URL is the search state.
  useEffect(() => {
    if (input === query) return;
    const t = setTimeout(() => {
      window.location.replace(searchHash(input.trim()));
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [input, query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const search = useSearch(query);
  const groups = search.data?.groups ?? [];

  // Flat list of hits for keyboard navigation.
  const flat = useMemo(
    () =>
      groups.flatMap((g) =>
        g.hits.map((h) => ({ sessionId: g.session.id, idx: h.idx, key: `${g.session.id}:${h.uuid}` })),
      ),
    [groups],
  );
  const [active, setActive] = useState(0);
  useEffect(() => setActive(0), [query]);

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
    document
      .querySelector(`[data-hit="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  let flatPos = 0;

  return (
    <div className="search-screen" onKeyDown={onKeyDown}>
      <div className="search-head">
        <input
          ref={inputRef}
          className="search-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Search every turn of every session…"
          aria-label="Search"
        />
        <div className="search-meta">
          {query === '' ? (
            <span>
              Matches identifiers too: try <code>useWebSocket</code> or a trailing{' '}
              <code>*</code> for prefixes.
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
                  {' · '}this work cost <strong>{fmtCost(search.data.aggregates.totalCostUsd)}</strong> est.
                  {' across '}
                  {fmtCount(search.data.aggregates.totalTurns)} turns
                </>
              )}
              {' · '}
              <kbd>↑↓</kbd> navigate · <kbd>Enter</kbd> open
            </span>
          )}
        </div>
      </div>

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
                {fmtDate(g.session.startedAt)} · {fmtCount(g.session.turnCount)} turns ·{' '}
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
                  <span className="chip chip-kind">{kindLabel(h)}</span>
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
    </div>
  );
}
