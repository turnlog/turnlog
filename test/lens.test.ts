import { beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { Indexer } from '../src/indexer/indexer.js';
import { listMessages } from '../src/server/api.js';
import { SESSION_C, copyCorpus, testDb, tmpDir } from './helpers.js';

let db: Database.Database;

beforeAll(async () => {
  db = testDb(tmpDir('turnlog-lens-'));
  await new Indexer(db, { projectsDir: copyCorpus() }).scanAll();
});

// SESSION_C: prompt → assistant → Bash (fails) → Edit (fix) → assistant.
describe('lenses', () => {
  it('prompts: main-chain prompts only', () => {
    const res = listMessages(db, SESSION_C, { lens: 'prompts' })!;
    expect(res.total).toBe(1);
    expect(res.messages.every((m) => m.kind === 'prompt' && !m.isSidechain)).toBe(true);
  });

  it('commands: Bash calls with their paired results', () => {
    const res = listMessages(db, SESSION_C, { lens: 'commands' })!;
    expect(res.total).toBe(2);
    const [use, result] = res.messages;
    expect(use!.toolName).toBe('Bash');
    expect(result!.kind).toBe('tool_result');
    expect(result!.toolUseId).toBe(use!.toolUseId);
  });

  it('errors: failing results plus their anchoring tool_use', () => {
    const res = listMessages(db, SESSION_C, { lens: 'errors' })!;
    expect(res.total).toBe(2);
    expect(res.messages.some((m) => m.isError)).toBe(true);
    expect(res.messages.some((m) => m.kind === 'tool_use')).toBe(true);
    expect(new Set(res.messages.map((m) => m.toolUseId)).size).toBe(1);
  });

  it('diffs: edit tools with results, and lens honors pagination', () => {
    const res = listMessages(db, SESSION_C, { lens: 'diffs' })!;
    expect(res.total).toBe(2);
    expect(res.messages[0]!.toolName).toBe('Edit');

    const page = listMessages(db, SESSION_C, {
      lens: 'diffs',
      afterIdx: res.messages[0]!.idx,
    })!;
    expect(page.messages).toHaveLength(1);
    expect(page.total).toBe(2);
  });
});
