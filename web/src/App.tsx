import { useEffect, useState } from 'react';
import { hasToken, shutdownServer, useLiveEvents, useStatus } from './api';
import {
  Brandmark,
  FolderIcon,
  MagniferIcon,
  MoonIcon,
  PowerIcon,
  SidebarIcon,
  SunIcon,
  WalletIcon,
} from './icons';
import { navigate, useRoute } from './router';
import Home from './screens/Home';
import Replay from './screens/Replay';
import FileHistory from './screens/FileHistory';
import Search from './screens/Search';
import Spend from './screens/Spend';
import WhatsNew from './screens/WhatsNew';
import Sidebar from './Sidebar';
import Tooltip from './components/Tooltip';
import { setTheme, useTheme } from './theme';

/** Header search entry: a circle button into the search screen (its input
 *  autofocuses). The global `/` shortcut lands there too. */
function SearchButton() {
  const route = useRoute();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
      e.preventDefault();
      navigate('#/search');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <Tooltip content="Search all sessions (/)">
      <a
        href="#/search"
        className={`circle ${route.name === 'search' ? 'active' : ''}`}
        aria-label="Search all sessions"
        aria-current={route.name === 'search' ? 'page' : undefined}
      >
        <MagniferIcon size={16} />
      </a>
    </Tooltip>
  );
}

function StatusCircle() {
  const { data } = useStatus();
  const route = useRoute();
  const indexing = data?.state === 'indexing';
  const label = data
    ? (data.lastError ??
      (indexing
        ? `Indexing ${data.filesDone}/${data.filesTotal}`
        : `Index up to date · v${data.appVersion}`))
    : 'Connecting…';
  return (
    <Tooltip content={`${label} · what’s new`}>
      <a
        href="#/whats-new"
        className={`circle ${route.name === 'whatsnew' ? 'active' : ''}`}
        aria-label="Index status — open what's new"
        aria-current={route.name === 'whatsnew' ? 'page' : undefined}
      >
        <span
          className={`status-dot ${indexing ? 'busy' : 'idle'} ${data?.lastError ? 'err' : ''}`}
        />
      </a>
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

/**
 * Stops the whole app: asks the CLI process to exit, then the farewell screen
 * tries to close the tab. Two clicks (arm, then confirm) so a stray click
 * can't kill the server; the armed state disarms itself after a few seconds.
 */
function StopButton({ onStopped }: { onStopped: () => void }) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  const stop = async () => {
    try {
      await shutdownServer();
    } catch {
      /* the process can die before the response makes it out — still stopped */
    }
    onStopped();
  };

  return (
    <Tooltip content={armed ? 'Click again to stop' : 'Stop Turnlog'}>
      <button
        className={`circle stop-btn ${armed ? 'armed' : ''}`}
        onClick={() => (armed ? void stop() : setArmed(true))}
        aria-label={armed ? 'Confirm: stop Turnlog' : 'Stop Turnlog'}
      >
        <PowerIcon size={16} />
      </button>
    </Tooltip>
  );
}

/** Post-shutdown farewell. window.close() only works when the tab has no
 *  history beyond the CLI-opened URL — otherwise this screen stays up. */
function Stopped() {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    window.close();
  }, []);

  const cmd = 'npx turnlog';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard denied — ignore */
    }
  };

  return (
    <div className="stopped-screen">
      <div className="stopped-card">
        <span className="stopped-glyph" aria-hidden>
          <PowerIcon size={22} />
        </span>
        <h1>Turnlog stopped</h1>
        <p>
          The local server has shut down — nothing is running on your machine.
          It&rsquo;s safe to close this tab, or start again with:
        </p>
        <button className="stopped-cmd" onClick={copy} title="Copy command">
          <code>{cmd}</code>
          <span>{copied ? 'copied' : 'copy'}</span>
        </button>
      </div>
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
  const [stopped, setStopped] = useState(false);
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
  if (stopped) return <Stopped />;

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
            <a
              className={`header-pill ${route.name === 'files' ? 'active' : ''}`}
              href="#/files"
            >
              <FolderIcon size={16} />
              Files
            </a>
            <a
              className={`header-pill ${route.name === 'spend' ? 'active' : ''}`}
              href="#/spend"
            >
              <WalletIcon size={16} />
              Spend
            </a>
            <SearchButton />
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
            <StopButton onStopped={() => setStopped(true)} />
          </div>
        </header>
        <UpdateBanner />
        <main className="screen">
          {route.name === 'library' && <Home />}
          {route.name === 'search' && <Search query={route.query} />}
          {route.name === 'spend' && <Spend view={route.view} />}
          {route.name === 'whatsnew' && <WhatsNew />}
          {route.name === 'files' && <FileHistory query={route.query} path={route.path} />}
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
