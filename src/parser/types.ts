export type MessageKind =
  | 'prompt'
  | 'assistant'
  | 'tool_use'
  | 'tool_result'
  | 'summary'
  | 'system'
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
  model: string | null;
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
