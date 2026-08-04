import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runDoctor } from '../src/cli/doctor.js';
import { Indexer } from '../src/indexer/indexer.js';
import { copyCodexCorpus, copyCorpus, testDb, tmpDir } from './helpers.js';

/**
 * Doctor exists so a bug report arrives actionable. Its promises: it reads
 * everything and writes nothing, it names every agent separately, and its
 * drift numbers are real rather than decorative.
 */

let dataDir: string;
let projectsDir: string;
let codexDir: string;
const OLD_ENV = process.env.TURNLOG_DATA_DIR;

beforeEach(async () => {
  dataDir = tmpDir('turnlog-doctor-');
  process.env.TURNLOG_DATA_DIR = dataDir;
  projectsDir = copyCorpus();
  codexDir = copyCodexCorpus();
  const db = testDb(dataDir);
  await new Indexer(db, { projectsDir, codexDir }).scanAll();
  db.close();
});

afterEach(() => {
  process.env.TURNLOG_DATA_DIR = OLD_ENV;
});

describe('turnlog doctor', () => {
  it('reports versions, schema, and integrity', () => {
    const { text, healthy } = runDoctor(projectsDir, codexDir);
    expect(healthy).toBe(true);
    expect(text).toContain('turnlog');
    expect(text).toContain('sqlite');
    expect(text).toMatch(/schema\s+v\d+/);
    expect(text).toMatch(/integrity\s+ok/);
  });

  it('names every agent separately — a lump sum hides where a problem lives', () => {
    const { text } = runDoctor(projectsDir, codexDir);
    expect(text).toContain('sessions·claude-code');
    expect(text).toContain('sessions·codex');
  });

  it('sees drift when a file lands that the index has not caught up on', () => {
    const before = runDoctor(projectsDir, codexDir);
    expect(before.text).not.toContain('drift');

    const proj = fs.readdirSync(projectsDir).find((d) =>
      fs.statSync(path.join(projectsDir, d)).isDirectory(),
    )!;
    fs.writeFileSync(path.join(projectsDir, proj, 'fresh-session.jsonl'), '{}\n');
    const after = runDoctor(projectsDir, codexDir);
    expect(after.text).toContain('drift');
  });

  it('reports files gone from disk', () => {
    const victim = fs
      .readdirSync(projectsDir)
      .map((d) => path.join(projectsDir, d))
      .filter((d) => fs.statSync(d).isDirectory())
      .flatMap((d) => fs.readdirSync(d).map((f) => path.join(d, f)))
      .find((f) => f.endsWith('.jsonl'))!;
    fs.rmSync(victim);
    const { text } = runDoctor(projectsDir, codexDir);
    expect(text).toMatch(/files gone\s+[1-9]/);
  });

  it('never writes: the index is byte-identical after a run', () => {
    const indexPath = path.join(dataDir, 'index.sqlite');
    const before = fs.statSync(indexPath).mtimeMs;
    runDoctor(projectsDir, codexDir);
    expect(fs.statSync(indexPath).mtimeMs).toBe(before);
  });

  it('handles a machine with no index yet instead of creating one', () => {
    const empty = tmpDir('turnlog-doctor-empty-');
    process.env.TURNLOG_DATA_DIR = empty;
    const { text, healthy } = runDoctor(projectsDir, codexDir);
    expect(healthy).toBe(true);
    expect(text).toContain('none yet');
    // The read-only promise, tested at its sharpest point: doctor on a fresh
    // machine must not have manufactured a database.
    expect(fs.existsSync(path.join(empty, 'index.sqlite'))).toBe(false);
  });
});
