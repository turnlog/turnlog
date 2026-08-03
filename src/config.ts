import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type { ModelPricing } from './cost/pricing.js';

export function dataDir(): string {
  if (process.env.TURNLOG_DATA_DIR) return process.env.TURNLOG_DATA_DIR;
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'turnlog');
  }
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.trim() !== '' ? xdg : path.join(os.homedir(), '.config');
  return path.join(base, 'turnlog');
}

export function ensureDataDir(): string {
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function dbPath(): string {
  return path.join(ensureDataDir(), 'index.sqlite');
}

/**
 * Where `turnlog demo` keeps its index — a scratch dir, never the real one.
 * The demo must be incapable of touching a user's own history, so it does not
 * merely point at a different file inside the data dir; it is a separate tree
 * that can be deleted wholesale.
 */
export function demoDataDir(): string {
  return path.join(os.tmpdir(), 'turnlog-demo');
}

/**
 * The bundled sample sessions, shipped inside the package so a reviewer with
 * no agent history can see the real UI with real-looking data in one command.
 * Both agents, deliberately: the differentiator is one timeline per repo
 * whichever agent you pointed at it, and a single-agent demo hides it.
 */
export function demoCorpusDir(): { projectsDir: string; codexDir: string } {
  // dist/config.js at runtime, src/config.ts under tsx — both sit one level
  // below the package root.
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  return {
    projectsDir: path.join(root, 'fixtures', 'corpus'),
    codexDir: path.join(root, 'fixtures', 'codex'),
  };
}

export function defaultProjectsDir(): string {
  return process.env.TURNLOG_PROJECTS_DIR ?? path.join(os.homedir(), '.claude', 'projects');
}

/**
 * Codex rollout root. Indexed read-only when it exists — same posture as
 * `~/.claude/projects`; Turnlog never writes into another tool's data dir.
 */
export function defaultCodexDir(): string {
  return process.env.TURNLOG_CODEX_DIR ?? path.join(os.homedir(), '.codex', 'sessions');
}

/**
 * Where the running server records its tokened URL so `turnlog search` can
 * print working deep links. Written 0600 and removed on shutdown — it sits
 * next to the index DB, which already holds every session's content, so it
 * adds no new exposure inside the same trust boundary.
 */
export function serverInfoPath(): string {
  return path.join(ensureDataDir(), 'server.json');
}

export interface Settings {
  /** Per-model pricing overrides (USD per MTok), for Bedrock/enterprise rates. */
  modelPricing?: Record<string, Partial<ModelPricing>>;
  /** Append the "Exported with Turnlog" footer to markdown exports (default true). */
  exportFooter?: boolean;
  /** Check the npm registry for a newer version on startup (default true). */
  checkUpdates?: boolean;
  /**
   * Command template for the web UI's open-in-editor buttons, e.g.
   * "code -g {path}" or "webstorm {path}". `{path}` is replaced with the
   * file's absolute path (appended when the template has no placeholder).
   * Unset = the buttons don't render. Never a shell — split on whitespace
   * and spawned directly.
   */
  editorCommand?: string;
}

export function loadSettings(): Settings {
  try {
    const raw = fs.readFileSync(path.join(dataDir(), 'settings.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Settings) : {};
  } catch {
    return {};
  }
}
