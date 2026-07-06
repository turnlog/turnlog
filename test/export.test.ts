import { beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { Indexer } from '../src/indexer/indexer.js';
import { getSessionExport, resolveSessionId } from '../src/server/api.js';
import { SESSION_C, copyCorpus, testDb, tmpDir } from './helpers.js';

let db: Database.Database;

beforeAll(async () => {
  db = testDb(tmpDir('turnlog-export-'));
  await new Indexer(db, { projectsDir: copyCorpus() }).scanAll();
});

// SESSION_C: prompt → assistant → Bash (fails) → Edit (null-safety fix) → assistant.
describe('markdown export', () => {
  it('renders prompt, prose, tool details, diff, and result', () => {
    const md = getSessionExport(db, SESSION_C)!;
    expect(md).toContain('# api — Claude Code session');
    expect(md).toContain('> **You:**');
    expect(md).toContain('quantum_flux_capacitor');
    expect(md).toContain('<details><summary>Bash');
    expect(md).toContain('```bash');
    expect(md).toContain('<details><summary>Edit');
    expect(md).toContain('```diff');
    expect(md).toContain('- return readings.gigawatts;');
    expect(md).toContain('+ return readings?.gigawatts ?? 0;');
    expect(md).toContain('**Result (error):**');
    expect(md).toContain('TypeError');
  });

  it('includes the attribution footer by default and omits it on request', () => {
    expect(getSessionExport(db, SESSION_C)!).toContain('Exported with [Turnlog]');
    expect(getSessionExport(db, SESSION_C, { attribution: false })!).not.toContain('Turnlog]');
  });

  it('never leaves a dangling code fence and ends with one newline', () => {
    const md = getSessionExport(db, SESSION_C)!;
    expect((md.match(/```/g)?.length ?? 0) % 2).toBe(0);
    expect(md.endsWith('\n')).toBe(true);
    expect(md.endsWith('\n\n')).toBe(false);
  });

  it('resolves a unique id prefix and returns null for unknown', () => {
    expect(resolveSessionId(db, SESSION_C.slice(0, 8))).toBe(SESSION_C);
    expect(resolveSessionId(db, 'zzzznope')).toBeNull();
    expect(getSessionExport(db, 'zzzznope')).toBeNull();
  });
});
