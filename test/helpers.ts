import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/indexer/db.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CORPUS_DIR = path.join(ROOT, 'fixtures', 'corpus');
export const GOLDEN_DIR = path.join(ROOT, 'fixtures', 'golden');

export const SESSION_A = '11111111-1111-4111-8111-111111111111';
export const SESSION_B = '22222222-2222-4222-8222-222222222222';
export const SESSION_C = '33333333-3333-4333-8333-333333333333';
export const SESSION_EMPTY = '44444444-4444-4444-8444-444444444444';

export function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Copy the committed corpus into a scratch dir tests are free to mutate. */
export function copyCorpus(): string {
  const dest = tmpDir('turnlog-corpus-');
  fs.cpSync(CORPUS_DIR, dest, { recursive: true });
  return dest;
}

export function testDb(dir: string) {
  return openDb(path.join(dir, 'index.sqlite'));
}

export function corpusFiles(): string[] {
  const out: string[] = [];
  for (const project of fs.readdirSync(CORPUS_DIR)) {
    const dir = path.join(CORPUS_DIR, project);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const file of fs.readdirSync(dir)) {
      if (file.endsWith('.jsonl')) out.push(path.join(dir, file));
    }
  }
  return out.sort();
}
