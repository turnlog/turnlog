export type MessageKind =
  | 'prompt'
  | 'assistant'
  | 'tool_use'
  | 'tool_result'
  | 'summary'
  | 'system'
  | 'meta'
  | 'unknown';

export interface FileTouch {
  path: string;
  changeKind: 'edit' | 'write';
}

/**
 * The normalized shape every raw JSONL record is reduced to, regardless of
 * which Claude Code version wrote it. One record per line; rich rendering in
 * the UI re-reads `raw`.
 */
export interface NormalizedRecord {
  uuid: string;
  parentUuid: string | null;
  kind: MessageKind;
  role: string | null;
  ts: string | null;
  isSidechain: boolean;
  toolName: string | null;
  /** Pairing id linking tool_use records to their tool_result. */
  toolUseId: string | null;
  /** True for tool_result records the tool reported as failed. */
  isError: boolean;
  model: string | null;
  /**
   * API message id (`message.id`). Claude Code writes one JSONL line per
   * content block of a response, and every line repeats the same id and the
   * same usage object — usage must be counted once per messageId, not per line.
   */
  messageId: string | null;
  /** Plain text extracted for full-text search. */
  text: string;
  tokensIn: number;
  tokensOut: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Subset of cacheWriteTokens written with 1h TTL (billed at 2x instead of 1.25x). */
  cacheWrite1hTokens: number;
  /** Cost as recorded in the log itself (older CC versions); null if absent. */
  costUsd: number | null;
  cwd: string | null;
  filesTouched: FileTouch[];
  /** The original line, verbatim. Never dropped — the cardinal rule. */
  raw: string;
}
