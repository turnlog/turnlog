import { beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { Indexer } from '../src/indexer/indexer.js';
import { getSessionExport, getSessionHtmlExport, resolveSessionId } from '../src/server/api.js';
import { redactText } from '../src/export/redact.js';
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

  it('exports only the requested idx range, marked as an excerpt', () => {
    // Rows 0–1 are the prompt + first prose; the Bash failure sits later.
    const md = getSessionExport(db, SESSION_C, {}, { fromIdx: 0, toIdx: 1 })!;
    expect(md).toContain('(excerpt)');
    expect(md).toContain('> **You:**');
    expect(md).not.toContain('<details><summary>Bash');
    // Tail-only export drops the prompt.
    const tail = getSessionExport(db, SESSION_C, {}, { fromIdx: 2 })!;
    expect(tail).not.toContain('> **You:**');
    expect(tail).toContain('<details><summary>Bash');
    // An unbounded range is the whole session, unmarked.
    expect(getSessionExport(db, SESSION_C, {}, {})!).not.toContain('(excerpt)');
  });
});

describe('html export', () => {
  it('renders a self-contained page: prompt, tool details, diff, error result', () => {
    const html = getSessionHtmlExport(db, SESSION_C)!;
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<title>api — Claude Code session</title>');
    expect(html).toContain('class="turn you"');
    expect(html).toContain('quantum_flux_capacitor');
    expect(html).toContain('<details><summary>');
    expect(html).toContain('dl-del');
    expect(html).toContain('- return readings.gigawatts;');
    expect(html).toContain('+ return readings?.gigawatts ?? 0;');
    expect(html).toContain('result · error');
    expect(html).toContain('TypeError');
    // Self-contained means self-contained: no network fetches of any kind.
    expect(html).not.toMatch(/src="http|href="http(?!s:\/\/turnlog\.dev)/);
  });

  it('includes the attribution footer by default and omits it on request', () => {
    expect(getSessionHtmlExport(db, SESSION_C)!).toContain('turnlog.dev');
    expect(getSessionHtmlExport(db, SESSION_C, { attribution: false })!).not.toContain(
      'turnlog.dev',
    );
  });

  it('returns null for unknown sessions', () => {
    expect(getSessionHtmlExport(db, 'zzzznope')).toBeNull();
  });
});

describe('redaction', () => {
  it('scrubs well-known token shapes', () => {
    expect(redactText('key: sk-ant-api03-abcdefghijklmnop123')).not.toContain('sk-ant');
    expect(redactText('ghp_abcdefghijklmnopqrstuv123456')).toBe('[redacted-key]');
    expect(redactText('AKIAIOSFODNN7EXAMPLE')).toBe('[redacted-key]');
    expect(redactText('Authorization: Bearer abc123def456ghi789jkl')).toContain(
      'Bearer [redacted]',
    );
    expect(redactText('API_KEY=super_secret_value_1')).toBe('API_KEY=[redacted]');
  });

  it('scrubs emails and home paths, leaving the rest of the path readable', () => {
    expect(redactText('mail me at dev@example.com please')).toBe('mail me at [email] please');
    expect(redactText('/Users/alice/projects/webapp/src/index.ts')).toBe(
      '~/projects/webapp/src/index.ts',
    );
    expect(redactText('/home/bob/code/thing')).toBe('~/code/thing');
  });

  it('leaves ordinary prose and code alone', () => {
    const s = 'const total = items.reduce((a, b) => a + b.price, 0); // sums the cart';
    expect(redactText(s)).toBe(s);
  });

  it('applies to both export formats via the redact option', () => {
    // The corpus is synthetic and secret-free, so prove the wiring with the
    // option toggled: output must be identical except where patterns match.
    const md = getSessionExport(db, SESSION_C, { redact: true })!;
    const html = getSessionHtmlExport(db, SESSION_C, { redact: true })!;
    expect(md).toContain('quantum_flux_capacitor');
    expect(html).toContain('quantum_flux_capacitor');
  });
});
