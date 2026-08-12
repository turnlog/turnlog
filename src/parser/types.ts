export type MessageKind =
  | 'prompt'
  | 'assistant'
  | 'tool_use'
  | 'tool_result'
  | 'summary'
  | 'system'
  | 'meta'
  | 'title'
  | 'attachment'
  | 'mode'
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
  /**
   * Finer classification within a kind: 'ai' | 'custom' for titles, the
   * attachment's own type for attachments, the mode value for mode records.
   * In-memory only (goldens + indexer routing) — not a DB column; the UI
   * derives it from `raw`.
   */
  subtype: string | null;
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
  /**
   * The git branch the record was written on. Every agent stamps it and
   * Turnlog used to throw it away — it is what makes "everything any agent
   * did on feature/auth" a question the index can answer.
   */
  gitBranch: string | null;
  /**
   * The shell command a tool_use ran, verbatim — extracted per agent (CC's
   * `Bash`, Cursor's `run_terminal_cmd`, Codex's shell/exec calls). 40% of
   * all tool calls are commands, and they had no cross-session dimension:
   * this is what `cmd:` and the Commands screen read. Null on everything
   * that is not a command.
   */
  command: string | null;
  filesTouched: FileTouch[];
  /** The original line, verbatim. Never dropped — the cardinal rule. */
  raw: string;
}
