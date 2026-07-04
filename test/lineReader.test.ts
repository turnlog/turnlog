import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { readLines, type LineChunk } from '../src/parser/lineReader.js';
import { tmpDir } from './helpers.js';

async function collect(file: string, start = 0, hwm?: number): Promise<LineChunk[]> {
  const out: LineChunk[] = [];
  for await (const chunk of readLines(file, start, hwm)) out.push(chunk);
  return out;
}

function write(content: string): string {
  const file = path.join(tmpDir('turnlog-lr-'), 'f.jsonl');
  fs.writeFileSync(file, content);
  return file;
}

describe('readLines', () => {
  it('tracks byte offsets per line', async () => {
    const file = write('a\nbb\nccc\n');
    const chunks = await collect(file);
    expect(chunks.map((c) => c.text)).toEqual(['a', 'bb', 'ccc']);
    expect(chunks.map((c) => [c.start, c.end])).toEqual([
      [0, 2],
      [2, 5],
      [5, 9],
    ]);
    expect(chunks.every((c) => c.complete)).toBe(true);
  });

  it('resumes from a stored offset', async () => {
    const file = write('a\nbb\nccc\n');
    const chunks = await collect(file, 2);
    expect(chunks.map((c) => c.text)).toEqual(['bb', 'ccc']);
    expect(chunks[0]!.start).toBe(2);
  });

  it('marks a trailing line without newline as incomplete', async () => {
    const file = write('a\nbb');
    const chunks = await collect(file);
    expect(chunks).toHaveLength(2);
    expect(chunks[1]).toMatchObject({ text: 'bb', complete: false, start: 2, end: 4 });
  });

  it('strips CR but counts it in offsets', async () => {
    const file = write('a\r\nb\r\n');
    const chunks = await collect(file);
    expect(chunks.map((c) => c.text)).toEqual(['a', 'b']);
    expect(chunks.map((c) => [c.start, c.end])).toEqual([
      [0, 3],
      [3, 6],
    ]);
  });

  it('handles multi-byte UTF-8 split across stream chunks', async () => {
    const file = write('🎉🎉\nx\n');
    const chunks = await collect(file, 0, 3); // 3-byte chunks split the emoji
    expect(chunks.map((c) => c.text)).toEqual(['🎉🎉', 'x']);
    expect(chunks[0]!.end).toBe(9); // two 4-byte emoji + newline
  });

  it('yields nothing for an empty file', async () => {
    const file = write('');
    expect(await collect(file)).toEqual([]);
  });
});
