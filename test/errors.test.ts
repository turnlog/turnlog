import { beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { Indexer } from '../src/indexer/indexer.js';
import { errorSignature, getErrorSignatures } from '../src/server/api.js';
import { copyCorpus, testDb, tmpDir } from './helpers.js';

/**
 * Grouping failures is only useful if the rule is trustworthy: it must merge
 * the same failure across runs and refuse to merge different ones. Both
 * directions are tested, because over-merging is the worse mistake — it hides
 * a real problem inside someone else's group.
 */
describe('error signatures', () => {
  it('merges the same failure across paths, ids, and numbers', () => {
    const a = errorSignature(
      '<tool_use_error>File has not been read yet. Read it first: /Users/a/proj/src/app.ts</tool_use_error>',
    );
    const b = errorSignature(
      '<tool_use_error>File has not been read yet. Read it first: /home/b/other/lib/x.rs</tool_use_error>',
    );
    expect(a).toBe(b);
    expect(a).toContain('File has not been read yet');
    expect(a).not.toContain('/Users/a/proj');
  });

  it('keys on the first sentence, so trailing guidance does not split a group', () => {
    // Observed on real logs: one rejection message ends "…STOP what you are
    // doing", another "…To tell Claude…", after 150 identical characters.
    // Grouping on the whole prefix produced two rows that LOOKED identical.
    const a = errorSignature(
      'The user rejected this tool use. The tool use was not executed. STOP what you are doing.',
    );
    const b = errorSignature(
      'The user rejected this tool use. The tool use was not executed. To tell the agent why, reply.',
    );
    expect(a).toBe(b);
    expect(a).toBe('The user rejected this tool use.');
  });

  it('still separates errors whose first sentences differ', () => {
    expect(errorSignature('Build failed. See log.')).not.toBe(
      errorSignature('Tests failed. See log.'),
    );
  });

  it('falls back to a bounded prefix when there is no sentence to cut at', () => {
    const sig = errorSignature('ENOENT no such file or directory /a/b/c.ts');
    expect(sig).toContain('ENOENT');
    expect(sig).toContain('<path>');
    expect(sig.length).toBeLessThanOrEqual(160);
  });

  it('merges Windows paths with POSIX ones', () => {
    expect(errorSignature('cannot open C:\\Users\\dev\\app\\main.go')).toBe(
      errorSignature('cannot open /home/dev/app/main.go'),
    );
  });

  it('collapses varying numbers, hashes, uuids and urls', () => {
    expect(errorSignature('Command timed out after 10m 0s')).toBe(
      errorSignature('Command timed out after 3m 42s'),
    );
    expect(errorSignature('failed at commit c51b86d9f2a')).toBe(
      errorSignature('failed at commit 8e5c3a1b7d4'),
    );
    expect(errorSignature('GET https://registry.npmjs.org/x 401')).toBe(
      errorSignature('GET https://example.com/y 500'),
    );
    expect(
      errorSignature('session 8d442dc2-39e2-4ef6-9c57-8cc7406f9b30 missing'),
    ).toBe(errorSignature('session aaaa0000-1111-4222-8333-444455556666 missing'));
  });

  it('collapses the quoted payload, which is the input and not the failure', () => {
    expect(errorSignature('String to replace not found in file. String: "const foo = 1;"')).toBe(
      errorSignature('String to replace not found in file. String: "let bar = 2;"'),
    );
  });

  it('refuses to merge genuinely different failures', () => {
    const timeout = errorSignature('Command timed out after 10m 0s');
    const auth = errorSignature('npm error 401 Unauthorized');
    const missing = errorSignature('File has not been read yet.');
    expect(new Set([timeout, auth, missing]).size).toBe(3);
  });

  it('survives empty and junk input without throwing', () => {
    expect(errorSignature('')).toBe('');
    expect(() => errorSignature('\u0000\u0001 ///// ')).not.toThrow();
  });
});

describe('getErrorSignatures over a match set', () => {
  let db: Database.Database;

  beforeAll(async () => {
    db = testDb(tmpDir('turnlog-errsig-'));
    await new Indexer(db, { projectsDir: copyCorpus() }).scanAll();
    // Two sessions hitting the same failure with different paths, plus one
    // unrelated failure — the shape this feature exists to reveal.
    const ids = db
      .prepare(`SELECT id FROM sessions WHERE parent_session_id IS NULL LIMIT 2`)
      .all() as { id: string }[];
    const ins = db.prepare(
      `INSERT INTO messages (uuid, session_id, idx, kind, is_error, is_sidechain, ts, text, raw_json,
                             tokens_in, tokens_out, cache_read_tokens, cache_write_tokens)
       VALUES (?, ?, ?, 'tool_result', 1, 0, ?, ?, '{}', 0, 0, 0, 0)`,
    );
    // FTS is an external-content table: a row inserted straight into
    // messages is invisible to MATCH until it is mirrored, and the
    // query-scoped case below is exactly what that would break.
    const insFts = db.prepare(`INSERT INTO messages_fts (rowid, text) VALUES (?, ?)`);
    const add = (uuid: string, sessionId: string, idx: number, ts: string, text: string) => {
      const info = ins.run(uuid, sessionId, idx, ts, text);
      insFts.run(info.lastInsertRowid, text);
    };
    add('e1', ids[0]!.id, 9001, '2026-08-01T10:00:00.000Z', 'ENOENT: no such file /a/b/one.ts');
    add('e2', ids[1]!.id, 9002, '2026-08-02T10:00:00.000Z', 'ENOENT: no such file /c/d/two.ts');
    add('e3', ids[0]!.id, 9003, '2026-08-03T10:00:00.000Z', 'network unreachable');
  });

  it('ranks by how many sessions hit it, not by raw count', () => {
    const res = getErrorSignatures(db, {});
    const enoent = res.signatures.find((s) => s.signature.includes('ENOENT'))!;
    expect(enoent.sessions).toBe(2);
    expect(enoent.count).toBe(2);
    // The two-session failure outranks the one-session one.
    const network = res.signatures.findIndex((s) => s.signature.includes('network'));
    const enoentIdx = res.signatures.findIndex((s) => s.signature.includes('ENOENT'));
    expect(enoentIdx).toBeLessThan(network);
  });

  it('keeps a real sample and jump targets', () => {
    const res = getErrorSignatures(db, {});
    const enoent = res.signatures.find((s) => s.signature.includes('ENOENT'))!;
    // The sample is untouched text, not the placeholder form.
    expect(enoent.sample).toMatch(/one\.ts|two\.ts/);
    expect(enoent.where.length).toBe(2);
    expect(enoent.where[0]!.idx).toBeGreaterThan(0);
    expect(enoent.lastAt).toBe('2026-08-02T10:00:00.000Z');
  });

  it('narrows to the query, like every other search-derived view', () => {
    const scoped = getErrorSignatures(db, { query: 'unreachable' });
    expect(scoped.signatures.some((s) => s.signature.includes('network'))).toBe(true);
    expect(scoped.signatures.some((s) => s.signature.includes('ENOENT'))).toBe(false);
  });

  it('never throws on a malformed query', () => {
    expect(() => getErrorSignatures(db, { query: 'NEAR((' })).not.toThrow();
  });
});
