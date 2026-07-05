#!/usr/bin/env node
/**
 * One-command dev loop: builds the server, starts it with a shared dev
 * token, then starts the Vite dev server whose proxy injects that token.
 * Ctrl-C tears both down. Zero dependencies on purpose.
 */
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = process.env.TURNLOG_PORT ?? '4483';
const token = process.env.TURNLOG_TOKEN ?? crypto.randomBytes(8).toString('hex');
const isWin = process.platform === 'win32';

function prefixed(name, color, child) {
  const prefix = `\x1b[${color}m[${name}]\x1b[0m `;
  for (const stream of [child.stdout, child.stderr]) {
    let buf = '';
    stream.on('data', (chunk) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) process.stdout.write(prefix + line + '\n');
    });
  }
}

console.log('building server…');
const build = spawnSync('npm', ['run', 'build:server'], {
  cwd: root,
  stdio: 'inherit',
  shell: isWin,
});
if (build.status !== 0) process.exit(build.status ?? 1);

const children = [];
let shuttingDown = false;
function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill('SIGTERM');
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

const api = spawn(
  'node',
  ['bin/turnlog.cjs', 'start', '--port', port, '--no-open'],
  { cwd: root, env: { ...process.env, TURNLOG_TOKEN: token }, stdio: ['ignore', 'pipe', 'pipe'] },
);
children.push(api);
prefixed('api', '33', api);
api.on('exit', (code) => {
  if (!shuttingDown) {
    console.error(`[dev] turnlog server exited (${code}) — stopping`);
    shutdown(code ?? 1);
  }
});

// Wait until the API answers before starting Vite, so the first proxied
// request never races the server boot.
const deadline = Date.now() + 15_000;
for (;;) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) break;
  } catch {
    /* not up yet */
  }
  if (Date.now() > deadline) {
    console.error('[dev] server did not become ready within 15s');
    shutdown(1);
  }
  await new Promise((r) => setTimeout(r, 250));
}

const web = spawn('npm', ['run', 'dev', '-w', 'web'], {
  cwd: root,
  env: { ...process.env, TURNLOG_TOKEN: token, TURNLOG_PORT: port },
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: isWin,
});
children.push(web);
prefixed('web', '36', web);
web.on('exit', (code) => {
  if (!shuttingDown) shutdown(code ?? 0);
});

console.log(`[dev] api on 127.0.0.1:${port} (token ${token}) — open the Vite URL below`);
