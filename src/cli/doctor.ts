import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { dataDir, loadSettings, packageRoot } from '../config.js';
import { indexBytes } from '../indexer/db.js';
import { sessionFileOnDisk } from '../server/api.js';
import { findUpdateLeftovers } from './updateCleanup.js';
import {
  ADAPTER_VERSION,
  APP_VERSION,
  CODEX_ADAPTER_VERSION,
  CURSOR_ADAPTER_VERSION,
  CURSOR_IDE_ADAPTER_VERSION,
} from '../version.js';

/**
 * `turnlog doctor` — the beta bug report, generated.
 *
 * One command printing everything a support thread needs, so reports arrive
 * actionable instead of as screenshots: versions, resolved paths, a settings
 * echo (settings.json holds no secrets by design), index facts per agent,
 * SQLite's own integrity verdict, and index-vs-disk drift.
 *
 * Strictly read-only, unlike every other command: the index is opened
 * `readonly`, so doctor never creates a database, never migrates a schema,
 * and can be pointed at a broken index without making it worse. That is also
 * why it reads `user_version` directly instead of going through openDb.
 */

/** Count .jsonl files under a root, recursively. Missing root = 0. */
function countJsonl(root: string | undefined): number | null {
  if (!root || !fs.existsSync(root)) return null;
  let n = 0;
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable subdir — the count is a diagnostic, not an audit
    }
    for (const e of entries) {
      if (e.isDirectory()) walk(path.join(dir, e.name));
      else if (e.name.endsWith('.jsonl')) n++;
    }
  };
  walk(root);
  return n;
}

function fmtBytes(n: number): string {
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(1)} GB`;
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  return `${Math.ceil(n / 1024)} KB`;
}

export interface DoctorReport {
  text: string;
  /** False when SQLite's integrity check failed — the CLI exits 1 on it. */
  healthy: boolean;
}

export function runDoctor(dirs: {
  projectsDir: string;
  codexDir?: string;
  cursorCliDir?: string;
  cursorIdeUserDir?: string;
}): DoctorReport {
  const { projectsDir, codexDir, cursorCliDir, cursorIdeUserDir } = dirs;
  const lines: string[] = [];
  const out = (label: string, value: string) => lines.push(`${label.padEnd(18)} ${value}`);
  let healthy = true;

  lines.push(`turnlog doctor — ${new Date().toISOString()}`);
  lines.push('');
  out('turnlog', APP_VERSION);
  out('node', `${process.version} (${process.platform} ${process.arch})`);
  out(
    'adapters',
    `claude v${ADAPTER_VERSION} · codex v${CODEX_ADAPTER_VERSION} · ` +
      `cursor v${CURSOR_ADAPTER_VERSION} · cursor-ide v${CURSOR_IDE_ADAPTER_VERSION}`,
  );
  lines.push('');

  const dir = dataDir();
  const indexPath = path.join(dir, 'index.sqlite');
  const settingsPath = path.join(dir, 'settings.json');
  out('data dir', dir);
  // Named for the agent, not for what the directory happens to be called:
  // "projects dir" was Claude Code's, and read like Turnlog's own projects.
  out('claude code dir', `${projectsDir}${fs.existsSync(projectsDir) ? '' : '  (missing)'}`);
  out('codex dir', codexDir ? codexDir : '(none — ~/.codex/sessions not present)');
  out('cursor cli dir', cursorCliDir ? cursorCliDir : '(none — ~/.cursor/projects not present)');
  out('cursor ide dir', cursorIdeUserDir ? cursorIdeUserDir : '(none — no state.vscdb found)');
  out('settings', fs.existsSync(settingsPath) ? settingsPath : '(none — defaults)');
  // Doctor reports, never deletes (strictly read-only) — the sweep itself
  // runs on `turnlog` start.
  const leftovers = findUpdateLeftovers(packageRoot());
  if (leftovers.length > 0) {
    out(
      'update leftovers',
      `${leftovers.map((p) => path.basename(p)).join(', ')} — start turnlog once to clean up`,
    );
  }
  // settings.json holds no secrets by design (pricing rates, booleans, an
  // editor command template) — echo it verbatim so a report shows the real
  // config instead of the user's paraphrase of it.
  const settings = loadSettings();
  if (Object.keys(settings).length > 0) out('settings echo', JSON.stringify(settings));
  lines.push('');

  if (!fs.existsSync(indexPath)) {
    out('index', '(none yet — run turnlog or turnlog index first)');
    return { text: lines.join('\n'), healthy };
  }

  const db = new Database(indexPath, { readonly: true });
  try {
    // indexBytes, not the main file alone: a stale WAL can double the
    // footprint, and hiding it is exactly what a support report must not do.
    out('index', `${indexPath} (${fmtBytes(indexBytes(db))})`);
    const sqlite = db.prepare('SELECT sqlite_version() v').get() as { v: string };
    out('sqlite', sqlite.v);
    out('schema', `v${db.pragma('user_version', { simple: true })}`);

    // Facts split per agent: with more than one indexed, a lump sum hides
    // which adapter a problem lives in.
    const perAgent = db
      .prepare(
        `SELECT tool, COUNT(*) n, COALESCE(SUM(event_count), 0) ev
           FROM sessions WHERE parent_session_id IS NULL GROUP BY tool ORDER BY n DESC`,
      )
      .all() as { tool: string; n: number; ev: number }[];
    for (const a of perAgent) out(`sessions·${a.tool}`, `${a.n} (${a.ev} events)`);

    const unknown = db
      .prepare(`SELECT COUNT(*) n FROM messages WHERE kind = 'unknown'`)
      .get() as { n: number };
    const total = db.prepare(`SELECT COUNT(*) n FROM messages`).get() as { n: number };
    out(
      'unknown records',
      total.n > 0 ? `${unknown.n} of ${total.n} (${((unknown.n / total.n) * 100).toFixed(2)}%)` : '0',
    );

    const deep = db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='messages_trigram'`)
      .get();
    out('deep search', deep ? 'built' : 'off');

    // Index-vs-disk drift, both directions: files the watcher has not caught
    // up on, and rows whose files are gone (prune forgets those).
    const filePaths = db.prepare(`SELECT file_path FROM sessions`).all() as {
      file_path: string;
    }[];
    // Virtual sessions (Cursor IDE composers) exist as long as their vscdb
    // does — sessionFileOnDisk strips the '#composerId' fragment.
    const missing = filePaths.filter((f) => !fs.existsSync(sessionFileOnDisk(f.file_path))).length;
    // Composers aren't files on disk; drift compares .jsonl sources only.
    const jsonlIndexed = filePaths.filter((f) => !f.file_path.includes('#')).length;
    const onDisk =
      (countJsonl(projectsDir) ?? 0) + (countJsonl(codexDir) ?? 0) + (countJsonl(cursorCliDir) ?? 0);
    out('indexed files', String(filePaths.length));
    out('on disk now', `${onDisk}${onDisk > jsonlIndexed ? '  (drift — turnlog index catches up)' : ''}`);
    out('files gone', `${missing}${missing > 0 ? '  (prune forgets them)' : ''}`);

    // SQLite's own verdict, last — a corrupt index is the headline.
    const integrity = (db.pragma('integrity_check', { simple: true }) as string) ?? 'unknown';
    healthy = integrity === 'ok';
    out('integrity', integrity);
  } finally {
    db.close();
  }

  return { text: lines.join('\n'), healthy };
}
