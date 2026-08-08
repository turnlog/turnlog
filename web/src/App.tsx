import { useEffect, useState } from 'react';
import { hasToken, shutdownServer, useLiveEvents, useStatus } from './api';
import {
  Brandmark,
  CloseIcon,
  FolderIcon,
  MagniferIcon,
  MoonIcon,
  PowerIcon,
  SidebarIcon,
  SunIcon,
  WalletIcon,
} from './icons';
import { navigate, useRoute } from './router';
import { SHORTCUTS, isTyping } from './keys';
import { APP_EVENT, emitAppEvent, onAppEvent } from './events';
import { getPref, setPref, usePref } from './prefs';
import DesignSystem from './screens/DesignSystem';
import Home from './screens/Home';
import Replay from './screens/Replay';
import FileHistory from './screens/FileHistory';
import Project from './screens/Project';
import Search from './screens/Search';
import Spend from './screens/Spend';
import WhatsNew from './screens/WhatsNew';
import Sidebar from './Sidebar';
import IconButton from './components/IconButton';
import Primary from './components/Primary';
import Palette from './components/Palette';
import Shortcuts from './components/Shortcuts';
import Tooltip from './components/Tooltip';
import { setTheme, useTheme } from './theme';

/** Header search entry: a circle button into the search screen (its input
 *  autofocuses). The global `/` shortcut lands there too. */
function SearchButton() {
  const route = useRoute();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target)) return;
      e.preventDefault();
      navigate('#/search');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <Primary
      href="#/search"
      label="Search all sessions"
      tooltip="Search all sessions"
      shortcut={SHORTCUTS.search}
      active={route.name === 'search'}
      icon={<MagniferIcon />}
    />
  );
}

function StatusCircle() {
  const { data } = useStatus();
  const route = useRoute();
  const indexing = data?.state === 'indexing';
  // First run on a new version: ring the dot until What's New has been seen.
  const lastSeen = usePref('lastSeenVersion');
  const hasNews = !!data && lastSeen !== data.appVersion;
  const label = data
    ? (data.lastError ??
      (indexing
        ? `Indexing ${data.filesDone}/${data.filesTotal}`
        : `Index up to date · v${data.appVersion}`))
    : 'Connecting…';
  return (
    <Primary
      href="#/whats-new"
      label="Index status — open what's new"
      tooltip={`${label} · ${hasNews ? 'see what’s new' : 'what’s new'}`}
      active={route.name === 'whatsnew'}
      className={hasNews ? 'news' : ''}
      icon={
        <span
          className={`status-dot ${indexing ? 'busy' : 'idle'} ${data?.lastError ? 'err' : ''}`}
        />
      }
    />
  );
}

/**
 * `turnlog demo`: says so, permanently and without a dismiss.
 *
 * A screenshot of the demo is otherwise indistinguishable from a screenshot
 * of someone's real history — which is fine for a landing GIF and misleading
 * everywhere else, so this one cannot be turned off.
 */
function DemoBanner() {
  const { data } = useStatus();
  if (data?.demo !== true) return null;
  return (
    <div className="demo-banner" role="status">
      <span className="demo-banner-dot" aria-hidden />
      Demo data — bundled sample sessions. Your own history is not being read.
    </div>
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
  const [dismissed, setDismissed] = useState(() => getPref('updateDismissed'));
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
    setPref('updateDismissed', latest);
    setDismissed(latest);
  };

  return (
    <div className="update-banner" role="status">
      <span className="update-banner-dot" aria-hidden />
      <span className="update-banner-text">
        Turnlog <strong>{latest}</strong> is available — you&rsquo;re on {data?.appVersion}.
      </span>
      <button className="update-banner-cmd" onClick={copy}>
        <code>{cmd}</code>
        <span className="update-banner-copy">{copied ? 'copied' : 'copy'}</span>
      </button>
      <IconButton
        fill="ghost"
        label="Dismiss update notice"
        className="update-banner-x"
        onClick={dismiss}
      >
        <CloseIcon size={13} />
      </IconButton>
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

  // ⇧Q (global keys below) walks the same arm-then-confirm two-step as the
  // mouse — a shortcut must not be a faster way to kill the server by accident.
  useEffect(() => {
    const onStopKey = () => {
      if (armed) void stop();
      else setArmed(true);
    };
    return onAppEvent(APP_EVENT.stopKey, onStopKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armed]);

  return (
    <Primary
      label={armed ? 'Confirm: stop Turnlog' : 'Stop Turnlog'}
      tooltip={armed ? 'Press again to stop' : 'Stop Turnlog'}
      shortcut={SHORTCUTS.stop}
      fill={armed ? 'danger' : 'card'}
      onClick={() => (armed ? void stop() : setArmed(true))}
      icon={<PowerIcon />}
    />
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
        <button className="stopped-cmd" onClick={copy}>
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
  const [sidebarOpen, setSidebarOpen] = useState(() => getPref('sidebar') !== false);
  const toggleSidebar = () => {
    setSidebarOpen((v) => {
      setPref('sidebar', !v);
      return !v;
    });
  };

  useEffect(() => {
    const offOpen = onAppEvent(APP_EVENT.openSidebar, () => setSidebarOpen(true));
    const offToggle = onAppEvent(APP_EVENT.toggleSidebar, () => toggleSidebar());
    return () => {
      offOpen();
      offToggle();
    };
    // toggleSidebar uses a functional setState — any render's instance works.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Chrome shortcuts: B sidebar, T theme, ⇧Q stop (two-step). Guarded like
  // `/` — never while typing, never with a held modifier.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (e.key === 'b') {
        e.preventDefault();
        toggleSidebar();
      } else if (e.key === 't') {
        e.preventDefault();
        setTheme(theme === 'dark' ? 'light' : 'dark');
      } else if (e.key === 'Q' && e.shiftKey) {
        e.preventDefault();
        emitAppEvent(APP_EVENT.stopKey);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // toggleSidebar uses a functional setState — any render's instance works.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  if (!hasToken()) return <NoToken />;
  if (stopped) return <Stopped />;

  return (
    <div className="app">
      <Palette />
      <Shortcuts />
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
              <Primary
                label="Show sessions"
                tooltip="Show sessions"
                shortcut={SHORTCUTS.sidebar}
                onClick={toggleSidebar}
                icon={<SidebarIcon />}
              />
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
            <Primary href="#/files" active={route.name === 'files'} icon={<FolderIcon />}>
              Files
            </Primary>
            <Primary href="#/spend" active={route.name === 'spend'} icon={<WalletIcon />}>
              Spend
            </Primary>
            <SearchButton />
            <Primary
              label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              tooltip={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              shortcut={SHORTCUTS.theme}
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              icon={theme === 'dark' ? <SunIcon /> : <MoonIcon />}
            />
            <StatusCircle />
            <StopButton onStopped={() => setStopped(true)} />
          </div>
        </header>
        <DemoBanner />
        <UpdateBanner />
        <main className="screen">
          {route.name === 'library' && <Home />}
          {route.name === 'search' && <Search query={route.query} view={route.view} />}
          {route.name === 'spend' && <Spend view={route.view} />}
          {route.name === 'whatsnew' && <WhatsNew />}
          {/* Internal reference — deliberately unlinked; reach it by typing
              #/design-system. */}
          {route.name === 'design' && <DesignSystem />}
          {route.name === 'files' && (
            <FileHistory query={route.query} path={route.path} find={route.find} />
          )}
          {route.name === 'project' && (
            <Project key={route.projectKey} projectKey={route.projectKey} />
          )}
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
