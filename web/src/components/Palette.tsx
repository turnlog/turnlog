import { useEffect, useMemo, useRef, useState } from 'react';
import { usePaletteSessions, useProjects, useSavedSearches } from '../api';
import { fuzzyScore } from '../fuzzy';
import { fmtDate, projectName, sessionName, tileClass } from '../format';
import {
  CalendarIcon,
  ChartIcon,
  ChatIcon,
  FolderIcon,
  HistoryIcon,
  MagniferIcon,
  MoonIcon,
  SidebarIcon,
  WalletIcon,
} from '../icons';
import { navigate, projectHash, searchHash, sessionHash } from '../router';
import { SHORTCUTS } from '../keys';
import { APP_EVENT, emitAppEvent, onAppEvent } from '../events';
import { getTheme, setTheme } from '../theme';
import Overlay from './Overlay';
import type { ProjectInfo, SessionMeta } from '../types';

/**
 * The command palette (⌘K / Ctrl-K): a fuzzy session switcher plus screens,
 * chrome actions (with their shortcuts on display), and saved searches.
 * Sessions are the headline — CC's own titles (adapter v4) made them
 * nameable, so names are how you move. `/` stays focus-search.
 */

type ScreenIcon = typeof HistoryIcon;

interface Item {
  key: string;
  kind: 'session' | 'screen' | 'saved' | 'search' | 'action' | 'project';
  label: string;
  /** Secondary line: project · date for sessions, a kind tag otherwise. */
  sub: string;
  hash: string;
  session?: SessionMeta;
  Icon?: ScreenIcon;
  /** Text glyph when no Icon fits (the "?" of the shortcuts sheet). */
  glyphText?: string;
  /** Runs instead of navigating (overlays like the shortcuts sheet). */
  action?: () => void;
  /** The item's own keyboard shortcut, shown as keycaps on the row. */
  keys?: string[];
}

const SCREENS: { label: string; hash: string; Icon: ScreenIcon; keys?: string[] }[] = [
  { label: 'Overview', hash: '#/', Icon: HistoryIcon },
  { label: 'Search', hash: '#/search', Icon: MagniferIcon, keys: SHORTCUTS.search },
  { label: 'Files', hash: '#/files', Icon: FolderIcon },
  { label: 'Spend', hash: '#/spend', Icon: WalletIcon },
  { label: 'Calendar', hash: '#/spend?v=calendar', Icon: CalendarIcon },
  { label: 'Disk usage', hash: '#/spend?v=disk', Icon: ChartIcon },
  { label: 'What’s new', hash: '#/whats-new', Icon: ChatIcon },
];

const EMPTY_SESSIONS = 8;
const MAX_RESULTS = 14;

/** The keyboard cheat sheet rides the palette — an overlay, not a route. */
const SHORTCUTS_ITEM: Item = {
  key: 'shortcuts',
  kind: 'action',
  label: 'Keyboard shortcuts',
  sub: 'action',
  hash: '',
  glyphText: '?',
  keys: SHORTCUTS.sheet,
  action: () => emitAppEvent(APP_EVENT.shortcuts),
};

/** Chrome actions with their shortcuts on display — a palette is also how
 *  you discover the keys. */
const ACTION_ITEMS: Item[] = [
  {
    key: 'action:sidebar',
    kind: 'action',
    label: 'Toggle sidebar',
    sub: 'action',
    hash: '',
    Icon: SidebarIcon,
    keys: SHORTCUTS.sidebar,
    action: () => emitAppEvent(APP_EVENT.toggleSidebar),
  },
  {
    key: 'action:theme',
    kind: 'action',
    label: 'Switch theme',
    sub: 'action',
    hash: '',
    Icon: MoonIcon,
    keys: SHORTCUTS.theme,
    action: () => setTheme(getTheme() === 'dark' ? 'light' : 'dark'),
  },
  SHORTCUTS_ITEM,
];

function sessionItem(s: SessionMeta): Item {
  return {
    key: `session:${s.id}`,
    kind: 'session',
    label: sessionName(s),
    sub: `${projectName(s)} · ${fmtDate(s.endedAt ?? s.startedAt)}`,
    hash: sessionHash(s.id),
    session: s,
  };
}

/** A repo, by the name you call it — the palette is how you reach its page. */
function projectItem(p: ProjectInfo): Item {
  return {
    key: `project:${p.projectKey}`,
    kind: 'project',
    label: projectName({ projectKey: p.projectKey, projectPath: p.projectPath }),
    sub: `project · ${p.sessionCount} session${p.sessionCount === 1 ? '' : 's'}`,
    hash: projectHash(p.projectKey),
    Icon: FolderIcon,
  };
}

function screenItem(s: (typeof SCREENS)[number]): Item {
  return {
    key: `screen:${s.hash}`,
    kind: 'screen',
    label: s.label,
    sub: 'screen',
    hash: s.hash,
    Icon: s.Icon,
    keys: s.keys,
  };
}

function savedItem(s: { id: number; name: string; query: string }): Item {
  return {
    key: `saved:${s.id}`,
    kind: 'saved',
    label: s.name,
    sub: 'saved search',
    hash: searchHash(s.query),
    Icon: MagniferIcon,
  };
}

export default function Palette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const sessions = usePaletteSessions(open);
  const saved = useSavedSearches();
  const projects = useProjects();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    const offOpen = onAppEvent(APP_EVENT.palette, () => setOpen(true));
    return () => {
      window.removeEventListener('keydown', onKey);
      offOpen();
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      // The input mounts with the overlay — focus once it exists.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const pool = sessions.data ?? [];
    const q = query.trim();
    if (q === '') {
      return [
        ...pool.slice(0, EMPTY_SESSIONS).map(sessionItem),
        // Projects above screens: a repo is a destination you actually think
        // in, and the page has no other obvious way in.
        ...(projects.data ?? []).slice(0, 5).map(projectItem),
        ...SCREENS.map(screenItem),
        ...ACTION_ITEMS,
        ...(saved.data ?? []).slice(0, 5).map(savedItem),
      ];
    }
    const scored: { item: Item; score: number }[] = [];
    const consider = (item: Item, haystack: string) => {
      const score = fuzzyScore(q, haystack);
      if (score !== null) scored.push({ item, score });
    };
    for (const s of pool) consider(sessionItem(s), `${sessionName(s)} ${projectName(s)}`);
    for (const p of projects.data ?? []) {
      consider(projectItem(p), `${projectName({ projectKey: p.projectKey, projectPath: p.projectPath })} project ${p.projectKey}`);
    }
    for (const s of SCREENS) consider(screenItem(s), s.label);
    for (const a of ACTION_ITEMS) consider(a, a.label);
    for (const s of saved.data ?? []) consider(savedItem(s), `${s.name} ${s.query}`);
    scored.sort((a, b) => b.score - a.score);
    const out = scored.slice(0, MAX_RESULTS).map((s) => s.item);
    // Anything typed is also a search — always reachable as the last row.
    out.push({
      key: 'search',
      kind: 'search',
      label: `Search logs for “${q}”`,
      sub: 'full-text search',
      hash: searchHash(q),
      Icon: MagniferIcon,
    });
    return out;
  }, [sessions.data, saved.data, projects.data, query]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-pi="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  const go = (item: Item) => {
    setOpen(false);
    if (item.action) item.action();
    else navigate(item.hash);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = items[active];
      if (item) go(item);
    }
  };

  return (
    <Overlay onClose={() => setOpen(false)}>
      <div className="palette" role="dialog" aria-label="Command palette">
        <div className="palette-input-row">
          <MagniferIcon size={15} />
          <input
            ref={inputRef}
            className="palette-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Jump to a session, screen, action, or saved search…"
            aria-label="Command palette"
          />
          <kbd>esc</kbd>
        </div>
        <div className="palette-list" ref={listRef}>
          {items.map((item, i) => (
            <button
              key={item.key}
              data-pi={i}
              className={`palette-item ${i === active ? 'active' : ''}`}
              onClick={() => go(item)}
              onMouseEnter={() => setActive(i)}
            >
              {item.session ? (
                <span className={`tile tile-xs ${tileClass(item.session.projectKey)}`}>
                  {projectName(item.session).charAt(0).toUpperCase()}
                </span>
              ) : (
                <span className="palette-glyph">
                  {item.Icon ? <item.Icon size={14} /> : item.glyphText}
                </span>
              )}
              <span className="palette-label">{item.label}</span>
              <span className="palette-sub">{item.sub}</span>
              {item.keys && (
                <span className="palette-keys" aria-hidden>
                  {item.keys.map((k, j) => (
                    <kbd key={j}>{k}</kbd>
                  ))}
                </span>
              )}
            </button>
          ))}
          {items.length === 0 && <div className="palette-empty">Nothing matches</div>}
        </div>
        <div className="palette-foot" aria-hidden>
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>enter</kbd> open
          </span>
          <span>
            <kbd>esc</kbd> close
          </span>
        </div>
      </div>
    </Overlay>
  );
}
