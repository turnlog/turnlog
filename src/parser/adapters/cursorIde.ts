import type { NormalizedRecord } from '../types.js';

/**
 * Adapter for Cursor IDE composers, extracted from the IDE's state.vscdb.
 *
 * A DB row is not a log line, so the extractor (src/indexer/cursorIde.ts)
 * rebuilds each composer as a stream of ENVELOPES — one per conversation
 * event, in conversation order — and this adapter normalizes one envelope at
 * a time, exactly like the line adapters. `raw` is the stringified envelope:
 * the original DB value rides inside `data`, minus a blocklist of context
 * caches the extractor strips (attached code chunks and the like — they are
 * IDE working state, not conversation, and would bloat the index; the
 * source-of-truth vscdb persists on disk regardless, unlike rotating logs).
 *
 * Two storage generations, both handled:
 *  - modern (`_v` ≥ 3): bubbles in separate `bubbleId:` keys; a bubble with
 *    `toolFormerData` holds the call AND its result — the extractor splits it
 *    into `bubble` + `bubble_result` envelopes so tool pairing works.
 *  - legacy: the whole conversation inline on composerData; text-only.
 *
 * Cost: composer `usageData` records what Cursor itself billed per model —
 * that recorded number is the cost (a `usage` envelope per model). Bubbles
 * deliberately carry NO model id even when one is present: Cursor's token
 * counts have no cache split, so pricing-table math would overprice — and a
 * model on token-bearing rows would make computeCost() do exactly that.
 */

export interface CursorIdeEnvelope {
  source: 'cursor-ide';
  t: 'composer' | 'bubble' | 'bubble_result' | 'usage' | 'legacy';
  composerId: string;
  bubbleId?: string;
  /** Workspace folder path, resolved from workspaceStorage — composer only. */
  cwd?: string;
  /** usage envelopes: the model this usageData entry is keyed by. */
  model?: string;
  data: unknown;
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function msToIso(ms: unknown): string | null {
  return typeof ms === 'number' && Number.isFinite(ms) && ms > 0
    ? new Date(ms).toISOString()
    : null;
}

const EDIT_TOOLS: Record<string, 'edit' | 'write'> = {
  edit_file: 'edit',
  search_replace: 'edit',
  write: 'write',
  create_file: 'write',
};

function bubbleThinking(data: any): string {
  const own = str(data?.thinking?.text) ?? str(data?.thinking);
  if (own) return own;
  const blocks = Array.isArray(data?.allThinkingBlocks) ? data.allThinkingBlocks : [];
  return blocks
    .map((b: any) => str(b?.text) ?? '')
    .filter(Boolean)
    .join('\n');
}

export function normalizeCursorIde(
  env: CursorIdeEnvelope,
  raw: string,
  fallbackId: string,
): NormalizedRecord {
  const rec: NormalizedRecord = {
    uuid: fallbackId,
    parentUuid: null,
    kind: 'unknown',
    role: null,
    ts: null,
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
    cwd: env.cwd ?? null,
    filesTouched: [],
    raw,
  };
  const data: any = env.data;

  switch (env.t) {
    case 'composer': {
      rec.kind = 'meta';
      rec.subtype = 'composer';
      rec.ts = msToIso(data?.createdAt);
      // The name is CC-title-equivalent; the indexer lifts it onto the
      // session row. Searchable here like title records are.
      rec.text = str(data?.name) ?? '';
      return rec;
    }

    case 'usage': {
      rec.kind = 'meta';
      rec.subtype = 'usage';
      rec.model = env.model ?? null;
      rec.ts = msToIso(data?.lastUpdatedAt);
      const cents = num(data?.costInCents);
      rec.costUsd = cents > 0 ? cents / 100 : null;
      return rec;
    }

    case 'bubble':
    case 'legacy': {
      if (env.bubbleId) rec.uuid = env.bubbleId;
      const type = data?.type;
      if (type === 1) {
        rec.kind = 'prompt';
        rec.role = 'user';
        rec.text = str(data?.text) ?? '';
        return rec;
      }
      if (type === 2) {
        rec.role = 'assistant';
        const tc = data?.tokenCount;
        if (tc && typeof tc === 'object') {
          rec.tokensIn = num(tc.inputTokens);
          rec.tokensOut = num(tc.outputTokens);
        }
        const tf = data?.toolFormerData;
        if (tf && typeof tf === 'object') {
          rec.kind = 'tool_use';
          rec.toolName = str(tf.name) ?? (tf.tool != null ? `tool:${tf.tool}` : null);
          rec.toolUseId = str(tf.toolCallId) ?? rec.uuid;
          rec.text = str(tf.rawArgs) ?? str(tf.params) ?? '';
          const changeKind = EDIT_TOOLS[str(tf.name) ?? ''];
          if (changeKind) {
            try {
              const params = JSON.parse(str(tf.params) ?? '{}');
              const p = str(params?.relativeWorkspacePath) ?? str(params?.file_path);
              if (p) rec.filesTouched.push({ path: p, changeKind });
            } catch {
              /* params unreadable — the touch is lost, the record is not */
            }
          }
          return rec;
        }
        rec.kind = 'assistant';
        rec.text = str(data?.text) ?? '';
        if (rec.text === '') rec.text = bubbleThinking(data);
        return rec;
      }
      // A bubble type this adapter does not know — preserved.
      return rec;
    }

    case 'bubble_result': {
      // The result half of a toolFormerData bubble, split out by the
      // extractor so tool_use/tool_result pairing works like every agent's.
      if (env.bubbleId) rec.uuid = `${env.bubbleId}/result`;
      rec.kind = 'tool_result';
      const tf: any = data?.toolFormerData ?? {};
      rec.toolUseId = str(tf.toolCallId) ?? env.bubbleId ?? null;
      rec.text = str(tf.result) ?? '';
      const status = str(tf.status);
      rec.isError = status !== null && /error|fail/i.test(status);
      return rec;
    }

    default:
      return rec;
  }
}
