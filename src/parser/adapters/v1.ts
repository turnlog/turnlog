import type { FileTouch, NormalizedRecord } from '../types.js';

const EDIT_TOOLS: Record<string, FileTouch['changeKind']> = {
  Edit: 'edit',
  MultiEdit: 'edit',
  NotebookEdit: 'edit',
  Write: 'write',
};

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function blockToText(block: any): string {
  if (block == null || typeof block !== 'object') {
    return typeof block === 'string' ? block : '';
  }
  switch (block.type) {
    case 'text':
      return str(block.text) ?? '';
    case 'thinking':
      return str(block.thinking) ?? '';
    case 'tool_use':
      try {
        return block.input == null ? '' : JSON.stringify(block.input);
      } catch {
        return '';
      }
    case 'tool_result':
      return contentToText(block.content);
    default:
      return '';
  }
}

/** An attachment's path plus whatever body it carried; either may be absent. */
function pathAndBody(path: string | null, body: string | null): string {
  return [path, body].filter((s): s is string => s !== null && s !== '').join('\n');
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(blockToText).filter(Boolean).join('\n');
  }
  return '';
}

/**
 * Adapter for the Claude Code JSONL format as observed through CC 2.x.
 * Pure function: parsed object in, NormalizedRecord out. Must never throw on
 * weird shapes — anything unrecognized falls through as kind 'unknown'.
 */
export function normalizeV1(obj: any, raw: string, fallbackId: string): NormalizedRecord {
  const rec: NormalizedRecord = {
    uuid: str(obj?.uuid) ?? fallbackId,
    parentUuid: str(obj?.parentUuid),
    kind: 'unknown',
    role: null,
    ts: str(obj?.timestamp),
    isSidechain: obj?.isSidechain === true,
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
    speed: null,
    costUsd: typeof obj?.costUSD === 'number' ? obj.costUSD : null,
    cwd: str(obj?.cwd),
    gitBranch: str(obj?.gitBranch),
    command: null,
    filesTouched: [],
    raw,
  };

  switch (obj?.type) {
    case 'summary': {
      rec.kind = 'summary';
      rec.text = str(obj.summary) ?? '';
      const leaf = str(obj.leafUuid);
      if (rec.uuid === fallbackId && leaf) rec.uuid = `summary:${leaf}`;
      return rec;
    }

    case 'user': {
      const content = obj.message?.content;
      rec.role = 'user';
      rec.text = contentToText(content);
      if (Array.isArray(content)) {
        const toolResult = content.find((b: any) => b?.type === 'tool_result');
        if (toolResult) {
          rec.kind = 'tool_result';
          rec.toolUseId = str(toolResult.tool_use_id);
          rec.isError = toolResult.is_error === true;
          return rec;
        }
      }
      // isMeta marks injected context (caveats, image placeholders, command
      // wrappers CC adds on the user channel) — not something the user typed.
      // Kept searchable, but must not read as a prompt (turn boundaries,
      // prompts lens, export all key off kind 'prompt').
      rec.kind = obj.isMeta === true ? 'meta' : 'prompt';
      return rec;
    }

    case 'assistant': {
      const msg = obj.message ?? {};
      rec.role = 'assistant';
      rec.model = str(msg.model);
      rec.messageId = str(msg.id);
      const usage = msg.usage;
      if (usage && typeof usage === 'object') {
        rec.tokensIn = num(usage.input_tokens);
        rec.tokensOut = num(usage.output_tokens);
        rec.cacheReadTokens = num(usage.cache_read_input_tokens);
        rec.cacheWriteTokens = num(usage.cache_creation_input_tokens);
        rec.cacheWrite1hTokens = num(usage.cache_creation?.ephemeral_1h_input_tokens);
        if (usage.speed === 'fast') rec.speed = 'fast';
      }
      const content = msg.content;
      rec.text = contentToText(content);
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type !== 'tool_use') continue;
          if (rec.toolName === null) {
            rec.kind = 'tool_use';
            rec.toolName = str(block.name);
            rec.toolUseId = str(block.id);
          }
          if (str(block.name) === 'Bash' && rec.command === null) {
            rec.command = str(block.input?.command);
          }
          const changeKind = EDIT_TOOLS[str(block.name) ?? ''];
          const filePath = str(block.input?.file_path) ?? str(block.input?.notebook_path);
          if (changeKind && filePath) rec.filesTouched.push({ path: filePath, changeKind });
        }
      }
      if (rec.kind === 'unknown') rec.kind = 'assistant';
      return rec;
    }

    case 'system': {
      rec.kind = 'system';
      rec.role = 'system';
      rec.subtype = str(obj.subtype);
      // Content-less subtypes (turn_duration, stop_hook_summary) index no text.
      rec.text = str(obj.content) ?? '';
      return rec;
    }

    // CC's own name for the conversation. 'ai-title' is model-generated and
    // may be rewritten as the session evolves; 'custom-title' is user-set and
    // outranks it. The indexer lifts both onto the session row (last wins per
    // stream); the title text itself is searchable.
    case 'ai-title': {
      rec.kind = 'title';
      rec.subtype = 'ai';
      rec.text = str(obj.aiTitle) ?? '';
      return rec;
    }
    case 'custom-title': {
      rec.kind = 'title';
      rec.subtype = 'custom';
      rec.text = str(obj.customTitle) ?? '';
      return rec;
    }

    // Context CC injects on the user channel, subtyped by attachment.type.
    // Only path-shaped subtypes contribute searchable text; a queued_command's
    // prompt is skipped because it reappears as a real prompt when dequeued.
    //
    // These carry a BODY as well as a path, and indexing the path alone threw
    // the body away: an edited_text_file's snippet is the change you made by
    // hand that the agent then reacted to. Uncapped, like tool_result content —
    // the index's job is to hold what the run actually saw.
    case 'attachment': {
      const att = obj.attachment;
      rec.kind = 'attachment';
      rec.subtype = str(att?.type);
      switch (rec.subtype) {
        case 'edited_text_file':
          rec.text = pathAndBody(str(att.filename), str(att.snippet));
          break;
        case 'file':
          rec.text = pathAndBody(str(att.filename), str(att.content?.file?.content));
          break;
        case 'directory':
          rec.text = pathAndBody(str(att.path), str(att.content));
          break;
        // Path-shaped with no body of its own, and previously unindexed.
        case 'compact_file_reference':
          rec.text = str(att.filename) ?? '';
          break;
      }
      return rec;
    }

    // The desktop app's name for the session — usually a copy of the custom
    // title. Searchable, but never lifted onto the session row.
    case 'agent-name': {
      rec.kind = 'title';
      rec.subtype = 'agent';
      rec.text = str(obj.agentName) ?? '';
      return rec;
    }

    // Mode bookkeeping ('mode' / 'permission-mode'), written repeatedly —
    // no uuid, no timestamp. Text stays empty (2.7k "normal" lines would
    // pollute search); the UI reads the value from raw and renders changes.
    case 'mode': {
      rec.kind = 'mode';
      rec.subtype = str(obj.mode);
      return rec;
    }
    case 'permission-mode': {
      rec.kind = 'mode';
      rec.subtype = str(obj.permissionMode);
      return rec;
    }

    default:
      // Known harness records are bookkeeping; anything the next CC release
      // invents stays 'unknown' so the health panel surfaces it. Neither is
      // searchable — request snapshots repeat the system prompt and history.
      if (BOOKKEEPING_TYPES.has(obj?.type)) {
        rec.kind = 'bookkeeping';
        rec.subtype = obj.type;
      }
      return rec;
  }
}

const BOOKKEEPING_TYPES = new Set<unknown>([
  'api-request',
  'api-request-blob',
  'api-request-shape',
  'atis-latch',
  'bridge-session',
  'cost-state',
  'file-history-delta',
  'file-history-snapshot',
  'last-prompt',
  'queue-operation',
  'relocated',
  'tools-used',
]);
