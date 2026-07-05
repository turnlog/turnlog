import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { Indexer } from '../src/indexer/indexer.js';
import { searchMessages } from '../src/server/api.js';
import { ADAPTER_VERSION } from '../src/version.js';
import { SESSION_A, SESSION_B, SESSION_C, SESSION_EMPTY, copyCorpus, testDb, tmpDir } from './helpers.js';

let projectsDir: string;
let db: Database.Database;
let indexer: Indexer;

function sessionRow(id: string): any {
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
}

function sessionAPath(): string {
  return path.join(projectsDir, '-Users-dev-projects-webapp', `${SESSION_A}.jsonl`);
}

beforeEach(() => {
  projectsDir = copyCorpus();
  db = testDb(tmpDir('turnlog-db-'));
  indexer = new Indexer(db, { projectsDir });
});

describe('Indexer', () => {
  it('indexes the whole corpus with correct aggregates', async () => {
    const summary = await indexer.scanAll();
    expect(summary.filesSeen).toBe(4);
    expect(summary.errors).toEqual([]);

    const count = db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number };
    expect(count.n).toBe(4);

    const a = sessionRow(SESSION_A);
    expect(a.turn_count).toBe(16);
    expect(a.files_touched_count).toBe(2);
    expect(a.model).toBe('claude-opus-4-8');
    expect(a.project_path).toBe('/Users/dev/projects/webapp');
    expect(a.input_tokens).toBe(1200 + 40 + 80 + 50 + 600 + 90);
    expect(a.started_at).toBe('2026-07-01T10:00:00.000Z');
    expect(a.ended_at).toBe('2026-07-01T10:03:00.000Z');
    expect(a.cost_usd).toBeGreaterThan(0);
  });

  it('prefers per-message costUSD recorded by older CC versions', async () => {
    await indexer.scanAll();
    expect(sessionRow(SESSION_B).cost_usd).toBeCloseTo(0.0345);
  });

  it('handles a 0-byte session file without crashing', async () => {
    await indexer.scanAll();
    const row = sessionRow(SESSION_EMPTY);
    expect(row).toBeDefined();
    expect(row.turn_count).toBe(0);
  });

  it('skips files that have not changed since the last scan', async () => {
    await indexer.scanAll();
    const second = await indexer.scanAll();
    expect(second.filesIndexed).toBe(0);
    expect(second.linesParsed).toBe(0);
  });

  it('indexes appended lines incrementally without duplicating anything', async () => {
    await indexer.scanAll();
    const before = sessionRow(SESSION_A);

    fs.appendFileSync(
      sessionAPath(),
      `{"parentUuid":"a5","isSidechain":false,"cwd":"/Users/dev/projects/webapp","sessionId":"${SESSION_A}","type":"user","message":{"role":"user","content":"now add tests"},"uuid":"u5","timestamp":"2026-07-01T10:05:00.000Z"}\n` +
        `{"parentUuid":"u5","isSidechain":false,"cwd":"/Users/dev/projects/webapp","sessionId":"${SESSION_A}","type":"assistant","message":{"id":"msg_01G","role":"assistant","model":"claude-opus-4-8","content":[{"type":"text","text":"Adding tests now."}],"usage":{"input_tokens":30,"output_tokens":20}},"uuid":"a6","timestamp":"2026-07-01T10:05:10.000Z"}\n`,
    );
    const parsed = await indexer.indexFile(sessionAPath());
    expect(parsed).toBe(2);

    const after = sessionRow(SESSION_A);
    expect(after.turn_count).toBe(before.turn_count + 2);
    expect(after.ended_at).toBe('2026-07-01T10:05:10.000Z');
    expect(after.file_byte_offset).toBe(fs.statSync(sessionAPath()).size);

    const distinct = db
      .prepare('SELECT COUNT(DISTINCT uuid) AS n, COUNT(*) AS total FROM messages WHERE session_id = ?')
      .get(SESSION_A) as { n: number; total: number };
    expect(distinct.n).toBe(distinct.total);
  });

  it('leaves a mid-write partial line for the next pass', async () => {
    await indexer.scanAll();
    const before = sessionRow(SESSION_A);

    // Writer got interrupted mid-line: invalid JSON, no newline.
    fs.appendFileSync(sessionAPath(), `{"parentUuid":"a5","type":"user","message`);
    await indexer.indexFile(sessionAPath());
    expect(sessionRow(SESSION_A).turn_count).toBe(before.turn_count);

    // Writer finishes the line.
    fs.appendFileSync(
      sessionAPath(),
      `":{"role":"user","content":"done?"},"uuid":"u6","sessionId":"${SESSION_A}"}\n`,
    );
    await indexer.indexFile(sessionAPath());
    const after = sessionRow(SESSION_A);
    expect(after.turn_count).toBe(before.turn_count + 1);
    expect(
      db.prepare('SELECT kind FROM messages WHERE session_id = ? AND uuid = ?').get(SESSION_A, 'u6'),
    ).toMatchObject({ kind: 'prompt' });
  });

  it('fully reindexes a file that shrank (rewritten session)', async () => {
    await indexer.scanAll();
    const file = path.join(projectsDir, '-Users-dev-projects-webapp', `${SESSION_B}.jsonl`);
    const firstLine = fs.readFileSync(file, 'utf8').split('\n')[0]!;
    fs.writeFileSync(file, firstLine + '\n');

    await indexer.indexFile(file);
    const row = sessionRow(SESSION_B);
    expect(row.turn_count).toBe(1);
    expect(row.cost_usd).toBeNull();
    // The FTS index must not retain ghosts of deleted messages.
    expect(searchMessages(db, { query: 'release notes' }).totalHits).toBe(0);
  });

  it('fully reindexes when the adapter version bumps', async () => {
    await indexer.scanAll();
    db.prepare('UPDATE sessions SET adapter_version = 0 WHERE id = ?').run(SESSION_C);
    const summary = await indexer.scanAll();
    expect(summary.filesIndexed).toBe(1);
    const row = sessionRow(SESSION_C);
    expect(row.adapter_version).toBe(ADAPTER_VERSION);
    expect(row.turn_count).toBe(7);
  });

  it('rebuild wipes and reproduces identical counts', async () => {
    await indexer.scanAll();
    const before = db.prepare('SELECT COUNT(*) AS n FROM messages').get() as { n: number };
    const summary = await indexer.rebuild();
    expect(summary.filesSeen).toBe(4);
    const after = db.prepare('SELECT COUNT(*) AS n FROM messages').get() as { n: number };
    expect(after.n).toBe(before.n);
  });
});
