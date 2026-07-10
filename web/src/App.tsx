import { useEffect, useRef, useState } from 'react';
import { hasToken, useLiveEvents, useStatus } from './api';
import { Brandmark, MagniferIcon, MoonIcon, SidebarIcon, SunIcon, WalletIcon } from './icons';
import { navigate, searchHash, useRoute } from './router';
import Home from './screens/Home';
import Replay from './screens/Replay';
import Search from './screens/Search';
import Spend from './screens/Spend';
import Sidebar from './Sidebar';
import Tooltip from './components/Tooltip';
import { setTheme, useTheme } from './theme';

function TopSearch() {
  const route = useRoute();
  const [value, setValue] = useState(route.name === 'search' ? route.query : '');
  const inputRef = useRef<HTMLInputElement>(null);

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
      <MagniferIcon size={15} className="top-search-ico" />
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
        }}
        placeholder="Start searching here…"
        aria-label="Search all sessions"
      />
    </form>
  );
}

function StatusCircle() {
  const { data } = useStatus();
  const indexing = data?.state === 'indexing';
  const label = data
    ? (data.lastError ??
      (indexing
        ? `Indexing ${data.filesDone}/${data.filesTotal}`
        : `Index up to date · v${data.appVersion}`))
    : 'Connecting…';
  return (
    <Tooltip content={label}>
      <div className="circle" aria-label="Index status">
        <span
          className={`status-dot ${indexing ? 'busy' : 'idle'} ${data?.lastError ? 'err' : ''}`}
        />
      </div>
    </Tooltip>
  );
}

/**
 * Surfaces the CLI's startup update check inside the browser: the Node process
 * is the only thing that ever talks to npm, so the version arrives on
 * /api/status (already polled) rather than a fetch from here. Dismissal is
 * keyed by version, so a newer release re-notifies.
 */
function UpdateBanner() {
  const { data } = useStatus();
  const latest = data?.updateAvailable ?? null;
  const [dismissed, setDismissed] = useState(() =>
    localStorage.getItem('turnlog-update-dismissed'),
  );
  const [copied, setCopied] = useState(false);

  if (!latest || dismissed === latest) return null;

  const cmd = 'npm i -g turnlog@latest';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard denied — ignore */
    }
  };
  const dismiss = () => {
    localStorage.setItem('turnlog-update-dismissed', latest);
    setDismissed(latest);
  };

  return (
    <div className="update-banner" role="status">
      <span className="update-banner-dot" aria-hidden />
      <span className="update-banner-text">
        Turnlog <strong>{latest}</strong> is available — you&rsquo;re on {data?.appVersion}.
      </span>
      <button className="update-banner-cmd" onClick={copy} title="Copy install command">
        <code>{cmd}</code>
        <span className="update-banner-copy">{copied ? 'copied' : 'copy'}</span>
      </button>
      <button
        className="update-banner-x"
        onClick={dismiss}
        aria-label="Dismiss update notice"
      >
        &times;
      </button>
    </div>
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
  const theme = useTheme();
  useLiveEvents(); // SSE: refresh index-derived queries the moment a session file reindexes
  const [sidebarOpen, setSidebarOpen] = useState(
    () => localStorage.getItem('turnlog-sidebar') !== '0',
  );
  const toggleSidebar = () => {
    setSidebarOpen((v) => {
      localStorage.setItem('turnlog-sidebar', v ? '0' : '1');
      return !v;
    });
  };

  useEffect(() => {
    const onOpenSidebar = () => setSidebarOpen(true);
    window.addEventListener('turnlog:open-sidebar', onOpenSidebar);
    return () => window.removeEventListener('turnlog:open-sidebar', onOpenSidebar);
  }, []);

  if (!hasToken()) return <NoToken />;

  return (
    <div className="app">
      {/* Always mounted so open/close can animate; the rail clips at width 0. */}
      <div className={`sidebar-rail ${sidebarOpen ? 'open' : ''}`} aria-hidden={!sidebarOpen}>
        <Sidebar
          activeId={route.name === 'session' ? route.id : null}
          onToggle={toggleSidebar}
        />
      </div>
      <div className="app-main">
        <header className="header">
          {/* While the sidebar is open, its own top row carries these. */}
          {!sidebarOpen && (
            <>
              <Tooltip content="Show sessions">
                <button className="circle" onClick={toggleSidebar} aria-label="Show sessions">
                  <SidebarIcon size={17} />
                </button>
              </Tooltip>
              <a href="#/" className="header-brand" aria-label="Turnlog — overview">
                <Brandmark />
                <span className="header-title">
                  Turnlog
                  <em>Search &amp; replay</em>
                </span>
              </a>
            </>
          )}
          <div className="header-right">
            <TopSearch />
            <a
              className={`header-pill ${route.name === 'spend' ? 'active' : ''}`}
              href="#/spend"
            >
              <WalletIcon size={16} />
              Spend
            </a>
            <Tooltip content={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
              <button
                className="circle"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              >
                {theme === 'dark' ? <SunIcon size={16} /> : <MoonIcon size={16} />}
              </button>
            </Tooltip>
            <StatusCircle />
          </div>
        </header>
        <UpdateBanner />
        <main className="screen">
          {route.name === 'library' && <Home />}
          {route.name === 'search' && <Search query={route.query} />}
          {route.name === 'spend' && <Spend view={route.view} />}
          {route.name === 'session' && (
            <Replay
              key={route.id}
              sessionId={route.id}
              jumpIdx={route.jumpIdx}
              searchQuery={route.query}
              lens={route.lens}
              view={route.view}
            />
          )}
        </main>
      </div>
    </div>
  );
}
