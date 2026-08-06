import fs from 'node:fs';
import path from 'node:path';

/**
 * npm's failed-cleanup droppings. On Windows, `npm i -g turnlog` cannot
 * delete the OLD install while its native addon is loaded (a running server,
 * or the MCP process an agent keeps alive), so npm renames it to
 * `node_modules/.turnlog-<random>`, fails the unlink, and warns. By the next
 * launch that old process is gone and the dir is deletable — so the app
 * sweeps its own install's siblings on start. Deliberately NOT done at
 * install time: no postinstall scripts, ever.
 */

/** Leftover update dirs beside this install; [] when not npm-installed
 *  (a dev checkout's parent is not a node_modules — nothing to sweep). */
export function findUpdateLeftovers(packageDir: string): string[] {
  const parent = path.dirname(packageDir);
  if (path.basename(packageDir) !== 'turnlog' || path.basename(parent) !== 'node_modules') {
    return [];
  }
  try {
    return fs
      .readdirSync(parent)
      .filter((name) => name.startsWith('.turnlog-'))
      .map((name) => path.join(parent, name));
  } catch {
    return [];
  }
}

/**
 * Delete what findUpdateLeftovers found; returns what was actually removed.
 * A dir that is still locked (an old process alive right now) is skipped
 * silently — the next launch gets another try.
 */
export function sweepUpdateLeftovers(packageDir: string): string[] {
  const removed: string[] = [];
  for (const dir of findUpdateLeftovers(packageDir)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      removed.push(dir);
    } catch {
      /* locked — retried on a later launch */
    }
  }
  return removed;
}
