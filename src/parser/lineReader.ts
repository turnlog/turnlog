import fs from 'node:fs';

export interface LineChunk {
  text: string;
  /** Byte offset of the first byte of this line. */
  start: number;
  /** Byte offset just past this line's newline (= next line's start). */
  end: number;
  /**
   * False for a trailing line with no terminating newline — possibly a
   * mid-write partial. The caller decides whether to consume it.
   */
  complete: boolean;
}

/**
 * Stream a file line by line, tracking byte offsets so indexing can resume
 * exactly where it left off. Never loads the whole file — session files run
 * to hundreds of MB. Splits on \n (0x0A), which is safe inside UTF-8.
 */
export async function* readLines(
  filePath: string,
  startOffset = 0,
  highWaterMark?: number,
): AsyncGenerator<LineChunk> {
  const stream = fs.createReadStream(filePath, {
    start: startOffset,
    ...(highWaterMark ? { highWaterMark } : {}),
  });
  let buf: Buffer = Buffer.alloc(0);
  let offset = startOffset;

  for await (const chunk of stream) {
    buf = buf.length === 0 ? (chunk as Buffer) : Buffer.concat([buf, chunk as Buffer]);
    let nl: number;
    while ((nl = buf.indexOf(0x0a)) !== -1) {
      let lineBuf = buf.subarray(0, nl);
      const start = offset;
      const end = offset + nl + 1;
      offset = end;
      buf = buf.subarray(nl + 1);
      if (lineBuf.length > 0 && lineBuf[lineBuf.length - 1] === 0x0d) {
        lineBuf = lineBuf.subarray(0, -1);
      }
      yield { text: lineBuf.toString('utf8'), start, end, complete: true };
    }
  }

  if (buf.length > 0) {
    yield { text: buf.toString('utf8'), start: offset, end: offset + buf.length, complete: false };
  }
}
