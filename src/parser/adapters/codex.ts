import type { NormalizedRecord } from '../types.js';

/**
 * Adapter for OpenAI Codex rollout files (`~/.codex/sessions/YYYY/MM/DD/
 * rollout-*.jsonl`), as observed through Codex 0.146. Every line is an
 * `{timestamp, type, payload}` envelope. Same cardinal rule as the CC
 * adapter: never crash, never drop — anything unrecognized lands as
 * kind 'unknown' with the raw line preserved.
 *
 * Two format landmines this mapping is built around (see roadmap Phase 5):
 *
 *  1. Conversation text rides TWO channels. `event_msg` user/agent messages
 *     are exactly what was typed/answered — they become 'prompt'/'assistant'
 *     (turn boundaries key off 'prompt'). `response_item` messages are the
 *     model-facing copies: user-role ones carry unique injected context
 *     (environment, instructions) and stay searchable as 'meta'; assistant-
 *     role ones are pure duplicates and keep empty search text.
 *
 *  2. `token_count` events carry BOTH cumulative totals and
 *     `last_token_usage` (the response that just finished). Rows take
 *     last_token_usage, so summing rows is correct by construction — no
 *     cross-line state, and incremental passes can't double-count.
 *     OpenAI's `input_tokens` includes the cached share; Turnlog's columns
 *     split them (tokensIn = uncached input).
 */

/** Cross-line context: the session's cwd and the model currently in force. */
export interface CodexParseState {
  cwd: string | null;
  model: string | null;
}

export function newCodexState(): CodexParseState {
  return { cwd: null, model: null };
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/** response_item message content: [{type: 'input_text'|'output_text', text}]. */
function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((b) => {
      const rec = asRecord(b);
      return rec ? (str(rec.text) ?? '') : '';
    })
    .filter(Boolean)
    .join('\n');
}

export function normalizeCodex(
  obj: any,
  raw: string,
  fallbackId: string,
  state: CodexParseState,
): NormalizedRecord {
  const rec: NormalizedRecord = {
    uuid: fallbackId,
    parentUuid: null,
    kind: 'unknown',
    role: null,
    ts: str(obj?.timestamp),
    isSidechain: false,
    toolName: null,
    toolUseId: null,
    isError: false,
    model: null,
    messageId: null,
    subtype: null,
    text: '',
    tokensIn: 0,
    tokensOut: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cacheWrite1hTokens: 0,
    costUsd: null,
    cwd: state.cwd,
    filesTouched: [],
    raw,
  };

  const payload = asRecord(obj?.payload);

  switch (obj?.type) {
    case 'session_meta': {
      rec.kind = 'meta';
      rec.subtype = 'session_meta';
      state.cwd = str(payload?.cwd) ?? state.cwd;
      rec.cwd = state.cwd;
      // The giant base_instructions blob would pollute search — raw keeps it.
      return rec;
    }

    case 'turn_context': {
      rec.kind = 'meta';
      rec.subtype = 'turn_context';
      state.model = str(payload?.model) ?? state.model;
      state.cwd = str(payload?.cwd) ?? state.cwd;
      rec.model = state.model;
      rec.cwd = state.cwd;
      return rec;
    }

    case 'event_msg': {
      const t = str(payload?.type);
      rec.subtype = t;
      switch (t) {
        case 'user_message':
          rec.kind = 'prompt';
          rec.role = 'user';
          rec.text = str(payload?.message) ?? str(payload?.text) ?? '';
          return rec;
        case 'agent_message':
          rec.kind = 'assistant';
          rec.role = 'assistant';
          rec.model = state.model;
          rec.text = str(payload?.message) ?? str(payload?.text) ?? '';
          return rec;
        case 'token_count': {
          rec.kind = 'meta';
          const info = asRecord(payload?.info);
          const last = asRecord(info?.last_token_usage);
          if (last) {
            const input = num(last.input_tokens);
            const cached = num(last.cached_input_tokens);
            rec.tokensIn = Math.max(0, input - cached);
            rec.cacheReadTokens = cached;
            rec.cacheWriteTokens = num(last.cache_write_input_tokens);
            rec.tokensOut = num(last.output_tokens);
            rec.model = state.model;
          }
          return rec;
        }
        default:
          // task_started/task_complete/thread_settings_applied/… — quiet
          // bookkeeping, kept raw and countable by subtype.
          rec.kind = 'meta';
          return rec;
      }
    }

    case 'response_item': {
      const t = str(payload?.type);
      rec.subtype = t;
      switch (t) {
        case 'message': {
          // The model-facing copy of the conversation (landmine #1).
          rec.kind = 'meta';
          rec.role = str(payload?.role);
          if (rec.role === 'user') rec.text = contentText(payload?.content);
          return rec;
        }
        case 'reasoning': {
          rec.kind = 'assistant';
          rec.role = 'assistant';
          rec.model = state.model;
          const summary = Array.isArray(payload?.summary) ? payload.summary : [];
          rec.text = summary
            .map((s: unknown) => str(asRecord(s)?.text) ?? '')
            .filter(Boolean)
            .join('\n');
          return rec;
        }
        case 'custom_tool_call':
        case 'function_call':
        case 'local_shell_call': {
          rec.kind = 'tool_use';
          rec.toolName = str(payload?.name) ?? t;
          rec.toolUseId = str(payload?.call_id) ?? str(payload?.id);
          rec.text = str(payload?.input) ?? str(payload?.arguments) ?? '';
          return rec;
        }
        case 'custom_tool_call_output':
        case 'function_call_output': {
          rec.kind = 'tool_result';
          rec.toolUseId = str(payload?.call_id);
          const output = payload?.output;
          if (typeof output === 'string') {
            rec.text = output;
          } else {
            const out = asRecord(output);
            rec.text = str(out?.output) ?? str(out?.content) ?? '';
            if (out?.success === false) rec.isError = true;
          }
          return rec;
        }
        default:
          return rec; // unknown response item — stored, never dropped
      }
    }

    default:
      // world_state and whatever the next Codex release invents.
      return rec;
  }
}
