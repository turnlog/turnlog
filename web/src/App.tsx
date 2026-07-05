import { useEffect, useRef, useState } from 'react';
import { hasToken, useStatus } from './api';
import { MagniferIcon, MoonIcon, SidebarIcon, SunIcon } from './icons';
import { navigate, searchHash, useRoute } from './router';
import Home from './screens/Home';
import Replay from './screens/Replay';
import Search from './screens/Search';
import Sidebar from './Sidebar';
import { setTheme, useTheme } from './theme';

function Wordmark() {
  return (
    <a href="#/" className="wordmark" aria-label="Turnlog — library">
      <svg width="18" height="18" viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="6" fill="var(--bg3)" />
        <path
          d="M8 10h16M8 16h11M8 22h14"
          stroke="var(--amber)"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
      <span>turnlog</span>
    </a>
  );
}

function StatusChip() {
  const { data } = useStatus();
  if (!data) return null;
  const indexing = data.state === 'indexing';
  return (
    <div className="status-chip" title={data.lastError ?? undefined}>
      <span className={`status-dot ${indexing ? 'busy' : 'idle'}`} />
      {indexing ? (
        <span>
          indexing {data.filesDone}/{data.filesTotal}
        </span>
      ) : (
        <span>index up to date</span>
      )}
      {data.lastError && <span className="status-err">!</span>}
      <span className="status-version">v{data.appVersion}</span>
    </div>
  );
}

function TopSearch() {
  const route = useRoute();
  const [value, setValue] = useState(route.name === 'search' ? route.query : '');
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the box in sync when navigation changes the query elsewhere.
  useEffect(() => {
    if (route.name === 'search') setValue(route.query);
  }, [route.name === 'search' ? route.query : null]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
      e.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <form
      className="top-search"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) navigate(searchHash(value.trim()));
      }}
    >
      <MagniferIcon className="top-search-icon" size={14} />
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
        }}
        placeholder="Search every session…"
        aria-label="Search all sessions"
      />
      <kbd>/</kbd>
    </form>
  );
}

function ThemeToggle() {
  const theme = useTheme();
  const dark = theme === 'dark';
  return (
    <button
      className="icon-btn"
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      aria-label={`Switch to ${dark ? 'light' : 'dark'} theme`}
      title={`Switch to ${dark ? 'light' : 'dark'} theme`}
    >
      {dark ? <SunIcon size={16} /> : <MoonIcon size={16} />}
    </button>
  );
}

function SidebarToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      className={`icon-btn ${open ? 'active' : ''}`}
      onClick={onToggle}
      aria-label={`${open ? 'Hide' : 'Show'} session sidebar`}
      title={`${open ? 'Hide' : 'Show'} sessions`}
    >
      <SidebarIcon size={16} />
    </button>
  );
}

/** Opened without the per-launch token: API calls will all 401. Explain. */
function NoToken() {
  return (
    <div className="fullscreen-note">
      <div>
        <h1>Session token missing</h1>
        <p>
          Turnlog requires the tokened URL printed by the CLI — it keeps other local
          processes and web pages away from your session index.
        </p>
        <p>
          Switch to the terminal running <code>turnlog</code> and open the URL it
          printed (<code>http://127.0.0.1:…/?token=…</code>), or restart it.
        </p>
      </div>
    </div>
  );
}

export default function App() {
  const route = useRoute();
  const [sidebarOpen, setSidebarOpen] = useState(
    () => localStorage.getItem('turnlog-sidebar') !== '0',
  );
  const toggleSidebar = () => {
    setSidebarOpen((v) => {
      localStorage.setItem('turnlog-sidebar', v ? '0' : '1');
      return !v;
    });
  };

  if (!hasToken()) return <NoToken />;

  return (
    <div className="app">
      <header className="topbar">
        <SidebarToggle open={sidebarOpen} onToggle={toggleSidebar} />
        <Wordmark />
        <TopSearch />
        <div className="topbar-right">
          <ThemeToggle />
          <StatusChip />
        </div>
      </header>
      <div className="app-body">
        {sidebarOpen && (
          <Sidebar activeId={route.name === 'session' ? route.id : null} />
        )}
        <main className="screen">
          {route.name === 'library' && <Home />}
          {route.name === 'search' && <Search query={route.query} />}
          {route.name === 'session' && (
            <Replay
              key={route.id}
              sessionId={route.id}
              jumpIdx={route.jumpIdx}
              searchQuery={route.query}
            />
          )}
        </main>
      </div>
    </div>
  );
}
