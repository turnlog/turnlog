import { parseArgs } from 'node:util';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { dbPath, defaultProjectsDir, loadSettings } from '../config.js';
import { getSessionExport, resolveSessionId } from '../server/api.js';
import { openDb } from '../indexer/db.js';
import { Indexer } from '../indexer/indexer.js';
import { WorkerDriver } from '../indexer/workerDriver.js';
import { watchProjects } from '../indexer/watcher.js';
import { startServer } from '../server/server.js';
import { openBrowser } from './open.js';
import { APP_VERSION } from '../version.js';

const HELP = `turnlog ${APP_VERSION} — search and replay your Claude Code sessions, locally.

Usage:
  turnlog                     Start the local server and open the UI
  turnlog index               Incrementally index ~/.claude/projects and exit
  turnlog index --rebuild     Drop the index and rebuild from scratch
  turnlog license <key>       Activate a license (coming soon)
  turnlog export <id>         Print a session as markdown (id or unique prefix)

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
  const { values, positionals } = parseArgs({
    options: {
      port: { type: 'string' },
      projects: { type: 'string' },
      'no-open': { type: 'boolean' },
      'no-footer': { type: 'boolean' },
      rebuild: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'V' },
    },
    allowPositionals: true,
  });

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
    case 'license':
      fail('License activation ships in a later release. Follow along at turnlog.dev.');
      break;
    case 'export':
      return runExport(positionals[1], values['no-footer'] === true);
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

  const { server, url } = await startServer(
    {
      db,
      driver,
      token,
      pricingOverrides: settings.modelPricing,
      exportFooter: settings.exportFooter,
    },
    { port: opts.port },
  );

  console.log(`turnlog ${APP_VERSION}`);
  console.log(`  UI:       ${url}`);
  console.log(`  Projects: ${projectsDir}`);
  console.log(`  Index:    ${dbFile}`);
  console.log(`  Bound to 127.0.0.1 only — verify with: lsof -iTCP -sTCP:LISTEN | grep node`);

  if (opts.open) openBrowser(url);

  driver
    .scan()
    .then((summary) => {
      console.log(
        `Index up to date: ${summary.filesSeen} session files` +
          (summary.linesParsed > 0 ? `, ${summary.linesParsed} new lines parsed` : '') +
          (summary.errors.length > 0 ? `, ${summary.errors.length} files skipped (errors)` : ''),
      );
    })
    .catch((err) => console.error(`Indexing failed: ${err.message}`));

  const stopWatching = watchProjects(projectsDir, (filePath) => {
    driver.indexFile(filePath).catch(() => undefined);
  });

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\nShutting down…');
    await stopWatching();
    await driver.close();
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

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
