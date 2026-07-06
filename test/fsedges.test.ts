import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Indexer } from '../src/indexer/indexer.js';
import { testDb, tmpDir } from './helpers.js';

/** A minimal projects dir with one project and the given session files. */
function makeProjects(files: Record<string, string>): { dir: string; projects: string } {
  const dir = tmpDir('turnlog-fsedge-');
  const projects = path.join(dir, 'projects');
  const proj = path.join(projects, '-Users-dev-projects-x');
  fs.mkdirSync(proj, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(proj, name), body);
  }
  return { dir, projects };
}

const line = (uuid: string, parent: string | null, text: string) =>
  JSON.stringify({
    type: 'user',
    uuid,
    parentUuid: parent,
    cwd: '/Users/dev/projects/x',
    message: { role: 'user', content: text },
    timestamp: '2026-07-06T10:00:00.000Z',
  });

describe('filesystem edges (crash-free)', () => {
  // 0-byte files are covered by test/indexer.test.ts (they yield an empty
  // session, no crash). Here we cover the edges that weren't yet asserted.

  it('indexes garbage lines as unknown records, never crashing', async () => {
    const body = ['not json at all', '{"partial": ', '{"type":"nope","uuid":"z"}'].join('\n') + '\n';
    const { dir, projects } = makeProjects({ 'g.jsonl': body });
    const db = testDb(dir);
    const summary = await new Indexer(db, { projectsDir: projects }).scanAll();
    expect(summary.errors).toHaveLength(0);
    const kinds = db.prepare('SELECT kind FROM messages').all() as { kind: string }[];
    expect(kinds.length).toBe(3);
    expect(kinds.every((k) => k.kind === 'unknown')).toBe(true);
  });

  it('leaves a mid-write partial trailing line for the next pass', async () => {
    const dirName = '-Users-dev-projects-x';
    // First line complete; second line is an incomplete JSON object, no newline.
    const partial = line('a', null, 'done') + '\n' + '{"type":"user","uuid":"b","mess';
    const { dir, projects } = makeProjects({ 's.jsonl': partial });
    const db = testDb(dir);
    const idx = new Indexer(db, { projectsDir: projects });
    await idx.scanAll();
    expect((db.prepare('SELECT COUNT(*) AS n FROM messages').get() as any).n).toBe(1);

    // Complete the partial line + newline; the rest is consumed incrementally.
    fs.appendFileSync(
      path.join(projects, dirName, 's.jsonl'),
      'age":{"role":"user","content":"later"},"parentUuid":"a","timestamp":"2026-07-06T10:01:00.000Z"}\n',
    );
    await idx.scanAll();
    expect((db.prepare('SELECT COUNT(*) AS n FROM messages').get() as any).n).toBe(2);
  });

  it('survives an unreadable project directory', async () => {
    const { dir, projects } = makeProjects({ 's.jsonl': line('a', null, 'hi') + '\n' });
    // A dangling symlink where a project dir would be — readdir/stat will fail.
    fs.symlinkSync('/no/such/target', path.join(projects, '-broken-link'));
    const db = testDb(dir);
    await new Indexer(db, { projectsDir: projects }).scanAll();
    // The real session still indexes; the broken entry doesn't crash the scan.
    expect((db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as any).n).toBe(1);
  });
});
