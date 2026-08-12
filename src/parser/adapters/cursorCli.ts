import type { FileTouch, NormalizedRecord } from '../types.js';

/**
 * Adapter for Cursor CLI (cursor-agent) transcripts (`~/.cursor/projects/
 * <dir-id>/agent-transcripts/<uuid>/<uuid>.jsonl`), as observed through
 * community parsers of Cursor 1.x. Lines are Anthropic-conversation-shaped:
 * `{role, message: {content}}` where content is a string or an array of
 * `text` / `thinking` / `tool_use` / `tool_result` blocks. Same cardinal rule
 * as every adapter: never crash, never drop.
 *
 * What the format does NOT carry — and the adapter must not invent:
 * timestamps (session start/end fall back to file mtime in the indexer),
 * model ids, and token usage. Tool RESULTS mostly live outside the transcript
 * too; when a stub block exists it is normalized, otherwise a tool_use simply
 * has no paired result and the replay renders it unpaired.
 */

const EDIT_TOOL_RE = /edit|write|replace|create/i;

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function blockText(block: any): string {
  if (typeof block === 'string') return block;
  if (block == null || typeof block !== 'object') return '';
  switch (block.type) {
    case 'text':
      return str(block.text) ?? '';
    case 'thinking':
      return str(block.thinking) ?? str(block.text) ?? '';
    case 'tool_use':
      try {
        return block.input == null ? '' : JSON.stringify(block.input);
      } catch {
        return '';
      }
    case 'tool_result':
      return contentText(block.content);
    default:
      return '';
  }
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(blockText).filter(Boolean).join('\n');
  return '';
}

/** The user channel wraps typed text in <user_query> tags — strip the tags,
 *  keep the words (they are what the user actually said). */
function stripUserQuery(text: string): string {
  return text.replace(/<\/?user_query>/g, '').trim();
}

export function normalizeCursorCli(obj: any, raw: string, fallbackId: string): NormalizedRecord {
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
    cwd: null,
    gitBranch: null,
    command: null,
    filesTouched: [],
    raw,
  };

  const role = str(obj?.role);
  const content = obj?.message?.content ?? obj?.content;

  if (role === 'user') {
    rec.role = 'user';
    if (Array.isArray(content)) {
      const toolResult = content.find((b: any) => b?.type === 'tool_result');
      if (toolResult) {
        rec.kind = 'tool_result';
        rec.toolUseId = str(toolResult.tool_use_id);
        rec.isError = toolResult.is_error === true;
        rec.text = contentText(content);
        return rec;
      }
    }
    rec.kind = 'prompt';
    rec.text = stripUserQuery(contentText(content));
    return rec;
  }

  if (role === 'assistant') {
    rec.role = 'assistant';
    rec.text = contentText(content);
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block?.type !== 'tool_use') continue;
        if (rec.toolName === null) {
          rec.kind = 'tool_use';
          rec.toolName = str(block.name);
          rec.toolUseId = str(block.id);
        }
        // Cursor's tool names churn; recognize edits by name shape and take
        // whichever path-ish input field is present.
        const name = str(block.name) ?? '';
        const input = block.input;
        // Terminal runs: run_terminal_cmd today, but the name churns like the
        // edit tools' do — any *_cmd/*terminal* tool carrying a string
        // `command` is one.
        if (rec.command === null && /terminal|_cmd$|^bash$/i.test(name)) {
          rec.command = str(input?.command);
        }
        const filePath =
          str(input?.file_path) ?? str(input?.path) ?? str(input?.target_file);
        if (filePath && EDIT_TOOL_RE.test(name)) {
          rec.filesTouched.push({
            path: filePath,
            changeKind: /write|create/i.test(name) ? 'write' : 'edit',
          } satisfies FileTouch);
        }
      }
    }
    if (rec.kind === 'unknown') rec.kind = 'assistant';
    return rec;
  }

  // No role — whatever else cursor-agent writes lands here, preserved.
  return rec;
}
