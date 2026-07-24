import { parseArgs } from 'node:util';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { dbPath, defaultProjectsDir, loadSettings, serverInfoPath } from '../config.js';
import { renderSearch } from './search.js';
import { getSessionExport, resolveSessionId } from '../server/api.js';
import { openDb } from '../indexer/db.js';
import { Indexer } from '../indexer/indexer.js';
import { WorkerDriver } from '../indexer/workerDriver.js';
import { watchProjects } from '../indexer/watcher.js';
import { SseHub, startServer } from '../server/server.js';
import { openBrowser } from './open.js';
import { checkForUpdate, updateCheckEnabled } from './updateCheck.js';
import { APP_VERSION } from '../version.js';

const HELP = `turnlog ${APP_VERSION} — search and replay your Claude Code sessions, locally.

Usage:
  turnlog                     Start the local server and open the UI
  turnlog index               Incrementally index ~/.claude/projects and exit
  turnlog index --rebuild     Drop the index and rebuild from scratch
  turnlog export <id>         Print a session as markdown (id or unique prefix)
  turnlog search <query>      Search from the terminal (same operators as the UI:
                              tool: kind: is:error project: model: before: after:)
  turnlog mcp                 Serve the index as a read-only MCP server (stdio)
                              Register: claude mcp add turnlog -- npx turnlog mcp

Options:
  --port <n>       Fixed port instead of a random one
  --projects <dir> Claude projects dir (default: ~/.claude/projects)
  --no-open        Don't open the browser
  --no-footer      Omit the attribution footer from export
  -V, --version    Print version
  -h, --help       Show this help

Everything runs on 127.0.0.1 only. No data ever leaves your machine.`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function main(): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({
      options: {
        port: { type: 'string' },
        projects: { type: 'string' },
        'no-open': { type: 'boolean' },
        'no-footer': { type: 'boolean' },
        rebuild: { type: 'boolean' },
        limit: { type: 'string' },
        json: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'V' },
      },
      allowPositionals: true,
    });
  } catch (err) {
    fail(`${err instanceof Error ? err.message : err}\nRun turnlog --help.`);
  }
  const { values, positionals } = parsed;

  if (values.version) {
    console.log(APP_VERSION);
    return;
  }
  if (values.help) {
    console.log(HELP);
    return;
  }

  const command = positionals[0] ?? 'start';
  const projectsDir = path.resolve(values.projects ?? defaultProjectsDir());

  switch (command) {
    case 'start':
      return start(projectsDir, {
        port: values.port ? Number(values.port) : undefined,
        open: values['no-open'] !== true,
      });
    case 'index':
      return runIndex(projectsDir, values.rebuild === true);
    case 'export':
      return runExport(positionals[1], values['no-footer'] === true);
    case 'search':
      return runSearch(positionals.slice(1), {
        limit: values.limit,
        json: values.json === true,
      });
    case 'mcp':
      return runMcp(projectsDir);
    default:
      fail(`Unknown command "${command}". Run turnlog --help.`);
  }
}

async function start(projectsDir: string, opts: { port?: number; open: boolean }): Promise<void> {
  if (!fs.existsSync(projectsDir)) {
    console.warn(
      `Note: ${projectsDir} does not exist yet — no Claude Code sessions found.\n` +
        `Point turnlog elsewhere with --projects <dir>.`,
    );
  }

  const dbFile = dbPath();
  const db = openDb(dbFile); // main-thread connection: creates schema, then read-only use
  // TURNLOG_TOKEN is a dev-only escape hatch so the Vite proxy can inject a
  // stable token; real launches always get a fresh random one.
  const token = process.env.TURNLOG_TOKEN ?? crypto.randomBytes(16).toString('hex');
  const settings = loadSettings();
  const driver = new WorkerDriver({
    dbPath: dbFile,
    projectsDir,
    pricingOverrides: settings.modelPricing,
  });

  // Set once the startup registry check resolves (below); read live by
  // /api/status so the web UI surfaces the same "update available" notice.
  // TURNLOG_FAKE_UPDATE=x.y.z seeds it up front to preview the CLI line + web
  // banner without a published newer release.
  let latestUpdate: string | null = process.env.TURNLOG_FAKE_UPDATE ?? null;
  const events = new SseHub();

  const { server, url } = await startServer(
    {
      db,
      driver,
      token,
      pricingOverrides: settings.modelPricing,
      exportFooter: settings.exportFooter,
      getUpdate: () => latestUpdate,
      events,
      // The web UI's stop button — same path as Ctrl-C. `shutdown` is declared
      // below but initialized long before this can fire.
      onShutdown: () => {
        console.log('\nStop requested from the web UI.');
        void shutdown();
      },
    },
    { port: opts.port },
  );

  const knownSessions = (
    db.prepare(`SELECT COUNT(*) AS n FROM sessions`).get() as { n: number }
  ).n;
  const firstRun = knownSessions === 0;

  console.log(`turnlog ${APP_VERSION}`);
  console.log(`  UI:       ${url}`);
  console.log(`  Projects: ${projectsDir}`);
  console.log(`  Index:    ${dbFile}`);
  console.log(`  Bound to 127.0.0.1 only — verify with: lsof -iTCP -sTCP:LISTEN | grep node`);
  if (firstRun) {
    console.log('\nFirst run — building the index. This is a one-time pass;');
    console.log('sessions appear in the UI as they are parsed.');
  }

  // Let `turnlog search` print deep links into this instance. Token-bearing,
  // so 0600 and removed on shutdown; same trust boundary as the DB beside it.
  try {
    fs.writeFileSync(serverInfoPath(), JSON.stringify({ url, pid: process.pid }), {
      mode: 0o600,
    });
  } catch {
    /* deep links just won't resolve */
  }

  if (opts.open) openBrowser(url);

  driver
    .scan()
    .then((summary) => {
      console.log(
        (firstRun ? 'Indexed ' : 'Index up to date: ') +
          `${summary.filesSeen} session files` +
          (summary.linesParsed > 0 ? `, ${summary.linesParsed} new lines parsed` : '') +
          (summary.errors.length > 0 ? `, ${summary.errors.length} files skipped (errors)` : ''),
      );
      events.broadcast('indexed', { sessionId: null, at: new Date().toISOString() });
    })
    .catch((err) => console.error(`Indexing failed: ${err.message}`));

  if (updateCheckEnabled(settings.checkUpdates)) {
    void checkForUpdate(APP_VERSION).then((latest) => {
      if (latest) {
        latestUpdate = latest;
        console.log(
          `\nUpdate available: ${APP_VERSION} → ${latest}. Run: npm i -g turnlog@latest`,
        );
      }
    });
  }

  const stopWatching = watchProjects(projectsDir, (filePath) => {
    driver
      .indexFile(filePath)
      .then(() => {
        // Subagent transcripts roll into their parent — broadcast without a
        // session id so clients refresh broadly instead of a wrong target.
        const isSubagent = path.basename(path.dirname(filePath)) === 'subagents';
        events.broadcast('indexed', {
          sessionId: isSubagent ? null : path.basename(filePath, '.jsonl'),
          at: new Date().toISOString(),
        });
      })
      .catch(() => undefined);
  });

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\nShutting down…');
    try {
      fs.unlinkSync(serverInfoPath());
    } catch {
      /* already gone */
    }
    await stopWatching();
    await driver.close();
    events.close(); // open SSE responses would otherwise block server.close
    server.close();
    db.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function runIndex(projectsDir: string, rebuild: boolean): Promise<void> {
  const started = Date.now();
  const db = openDb(dbPath());
  const settings = loadSettings();
  const indexer = new Indexer(db, { projectsDir, pricingOverrides: settings.modelPricing });

  const onProgress = (p: { filesTotal: number; filesDone: number }) => {
    if (process.stdout.isTTY) {
      process.stdout.write(`\rIndexing ${p.filesDone}/${p.filesTotal} files…`);
    }
  };
  const summary = rebuild ? await indexer.rebuild(onProgress) : await indexer.scanAll(onProgress);
  if (process.stdout.isTTY) process.stdout.write('\r');

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `${rebuild ? 'Rebuilt' : 'Indexed'} ${summary.filesSeen} session files ` +
      `(${summary.linesParsed} lines parsed) in ${secs}s.`,
  );
  for (const err of summary.errors) {
    console.error(`  skipped ${err.file}: ${err.message}`);
  }
  db.close();
}

async function runExport(idArg: string | undefined, noFooter: boolean): Promise<void> {
  if (!idArg) fail('Usage: turnlog export <session-id>  (accepts a unique id prefix)');
  const db = openDb(dbPath());
  try {
    const id = resolveSessionId(db, idArg);
    if (!id) fail(`No session matches "${idArg}". Run turnlog and copy an id from the URL.`);
    const settings = loadSettings();
    const attribution = noFooter ? false : (settings.exportFooter ?? true);
    const md = getSessionExport(db, id, { attribution });
    if (md === null) fail(`Session "${id}" not found.`);
    process.stdout.write(md);
  } finally {
    db.close();
  }
}

/**
 * A running `turnlog` instance's tokened URL, verified live — or null.
 * Loopback-only: this never leaves the machine.
 */
async function liveServerUrl(): Promise<string | null> {
  try {
    const info = JSON.parse(fs.readFileSync(serverInfoPath(), 'utf8')) as { url?: unknown };
    if (typeof info.url !== 'string') return null;
    const parsed = new URL(info.url);
    const token = parsed.searchParams.get('token') ?? '';
    const status = await fetch(new URL('/api/status', parsed), {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(800),
    });
    return status.ok ? info.url : null;
  } catch {
    return null; // no file, stale file, or no server listening
  }
}

async function runSearch(
  rest: string[],
  opts: { limit?: string; json: boolean },
): Promise<void> {
  const query = rest.join(' ').trim();
  if (!query) {
    fail(
      'Usage: turnlog search <query>\n' +
        'Operators: tool: kind: is:error project: model: before: after: (combinable with text)',
    );
  }
  let limit: number | undefined;
  if (opts.limit !== undefined) {
    limit = Number(opts.limit);
    if (!Number.isFinite(limit)) fail('--limit must be a number');
  }
  const db = openDb(dbPath());
  try {
    const serverUrl = await liveServerUrl();
    process.stdout.write(
      renderSearch(db, query, {
        limit,
        json: opts.json,
        color: process.stdout.isTTY === true && !opts.json,
        serverUrl,
      }),
    );
  } finally {
    db.close();
  }
}

/**
 * MCP server mode: the index as read-only agent memory over stdio.
 * stdout is the protocol channel — every diagnostic here goes to stderr.
 */
async function runMcp(projectsDir: string): Promise<void> {
  const db = openDb(dbPath());
  // The main app may be running and writing; wait out its locks briefly.
  db.pragma('busy_timeout = 5000');

  const known = (db.prepare(`SELECT COUNT(*) AS n FROM sessions`).get() as { n: number }).n;
  if (known === 0) {
    console.error('turnlog mcp: index is empty — run `turnlog` or `turnlog index` once to build it.');
  } else {
    // Warm incremental catch-up so results include recent sessions. A cold
    // first build belongs to `turnlog index` — MCP clients time out on it.
    try {
      const settings = loadSettings();
      await new Indexer(db, { projectsDir, pricingOverrides: settings.modelPricing }).scanAll();
    } catch (err) {
      console.error(
        `turnlog mcp: index refresh failed (serving the existing index): ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }

  const { handleMcpMessage, PARSE_ERROR } = await import('../mcp/mcp.js');
  const write = (res: object) => process.stdout.write(`${JSON.stringify(res)}\n`);

  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on('line', (line) => {
    if (line.trim() === '') return;
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      write(PARSE_ERROR);
      return;
    }
    // Batches were dropped from the MCP spec but cost nothing to tolerate.
    for (const one of Array.isArray(msg) ? msg : [msg]) {
      const res = handleMcpMessage(db, one);
      if (res !== null) write(res);
    }
  });
  // Client hung up (stdin closed) — the session is over.
  rl.on('close', () => {
    db.close();
    process.exit(0);
  });

  console.error(`turnlog mcp: serving ${known} sessions over stdio (read-only, local)`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
