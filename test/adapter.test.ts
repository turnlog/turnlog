import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { readLines } from '../src/parser/lineReader.js';
import {
  normalizeCodexLine,
  normalizeCursorCliLine,
  normalizeCursorIdeEnvelope,
  normalizeLine,
} from '../src/parser/normalize.js';
import { newCodexState } from '../src/parser/adapters/codex.js';
import type { NormalizedRecord } from '../src/parser/types.js';
import {
  CODEX_CORPUS_DIR,
  CORPUS_DIR,
  CURSOR_CLI_CORPUS_DIR,
  CURSOR_SESSION,
  GOLDEN_DIR,
  ROOT,
  SESSION_A,
  codexCorpusFiles,
  corpusFiles,
  cursorCliCorpusFiles,
} from './helpers.js';

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

async function normalizeCodexFile(file: string): Promise<NormalizedRecord[]> {
  const sessionId = path.basename(file, '.jsonl');
  const records: NormalizedRecord[] = [];
  const state = newCodexState();
  let lineNo = 0;
  for await (const chunk of readLines(file)) {
    const rec = normalizeCodexLine(chunk.text, `${sessionId}:${lineNo}`, state);
    lineNo += 1;
    if (rec) records.push(rec);
  }
  return records;
}

function codexGoldenPath(file: string): string {
  const rel = path.relative(CODEX_CORPUS_DIR, file).replace(/\.jsonl$/, '');
  return path.join(GOLDEN_DIR, `codex__${rel.split(path.sep).join('__')}.json`);
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

describe('codex adapter golden snapshots', () => {
  for (const file of codexCorpusFiles()) {
    it(`normalizes ${path.relative(CODEX_CORPUS_DIR, file)}`, async () => {
      const records = await normalizeCodexFile(file);
      const golden = codexGoldenPath(file);
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

async function normalizeCursorCliFile(file: string): Promise<NormalizedRecord[]> {
  const sessionId = path.basename(file, '.jsonl');
  const records: NormalizedRecord[] = [];
  let lineNo = 0;
  for await (const chunk of readLines(file)) {
    const rec = normalizeCursorCliLine(chunk.text, `${sessionId}:${lineNo}`);
    lineNo += 1;
    if (rec) records.push(rec);
  }
  return records;
}

function cursorCliGoldenPath(file: string): string {
  const rel = path.relative(CURSOR_CLI_CORPUS_DIR, file).replace(/\.jsonl$/, '');
  return path.join(GOLDEN_DIR, `cursor-cli__${rel.split(path.sep).join('__')}.json`);
}

describe('cursor cli adapter golden snapshots', () => {
  for (const file of cursorCliCorpusFiles()) {
    it(`normalizes ${path.relative(CURSOR_CLI_CORPUS_DIR, file)}`, async () => {
      const records = await normalizeCursorCliFile(file);
      const golden = cursorCliGoldenPath(file);
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

describe('cursor ide adapter golden snapshots', () => {
  // Envelope corpus in, normalized records out — same diff-reviewable golden
  // contract as the line adapters; the extractor's own DB→envelope step is
  // covered in cursorIde.test.ts.
  const envelopesFile = path.join(ROOT, 'fixtures', 'cursor-ide', 'envelopes.jsonl');

  it('normalizes cursor-ide envelopes', () => {
    const lines = fs.readFileSync(envelopesFile, 'utf8').split('\n').filter(Boolean);
    const records = lines.map((line, i) =>
      normalizeCursorIdeEnvelope(JSON.parse(line), `envelope:${i}`),
    );
    const golden = path.join(GOLDEN_DIR, 'cursor-ide__envelopes.json');
    if (UPDATE) {
      fs.mkdirSync(GOLDEN_DIR, { recursive: true });
      fs.writeFileSync(golden, JSON.stringify(records, null, 2) + '\n');
      return;
    }
    const expected = JSON.parse(fs.readFileSync(golden, 'utf8'));
    expect(records).toEqual(expected);
  });
});

describe('cursor cli adapter behavior', () => {
  const transcript = path.join(
    CURSOR_CLI_CORPUS_DIR,
    'Users-dev-projects-webapp',
    'agent-transcripts',
    CURSOR_SESSION,
    `${CURSOR_SESSION}.jsonl`,
  );

  it('classifies prompts, tool pairs, and preserves the unknown tail', async () => {
    const records = await normalizeCursorCliFile(transcript);
    expect(records.filter((r) => r.kind === 'prompt')).toHaveLength(2);
    const use = records.find((r) => r.toolUseId === 'cur_tool_02' && r.kind === 'tool_use');
    const result = records.find((r) => r.toolUseId === 'cur_tool_02' && r.kind === 'tool_result');
    expect(use?.toolName).toBe('edit_file');
    expect(result).toBeDefined();
    // The roleless settings line and the malformed line both survive as unknown.
    expect(records.filter((r) => r.kind === 'unknown')).toHaveLength(2);
  });

  it('strips <user_query> wrappers but keeps the words searchable', async () => {
    const records = await normalizeCursorCliFile(transcript);
    const first = records.find((r) => r.kind === 'prompt');
    expect(first?.text).toContain('reconnect backoff');
    expect(first?.text).not.toContain('<user_query>');
  });

  it('extracts file touches from edit-shaped tools only', async () => {
    const records = await normalizeCursorCliFile(transcript);
    const touches = records.flatMap((r) => r.filesTouched);
    expect(touches).toEqual([
      { path: 'src/hooks/useWebSocket.ts', changeKind: 'edit' },
    ]);
  });

  it('carries no invented timestamps, models, or usage', async () => {
    const records = await normalizeCursorCliFile(transcript);
    for (const r of records) {
      expect(r.ts).toBeNull();
      expect(r.model).toBeNull();
      expect(r.tokensIn + r.tokensOut).toBe(0);
    }
  });
});

describe('adapter behavior', () => {
  const sessionAFile = path.join(
    CORPUS_DIR,
    '-Users-dev-projects-webapp',
    `${SESSION_A}.jsonl`,
  );

  it('never crashes, never drops: every non-blank line becomes a record', async () => {
    const records = await normalizeFile(sessionAFile);
    expect(records).toHaveLength(23); // 24 lines, one blank
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
    // queue-operation (deliberately unadapted) and the malformed JSON line
    expect(unknowns).toHaveLength(2);
    for (const rec of unknowns) expect(rec.raw.length).toBeGreaterThan(0);
    const malformed = unknowns.find((r) => r.raw.includes('"assist'));
    expect(malformed?.uuid.startsWith(`${SESSION_A}:`)).toBe(true);
  });

  it('normalizes CC titles with their source in subtype', async () => {
    const records = await normalizeFile(sessionAFile);
    const titles = records.filter((r) => r.kind === 'title');
    expect(titles.map((r) => [r.subtype, r.text])).toEqual([
      ['ai', 'WebSocket reconnect fix'],
      ['custom', 'Reconnect surgery'],
    ]);
  });

  it('normalizes attachments: path-shaped subtypes searchable, bookkeeping silent', async () => {
    const records = await normalizeFile(sessionAFile);
    const attachments = records.filter((r) => r.kind === 'attachment');
    expect(attachments.map((r) => [r.subtype, r.text])).toEqual([
      ['file', '/Users/dev/projects/webapp/docs/websocket.md'],
      ['total_tokens_reminder', ''],
    ]);
  });

  it('normalizes mode and permission-mode records with the value in subtype', async () => {
    const records = await normalizeFile(sessionAFile);
    const modes = records.filter((r) => r.kind === 'mode');
    expect(modes.map((r) => r.subtype)).toEqual(['normal', 'default', 'auto']);
    // No timestamps, no uuids on these — fallback ids, empty search text.
    for (const m of modes) {
      expect(m.uuid.startsWith(`${SESSION_A}:`)).toBe(true);
      expect(m.text).toBe('');
    }
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
