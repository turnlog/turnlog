import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { demoCorpusDir, demoDataDir } from '../src/config.js';
import { Indexer } from '../src/indexer/indexer.js';
import { listSessions } from '../src/server/api.js';
import { testDb, tmpDir } from './helpers.js';

/**
 * `turnlog demo` exists to serve launch — reviewers, screenshots, the landing
 * GIF. Its two promises are that it shows something real and that it cannot
 * touch the user's own history; both are asserted here, because a demo that
 * quietly reads real sessions would be the worst possible bug in a tool whose
 * whole pitch is "100% local, nothing leaves your machine".
 */
describe('demo mode', () => {
  it('ships a corpus inside the package', () => {
    const { projectsDir, codexDir } = demoCorpusDir();
    expect(fs.existsSync(projectsDir)).toBe(true);
    expect(fs.existsSync(codexDir)).toBe(true);
  });

  it('is listed in package.json files, or npm would not ship it', () => {
    const pkg = JSON.parse(
      fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { files: string[] };
    expect(pkg.files).toContain('fixtures/corpus');
    expect(pkg.files).toContain('fixtures/codex');
  });

  it('keeps its index out of the real data dir', () => {
    // Not merely a different file inside the user's data dir — a separate
    // tree that can be deleted wholesale.
    const real = process.env.TURNLOG_DATA_DIR ?? path.join('~', '.config', 'turnlog');
    expect(demoDataDir()).not.toBe(real);
    expect(demoDataDir()).toContain('turnlog-demo');
  });

  it('indexes into sessions worth showing, from both agents', async () => {
    const { projectsDir, codexDir } = demoCorpusDir();
    const db = testDb(tmpDir('turnlog-demo-'));
    await new Indexer(db, { projectsDir, codexDir }).scanAll();

    const { sessions } = listSessions(db, { limit: 100 });
    expect(sessions.length).toBeGreaterThan(0);
    // The differentiator is one timeline whichever agent you pointed at a
    // repo — a single-agent demo hides exactly what makes Turnlog different.
    expect(new Set(sessions.map((s) => s.tool)).size).toBeGreaterThan(1);
    // Something to actually look at: turns, not just empty shells.
    expect(sessions.some((s) => s.eventCount > 0)).toBe(true);
    db.close();
  });
});
