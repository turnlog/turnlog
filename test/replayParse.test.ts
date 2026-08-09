import { describe, expect, it } from 'vitest';
import { parseRaw } from '../web/src/replay/raw.js';
import type { MessageRow } from '../src/server/apiTypes.js';

/**
 * The replay's re-parser reads every agent's records, not just Claude
 * Code's. It sniffs the writer from the record's own shape — the same
 * posture the server-side parser takes — so a record renders correctly
 * wherever it is shown, and an unrecognized shape still degrades to the
 * indexed plain text rather than throwing.
 *
 * Shapes below are taken from real logs (Codex 0.146, Cursor 1.x).
 */

let n = 0;
function row(raw: unknown, text = ''): MessageRow {
  n += 1;
  return { uuid: `rp-${n}`, text, raw: JSON.stringify(raw) } as MessageRow;
}

describe('codex records', () => {
  it('reads an agent message as text', () => {
    const v = parseRaw(
      row({
        timestamp: '2026-08-01T10:00:00Z',
        type: 'event_msg',
        payload: { type: 'agent_message', message: 'Reconnect looks correct.' },
      }),
    );
    expect(v.textParts).toEqual(['Reconnect looks correct.']);
  });

  it('reads reasoning as a thinking block', () => {
    const v = parseRaw(
      row({
        timestamp: '2026-08-01T10:00:01Z',
        type: 'response_item',
        payload: {
          type: 'reasoning',
          summary: [{ type: 'summary_text', text: 'Grep first, then read the hook.' }],
        },
      }),
    );
    expect(v.thinkingParts).toEqual(['Grep first, then read the hook.']);
    expect(v.textParts).toEqual([]);
  });

  it('keeps an exec call as code, not as escaped JSON', () => {
    const code = 'const r = await tools.exec_command({"cmd":"npm test"});';
    const v = parseRaw(
      row({
        timestamp: '2026-08-01T10:00:02Z',
        type: 'response_item',
        payload: { type: 'custom_tool_call', name: 'exec', call_id: 'call_1', input: code },
      }),
    );
    expect(v.toolUses[0]).toMatchObject({ id: 'call_1', name: 'exec', body: code });
    expect(v.toolUses[0]!.input).toEqual({});
  });

  it('parses JSON arguments into structured input', () => {
    const v = parseRaw(
      row({
        timestamp: '2026-08-01T10:00:03Z',
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'read_file',
          call_id: 'call_2',
          arguments: '{"path":"src/app.ts","limit":40}',
        },
      }),
    );
    expect(v.toolUses[0]!.input).toEqual({ path: 'src/app.ts', limit: 40 });
    expect(v.toolUses[0]!.body).toBeUndefined();
  });

  it('reads tool output in all three shapes real rollouts use', () => {
    const asBlocks = parseRaw(
      row({
        timestamp: '2026-08-01T10:00:04Z',
        type: 'response_item',
        payload: {
          type: 'custom_tool_call_output',
          call_id: 'call_3',
          // The common one — and the one that used to yield nothing.
          output: [
            { type: 'input_text', text: 'Script completed' },
            { type: 'input_text', text: '75b809e groundwork' },
          ],
        },
      }),
    );
    expect(asBlocks.toolResults[0]!.text).toBe('Script completed\n75b809e groundwork');
    expect(asBlocks.toolResults[0]!.toolUseId).toBe('call_3');

    const asString = parseRaw(
      row({
        timestamp: '2026-08-01T10:00:05Z',
        type: 'response_item',
        payload: { type: 'custom_tool_call_output', call_id: 'c', output: 'plain output' },
      }),
    );
    expect(asString.toolResults[0]!.text).toBe('plain output');

    const asObject = parseRaw(
      row({
        timestamp: '2026-08-01T10:00:06Z',
        type: 'response_item',
        payload: {
          type: 'custom_tool_call_output',
          call_id: 'c',
          output: { output: '1 failing', success: false },
        },
      }),
    );
    expect(asObject.toolResults[0]!.text).toBe('1 failing');
    expect(asObject.toolResults[0]!.isError).toBe(true);
  });

  it('draws nothing for bookkeeping records', () => {
    const v = parseRaw(
      row({
        timestamp: '2026-08-01T10:00:07Z',
        type: 'event_msg',
        payload: { type: 'token_count', info: {} },
      }),
    );
    expect(v.textParts.concat(v.thinkingParts)).toEqual([]);
    expect(v.toolUses).toEqual([]);
  });
});

describe('cursor IDE envelopes', () => {
  it('reads a tool call with its real arguments', () => {
    const v = parseRaw(
      row({
        source: 'cursor-ide',
        t: 'bubble',
        composerId: 'c1',
        bubbleId: 'b1',
        data: {
          type: 2,
          text: '',
          toolFormerData: {
            name: 'grep_search',
            toolCallId: 'call_x',
            rawArgs: '{"query":".utilities","include_pattern":"*.scss"}',
          },
        },
      }),
    );
    expect(v.toolUses[0]).toMatchObject({ id: 'call_x', name: 'grep_search' });
    expect(v.toolUses[0]!.input).toEqual({ query: '.utilities', include_pattern: '*.scss' });
  });

  it('pairs a split-out result back to its call', () => {
    const v = parseRaw(
      row({
        source: 'cursor-ide',
        t: 'bubble_result',
        composerId: 'c1',
        bubbleId: 'b1',
        data: {
          toolFormerData: { toolCallId: 'call_x', status: 'completed', result: '{"hits":3}' },
        },
      }),
    );
    expect(v.toolResults[0]).toMatchObject({ toolUseId: 'call_x', text: '{"hits":3}' });
    expect(v.toolResults[0]!.isError).toBe(false);
  });

  it('flags a failed tool result', () => {
    const v = parseRaw(
      row({
        source: 'cursor-ide',
        t: 'bubble_result',
        composerId: 'c1',
        data: { toolFormerData: { toolCallId: 'y', status: 'error', result: 'nope' } },
      }),
    );
    expect(v.toolResults[0]!.isError).toBe(true);
  });

  it('reads an assistant bubble and its thinking blocks', () => {
    const v = parseRaw(
      row({
        source: 'cursor-ide',
        t: 'bubble',
        composerId: 'c1',
        data: {
          type: 2,
          text: 'Backoff now caps at 30s.',
          allThinkingBlocks: [{ text: 'The heartbeat resets it.' }],
        },
      }),
    );
    expect(v.textParts).toEqual(['Backoff now caps at 30s.']);
    expect(v.thinkingParts).toEqual(['The heartbeat resets it.']);
  });
});

describe('the sniffer', () => {
  it('still reads Claude Code records — and Cursor CLI, which shares the shape', () => {
    const v = parseRaw(
      row({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'On it.' },
            { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/a/b.ts' } },
          ],
        },
      }),
    );
    expect(v.textParts).toEqual(['On it.']);
    expect(v.toolUses[0]).toMatchObject({ id: 't1', name: 'Read' });
  });

  it('falls back to the indexed text for a shape it does not know', () => {
    const v = parseRaw(row({ some: 'future format' }, 'the indexed text'));
    expect(v.textParts).toEqual(['the indexed text']);
  });

  it('never throws on malformed records', () => {
    expect(() => parseRaw(row(null, 'x'))).not.toThrow();
    expect(() => parseRaw({ uuid: 'bad', raw: '{not json', text: 'y' } as MessageRow)).not.toThrow();
    expect(() =>
      parseRaw(row({ source: 'cursor-ide', t: 'bubble', data: null })),
    ).not.toThrow();
    expect(() => parseRaw(row({ type: 'x', payload: { type: 'reasoning' } }))).not.toThrow();
  });
});
