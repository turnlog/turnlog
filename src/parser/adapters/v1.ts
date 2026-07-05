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
    text: '',
    tokensIn: 0,
    tokensOut: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cacheWrite1hTokens: 0,
    costUsd: typeof obj?.costUSD === 'number' ? obj.costUSD : null,
    cwd: str(obj?.cwd),
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
      rec.kind = 'prompt';
      return rec;
    }

    case 'assistant': {
      const msg = obj.message ?? {};
      rec.role = 'assistant';
      rec.model = str(msg.model);
      const usage = msg.usage;
      if (usage && typeof usage === 'object') {
        rec.tokensIn = num(usage.input_tokens);
        rec.tokensOut = num(usage.output_tokens);
        rec.cacheReadTokens = num(usage.cache_read_input_tokens);
        rec.cacheWriteTokens = num(usage.cache_creation_input_tokens);
        rec.cacheWrite1hTokens = num(usage.cache_creation?.ephemeral_1h_input_tokens);
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
      rec.text = str(obj.content) ?? str(obj.subtype) ?? '';
      return rec;
    }

    default:
      // Unrecognized record type (ai-title, attachment, queue-operation, ...
      // or whatever the next CC release invents). Stored, never dropped.
      return rec;
  }
}
