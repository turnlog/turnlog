import { describe, expect, it } from 'vitest';
import { parseRaw } from '../web/src/replay/raw.js';
import type { MessageRow } from '../src/server/apiTypes.js';

/**
 * Inline images in the replay. The payloads are already in `raw_json` — the
 * only question is whether the tolerant re-parser finds them in every shape
 * real logs use, and refuses the ones that would be unsafe or absurd.
 * Shapes verified against real Claude Code logs 2026-08-06.
 */

/** Smallest valid PNG, base64 — starts with the real PNG magic prefix. */
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const JPEG = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBk=';

let n = 0;
function row(raw: unknown, text = ''): MessageRow {
  n += 1;
  return {
    uuid: `img-${n}`,
    parentUuid: null,
    idx: 0,
    role: 'user',
    kind: 'prompt',
    toolName: null,
    toolUseId: null,
    messageId: null,
    ts: null,
    isSidechain: false,
    isError: false,
    tokensIn: 0,
    tokensOut: 0,
    text,
    raw: JSON.stringify(raw),
  } as MessageRow;
}

describe('inline images in the replay', () => {
  it('finds a pasted image on the user channel', () => {
    const view = parseRaw(
      row({
        type: 'user',
        message: {
          content: [
            { type: 'text', text: 'why is this button misaligned?' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } },
          ],
        },
      }),
    );
    expect(view.textParts).toEqual(['why is this button misaligned?']);
    expect(view.images).toHaveLength(1);
    expect(view.images[0]!.src).toBe(`data:image/png;base64,${PNG}`);
    expect(view.images[0]!.bytes).toBeGreaterThan(0);
  });

  it('renders tool-result screenshots instead of announcing "[image]"', () => {
    const view = parseRaw(
      row({
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_9',
              content: [
                { type: 'text', text: 'Took the screenshot.' },
                { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } },
              ],
            },
          ],
        },
      }),
    );
    const result = view.toolResults[0]!;
    expect(result.text).toBe('Took the screenshot.');
    expect(result.text).not.toContain('[image]');
    expect(result.images).toHaveLength(1);
  });

  it('reads the file:{base64} variant too', () => {
    const view = parseRaw(
      row({
        type: 'user',
        message: { content: [{ type: 'image', file: { base64: JPEG } }] },
      }),
    );
    expect(view.images[0]!.src).toBe(`data:image/jpeg;base64,${JPEG}`);
  });

  it('sniffs the media type when the log omits it', () => {
    const view = parseRaw(
      row({ type: 'user', message: { content: [{ type: 'image', source: { data: PNG } }] } }),
    );
    expect(view.images[0]!.src.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('never trusts a non-image media type from the log', () => {
    // Logs are untrusted input: a declared text/html must not become the
    // media type of a data: URI. The payload's own magic prefix wins.
    const view = parseRaw(
      row({
        type: 'user',
        message: {
          content: [{ type: 'image', source: { media_type: 'text/html', data: PNG } }],
        },
      }),
    );
    expect(view.images[0]!.src.startsWith('data:image/png;base64,')).toBe(true);
    expect(view.images[0]!.src).not.toContain('text/html');
  });

  it('keeps unreadable payloads visible as text rather than dropping them', () => {
    const view = parseRaw(
      row({
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 't1',
              content: [{ type: 'image', source: { data: 'not-a-known-format' } }],
            },
          ],
        },
      }),
    );
    expect(view.toolResults[0]!.images).toHaveLength(0);
    expect(view.toolResults[0]!.text).toBe('[image]');
  });

  it('skips absurd payloads instead of stalling the scroller', () => {
    const huge = PNG + 'A'.repeat(16_000_001);
    const view = parseRaw(
      row({
        type: 'user',
        message: {
          content: [{ type: 'image', source: { media_type: 'image/png', data: huge } }],
        },
      }),
    );
    expect(view.images).toHaveLength(0);
  });

  it('finds images an attachment carried', () => {
    const view = parseRaw(
      row({
        type: 'attachment',
        attachment: {
          type: 'queued_command',
          prompt: [{ type: 'image', source: { media_type: 'image/png', data: PNG } }],
        },
      }),
    );
    expect(view.images).toHaveLength(1);
  });

  it('does not lose the plain-text fallback for rows with no images', () => {
    const view = parseRaw(row({ type: 'user', message: { content: [] } }, 'just words'));
    expect(view.textParts).toEqual(['just words']);
    expect(view.images).toEqual([]);
  });
});
