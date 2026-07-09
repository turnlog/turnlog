import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { readLines } from '../src/parser/lineReader.js';
import { normalizeLine } from '../src/parser/normalize.js';
import type { NormalizedRecord } from '../src/parser/types.js';
import { CORPUS_DIR, GOLDEN_DIR, SESSION_A, corpusFiles } from './helpers.js';

const UPDATE = process.env.UPDATE_GOLDEN === '1';

async function normalizeFile(file: string): Promise<NormalizedRecord[]> {
  const sessionId = path.basename(file, '.jsonl');
  const records: NormalizedRecord[] = [];
  let lineNo = 0;
  for await (const chunk of readLines(file)) {
    const rec = normalizeLine(chunk.text, `${sessionId}:${lineNo}`);
    lineNo += 1;
    if (rec) records.push(rec);
  }
  return records;
}

function goldenPath(file: string): string {
  // Full corpus-relative path in the key — subagent files would otherwise all
  // collapse to a "subagents__" prefix. Flat files keep their existing names.
  const rel = path.relative(CORPUS_DIR, file).replace(/\.jsonl$/, '');
  return path.join(GOLDEN_DIR, `${rel.split(path.sep).join('__')}.json`);
}

describe('adapter golden snapshots', () => {
  // Raw corpus in, normalized records out — committed golden files make every
  // adapter change diff-reviewable. Regenerate with: npm run golden:update
  for (const file of corpusFiles()) {
    it(`normalizes ${path.relative(CORPUS_DIR, file)}`, async () => {
      const records = await normalizeFile(file);
      const golden = goldenPath(file);
      if (UPDATE) {
        fs.mkdirSync(GOLDEN_DIR, { recursive: true });
        fs.writeFileSync(golden, JSON.stringify(records, null, 2) + '\n');
        return;
      }
      const expected = JSON.parse(fs.readFileSync(golden, 'utf8'));
      expect(records).toEqual(expected);
    });
  }
});

describe('adapter behavior', () => {
  const sessionAFile = path.join(
    CORPUS_DIR,
    '-Users-dev-projects-webapp',
    `${SESSION_A}.jsonl`,
  );

  it('never crashes, never drops: every non-blank line becomes a record', async () => {
    const records = await normalizeFile(sessionAFile);
    expect(records).toHaveLength(16); // 17 lines, one blank
  });

  it('classifies record kinds', async () => {
    const records = await normalizeFile(sessionAFile);
    const byUuid = new Map(records.map((r) => [r.uuid, r]));
    expect(byUuid.get('u1')?.kind).toBe('prompt');
    expect(byUuid.get('a1')?.kind).toBe('assistant');
    expect(byUuid.get('a2')?.kind).toBe('tool_use');
    expect(byUuid.get('u2')?.kind).toBe('tool_result');
    expect(byUuid.get('sys1')?.kind).toBe('system');
    expect(records[0]!.kind).toBe('summary');
  });

  it('stores unrecognized record types as unknown with raw preserved', async () => {
    const records = await normalizeFile(sessionAFile);
    const unknowns = records.filter((r) => r.kind === 'unknown');
    // queue-operation, ai-title, and the malformed JSON line
    expect(unknowns).toHaveLength(3);
    for (const rec of unknowns) expect(rec.raw.length).toBeGreaterThan(0);
    const malformed = unknowns.find((r) => r.uuid.startsWith(`${SESSION_A}:`));
    expect(malformed?.raw).toContain('"assist');
  });

  it('pairs tool_use with tool_result via toolUseId', async () => {
    const records = await normalizeFile(sessionAFile);
    const use = records.find((r) => r.uuid === 'a2');
    const result = records.find((r) => r.uuid === 'u2');
    expect(use?.toolUseId).toBe('toolu_01');
    expect(result?.toolUseId).toBe('toolu_01');
    expect(use?.toolName).toBe('Read');
  });

  it('extracts files touched from Edit and Write tools', async () => {
    const records = await normalizeFile(sessionAFile);
    const touches = records.flatMap((r) => r.filesTouched);
    expect(touches).toEqual([
      { path: '/Users/dev/projects/webapp/src/hooks/useWebSocket.ts', changeKind: 'edit' },
      { path: '/Users/dev/projects/webapp/src/hooks/reconnect.ts', changeKind: 'write' },
    ]);
  });

  it('flags sidechain records', async () => {
    const records = await normalizeFile(sessionAFile);
    expect(records.filter((r) => r.isSidechain).map((r) => r.uuid)).toEqual(['s1', 's2']);
  });

  it('extracts the API message id from assistant records', async () => {
    const records = await normalizeFile(sessionAFile);
    expect(records.find((r) => r.uuid === 'a1')?.messageId).toBe('msg_01A');
    expect(records.find((r) => r.uuid === 'u1')?.messageId).toBeNull();
  });

  it('extracts usage including the cache-write TTL breakdown', async () => {
    const records = await normalizeFile(sessionAFile);
    const a3 = records.find((r) => r.uuid === 'a3');
    expect(a3).toMatchObject({
      tokensIn: 80,
      tokensOut: 95,
      cacheReadTokens: 5600,
      cacheWriteTokens: 150,
      cacheWrite1hTokens: 150,
      model: 'claude-opus-4-8',
    });
  });

  it('makes searchable text out of tool inputs and results', async () => {
    const records = await normalizeFile(sessionAFile);
    const toolResult = records.find((r) => r.uuid === 'u2');
    expect(toolResult?.text).toContain('session_id');
    const edit = records.find((r) => r.uuid === 'a3');
    expect(edit?.text).toContain('scheduleReconnect');
  });
});
