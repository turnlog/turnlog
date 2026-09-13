/**
 * node:sqlite prints "ExperimentalWarning: SQLite is an experimental feature"
 * once per thread on Node 22 (Node 24 calls it a release candidate and stays
 * quiet). Turnlog depends on it on purpose, so the line is noise — in the
 * terminal and on the stderr an agent reads from `turnlog mcp`. Patching
 * emitWarning drops that one warning and leaves every other, and Node's own
 * --trace-warnings / --no-warnings handling, exactly as they were. Import
 * this before anything that loads node:sqlite; bin/turnlog.cjs carries the
 * same patch for the main thread, which runs before any ESM does.
 */
const emitWarning = process.emitWarning;
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const type = rest[0];
  const name = typeof type === 'string' ? type : (type as { type?: string } | undefined)?.type;
  if (name === 'ExperimentalWarning' && /SQLite/.test(String(warning))) return;
  (emitWarning as (...args: unknown[]) => void).call(process, warning, ...rest);
}) as typeof process.emitWarning;

export {};
