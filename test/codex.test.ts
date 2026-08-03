import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { Indexer, mungeCwd } from '../src/indexer/indexer.js';
import { getSession, getSessionContext, listProjects, listTurns, searchMessages } from '../src/server/api.js';
import { CODEX_SESSION, SESSION_A, copyCodexCorpus, copyCorpus, testDb, tmpDir } from './helpers.js';

let db: Database.Database;
let codexDir: string;

beforeAll(async () => {
  db = testDb(tmpDir('turnlog-codexidx-'));
  codexDir = copyCodexCorpus();
  await new Indexer(db, { projectsDir: copyCorpus(), codexDir }).scanAll();
});

describe('codex indexing', () => {
  it('indexes rollouts with tool stamped and the id from the filename', () => {
    const s = getSession(db, CODEX_SESSION)!;
    expect(s.tool).toBe('codex');
    expect(s.model).toBe('gpt-5-codex');
    expect(s.parentSessionId).toBeNull();
  });

  it('lands in the same project as CC work in the same cwd', () => {
    // The rollout's cwd is /Users/dev/projects/webapp — SESSION_A's project.
    const codex = getSession(db, CODEX_SESSION)!;
    const cc = getSession(db, SESSION_A)!;
    expect(codex.projectKey).toBe(cc.projectKey);
    expect(mungeCwd('/Users/dev/projects/webapp')).toBe('-Users-dev-projects-webapp');
    const project = listProjects(db).find((p) => p.projectKey === cc.projectKey)!;
    expect(project.sessionCount).toBeGreaterThanOrEqual(3); // A + B + the rollout
  });

  it('sums usage from last_token_usage — uncached input split from cache reads', () => {
    const s = getSession(db, CODEX_SESSION)!;
    // Two token_count events: (1200/800/100/90) and (2000/1600/0/120).
    expect(s.inputTokens).toBe(800); // uncached: 400 + 400
    expect(s.cacheReadTokens).toBe(2400); // 800 + 1600
    expect(s.cacheWriteTokens).toBe(100);
    expect(s.outputTokens).toBe(210);
  });

  it('builds a turn spine from user_message prompts only', () => {
    const res = listTurns(db, CODEX_SESSION)!;
    expect(res.turns).toHaveLength(2);
    expect(res.turns[0]!.text).toContain('websocket reconnect');
    expect(res.turns[1]!.text).toContain('failing test');
    // The failing npm test surfaces on the second turn.
    expect(res.turns[1]!.errors).toBe(1);
    expect(res.turns[1]!.commands + res.turns[1]!.otherTools).toBeGreaterThan(0);
  });

  it('search spans both tools inside one project', () => {
    const res = searchMessages(db, { query: 'scheduleReconnect' });
    const ids = res.groups.map((g) => g.session.id);
    expect(ids).toContain(SESSION_A);
    expect(ids).toContain(CODEX_SESSION);
  });

  it('does not double-count on incremental appends', async () => {
    const file = fs
      .readdirSync(path.join(codexDir, '2026', '07', '29'))
      .map((f) => path.join(codexDir, '2026', '07', '29', f))[0]!;
    const before = getSession(db, CODEX_SESSION)!;
    // A third turn appends: token_count last_token_usage 500 in / 300 cached / 40 out.
    fs.appendFileSync(
      file,
      '{"timestamp":"2026-07-29T09:02:00.000Z","type":"event_msg","payload":{"type":"user_message","message":"thanks, wrap up"}}\n' +
        '{"timestamp":"2026-07-29T09:02:03.000Z","type":"event_msg","payload":{"type":"agent_message","message":"Done — backoff fix outlined."}}\n' +
        '{"timestamp":"2026-07-29T09:02:03.100Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":3700,"cached_input_tokens":2700,"cache_write_input_tokens":100,"output_tokens":250},"last_token_usage":{"input_tokens":500,"cached_input_tokens":300,"cache_write_input_tokens":0,"output_tokens":40}}}}\n',
    );
    const indexer = new Indexer(db, { projectsDir: tmpDir('turnlog-empty-'), codexDir });
    await indexer.indexFile(file);
    const after = getSession(db, CODEX_SESSION)!;
    expect(after.inputTokens).toBe(before.inputTokens + 200); // 500 - 300 uncached
    expect(after.cacheReadTokens).toBe(before.cacheReadTokens + 300);
    expect(after.outputTokens).toBe(before.outputTokens + 40);
    // The appended assistant row still knows the model (reseeded state).
    const modelRow = db
      .prepare(
        `SELECT model FROM messages WHERE session_id = ? AND kind = 'assistant' ORDER BY idx DESC LIMIT 1`,
      )
      .get(CODEX_SESSION) as { model: string | null };
    expect(modelRow.model).toBe('gpt-5-codex');
    const turns = listTurns(db, CODEX_SESSION)!;
    expect(turns.turns).toHaveLength(3);
  });

  it('gates the context strip: codex deltas are not window fill', () => {
    const ctx = getSessionContext(db, CODEX_SESSION)!;
    expect(ctx.points).toHaveLength(0);
    expect(ctx.compactions).toHaveLength(0);
  });

  it('keeps world_state and friends under the cardinal rule', () => {
    const unknown = db
      .prepare(
        `SELECT COUNT(*) AS n FROM messages WHERE session_id = ? AND kind = 'unknown'`,
      )
      .get(CODEX_SESSION) as { n: number };
    expect(unknown.n).toBe(1); // world_state, raw preserved
  });
});
