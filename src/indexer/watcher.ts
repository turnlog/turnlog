import chokidar from 'chokidar';

const DEBOUNCE_MS = 400;

/**
 * Watch the projects dir for live session updates. Events are debounced per
 * file so a burst of appended lines becomes one incremental index pass.
 * Returns a disposer.
 */
export function watchProjects(
  projectsDir: string,
  onFile: (filePath: string) => void,
): () => Promise<void> {
  const watcher = chokidar.watch(projectsDir, {
    ignoreInitial: true,
    depth: 2,
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

  return async () => {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    await watcher.close();
  };
}
