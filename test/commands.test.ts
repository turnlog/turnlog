import { beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { Indexer } from '../src/indexer/indexer.js';
import {
  commandSignature,
  getCommandHistory,
  getCommands,
  parseSearchQuery,
  searchMessages,
} from '../src/server/api.js';
import { copyCodexCorpus, copyCorpus, copyCursorCliCorpus, testDb, tmpDir } from './helpers.js';

let db: Database.Database;

beforeAll(async () => {
  db = testDb(tmpDir('turnlog-commands-'));
  await new Indexer(db, {
    projectsDir: copyCorpus(),
    codexDir: copyCodexCorpus(),
    cursorCliDir: copyCursorCliCorpus(),
  }).scanAll();
});

describe('commandSignature', () => {
  it('normalizes paths, ids and numbers without merging different commands', () => {
    expect(commandSignature('npm test')).not.toBe(commandSignature('npm install'));
    expect(commandSignature('sed -n 1,120p /Users/a/x.ts')).toBe(
      commandSignature('sed -n 400,500p /Users/b/y.ts'),
    );
    expect(commandSignature('git show 3af9882d4b')).toBe(commandSignature('git show b3cf9c0777'));
  });

  it('never mangles stderr redirection digits', () => {
    expect(commandSignature('npm test 2>&1')).toContain('2>&1');
  });

  it('folds heredoc bodies and long quoted payloads', () => {
    const a = commandSignature('git commit -m "Fix the reconnect race in the socket pool"');
    const b = commandSignature('git commit -m "A completely different message entirely"');
    expect(a).toBe(b);
  });
});

describe('getCommands', () => {
  it('aggregates command runs across every agent, not only Claude Code', () => {
    const res = getCommands(db, {});
    expect(res.totalRuns).toBeGreaterThan(0);
    const all = res.commands.map((c) => c.sample);
    // One per adapter in the corpus: CC Bash, Codex exec, Cursor CLI.
    expect(all.some((s) => s.includes('npm test -- reconnect'))).toBe(true);
    expect(all.some((s) => s.includes('git log --oneline'))).toBe(true);
    expect(all.some((s) => s.includes('npm test -- socket'))).toBe(true);
  });

  it('filters by fragment and reports jump targets', () => {
    const res = getCommands(db, { filter: 'npm test' });
    expect(res.commands.length).toBeGreaterThan(0);
    for (const c of res.commands) expect(c.sample).toContain('npm test');
    const first = res.commands[0]!;
    expect(first.where.length).toBeGreaterThan(0);
    expect(first.where[0]).toHaveProperty('sessionId');
    expect(first.where[0]).toHaveProperty('idx');
  });
});

describe('getCommandHistory', () => {
  it('returns per-session verbatim runs for one signature', () => {
    const groups = getCommands(db, { filter: 'npm test' });
    const sig = groups.commands[0]!.signature;
    const history = getCommandHistory(db, sig);
    expect(history.sessions.length).toBeGreaterThan(0);
    const runs = history.sessions.flatMap((s) => s.runs);
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) expect(commandSignature(run.command)).toBe(sig);
  });

  it('returns empty for an unknown signature instead of erroring', () => {
    expect(getCommandHistory(db, 'no such signature').sessions).toEqual([]);
  });
});

describe('cmd: operator', () => {
  it('parses into a filter, not a term', () => {
    const parsed = parseSearchQuery('cmd:"npm test" reconnect');
    expect(parsed.filters.cmd).toBe('npm test');
    expect(parsed.terms).toBe('reconnect');
  });

  it('filters search hits to messages that ran a matching command', () => {
    const res = searchMessages(db, { query: 'cmd:"npm test"' });
    expect(res.totalHits).toBeGreaterThan(0);
    // And composes with an agent that is not Claude Code.
    const codex = searchMessages(db, { query: 'cmd:"git log" agent:codex' });
    expect(codex.totalHits).toBeGreaterThan(0);
  });
});
