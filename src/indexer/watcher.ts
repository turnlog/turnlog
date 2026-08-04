import path from 'node:path';
import chokidar from 'chokidar';

const DEBOUNCE_MS = 400;
const VSCDB_DEBOUNCE_MS = 3000;

/**
 * Watch the projects dir for live session updates. Events are debounced per
 * file so a burst of appended lines becomes one incremental index pass.
 * Returns a disposer.
 */
export function watchProjects(
  projectsDir: string,
  onFile: (filePath: string) => void,
  /** A watched session file disappeared — health/disk views want to know. */
  onGone?: (filePath: string) => void,
): () => Promise<void> {
  const watcher = chokidar.watch(projectsDir, {
    ignoreInitial: true,
    // Deep enough for subagent transcripts: <project>/<session>/subagents/*.jsonl
    depth: 4,
  });
  const timers = new Map<string, NodeJS.Timeout>();

  const handle = (filePath: string) => {
    if (!filePath.endsWith('.jsonl')) return;
    const existing = timers.get(filePath);
    if (existing) clearTimeout(existing);
    timers.set(
      filePath,
      setTimeout(() => {
        timers.delete(filePath);
        onFile(filePath);
      }, DEBOUNCE_MS),
    );
  };

  watcher.on('add', handle);
  watcher.on('change', handle);
  watcher.on('unlink', (filePath: string) => {
    if (!filePath.endsWith('.jsonl') || !onGone) return;
    // A pending reindex for a vanished file would just error — drop it.
    const pending = timers.get(filePath);
    if (pending) {
      clearTimeout(pending);
      timers.delete(filePath);
    }
    onGone(filePath);
  });

  return async () => {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    await watcher.close();
  };
}

/**
 * Watch the Cursor IDE state DBs for composer changes. The IDE writes its
 * state constantly (and through the -wal between checkpoints, so the .vscdb
 * itself may sit still), which makes per-file debouncing pointless — any
 * state.vscdb* change collapses into ONE debounced onChange, and the caller
 * runs a scan whose per-composer freshness check keeps it cheap.
 */
export function watchCursorIde(userDir: string, onChange: () => void): () => Promise<void> {
  const watcher = chokidar.watch(
    [path.join(userDir, 'globalStorage'), path.join(userDir, 'workspaceStorage')],
    { ignoreInitial: true, depth: 2 },
  );
  let timer: NodeJS.Timeout | null = null;

  const handle = (filePath: string) => {
    if (!path.basename(filePath).startsWith('state.vscdb')) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onChange();
    }, VSCDB_DEBOUNCE_MS);
  };

  watcher.on('add', handle);
  watcher.on('change', handle);

  return async () => {
    if (timer) clearTimeout(timer);
    timer = null;
    await watcher.close();
  };
}
