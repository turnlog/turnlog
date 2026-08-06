import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { findUpdateLeftovers, sweepUpdateLeftovers } from '../src/cli/updateCleanup.js';
import { tmpDir } from './helpers.js';

/** A fake npm-installed layout: <tmp>/node_modules/turnlog + siblings. */
function installedLayout(): { packageDir: string; nodeModules: string } {
  const nodeModules = path.join(tmpDir('turnlog-sweep-'), 'node_modules');
  const packageDir = path.join(nodeModules, 'turnlog');
  fs.mkdirSync(packageDir, { recursive: true });
  return { packageDir, nodeModules };
}

describe('update leftover sweep', () => {
  it('removes only .turnlog-* siblings, deeply, and reports them', () => {
    const { packageDir, nodeModules } = installedLayout();
    const leftover = path.join(nodeModules, '.turnlog-AvRw7Azg');
    fs.mkdirSync(path.join(leftover, 'node_modules', 'better-sqlite3', 'build'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(leftover, 'node_modules', 'better-sqlite3', 'build', 'x.node'),
      'x',
    );
    // Neighbors that must survive: another package, a dot-dir that is not
    // ours, and a visible dir that merely starts with our name.
    fs.mkdirSync(path.join(nodeModules, 'chokidar'));
    fs.mkdirSync(path.join(nodeModules, '.bin'));
    fs.mkdirSync(path.join(nodeModules, 'turnlog-extras'));

    const removed = sweepUpdateLeftovers(packageDir);
    expect(removed).toEqual([leftover]);
    expect(fs.existsSync(leftover)).toBe(false);
    expect(fs.existsSync(path.join(nodeModules, 'chokidar'))).toBe(true);
    expect(fs.existsSync(path.join(nodeModules, '.bin'))).toBe(true);
    expect(fs.existsSync(path.join(nodeModules, 'turnlog-extras'))).toBe(true);
  });

  it('no-ops outside an npm install — a dev checkout has nothing to sweep', () => {
    // Parent is not a node_modules.
    const checkout = path.join(tmpDir('turnlog-sweep-dev-'), 'turnlog');
    fs.mkdirSync(checkout, { recursive: true });
    expect(findUpdateLeftovers(checkout)).toEqual([]);
    // Inside node_modules but not our package name.
    const other = path.join(tmpDir('turnlog-sweep-other-'), 'node_modules', 'not-turnlog');
    fs.mkdirSync(other, { recursive: true });
    expect(findUpdateLeftovers(other)).toEqual([]);
  });

  it('finds without deleting — the doctor half', () => {
    const { packageDir, nodeModules } = installedLayout();
    const leftover = path.join(nodeModules, '.turnlog-x1y2z3');
    fs.mkdirSync(leftover);
    expect(findUpdateLeftovers(packageDir)).toEqual([leftover]);
    expect(fs.existsSync(leftover)).toBe(true);
  });
});
