/**
 * The typed contract between the local server and the web UI. Phase 2's React
 * app imports these types.
 */

export interface SessionMeta {
  id: string;
  projectPath: string | null;
  projectKey: string | null;
  startedAt: string | null;
  endedAt: string | null;
  model: string | null;
  turnCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Estimated — computed from the shipped pricing table unless the log recorded it. */
  costUsd: number | null;
  filesTouchedCount: number;
}

export interface SessionListResponse {
  sessions: SessionMeta[];
  total: number;
}

export interface MessageRow {
  uuid: string;
  parentUuid: string | null;
  idx: number;
  role: string | null;
  kind: string;
  toolName: string | null;
  toolUseId: string | null;
  ts: string | null;
  isSidechain: boolean;
  isError: boolean;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
  model: string | null;
  text: string;
  /** Original JSONL record, verbatim, for rich rendering. */
  raw: string;
}

export interface MessageListResponse {
  sessionId: string;
  messages: MessageRow[];
  /** Total messages matching (session-wide, honoring the lens). */
  total: number;
}

/**
 * Lenses collapse a session to one dimension (brainstorm §4b). Tool lenses
 * include both the tool_use and its paired tool_result rows.
 */
export const LENSES = ['diffs', 'commands', 'errors', 'prompts'] as const;
export type Lens = (typeof LENSES)[number];

/**
 * Snippets mark match boundaries with U+E000 (open) and U+E001 (close) so the
 * client can escape the text safely before turning markers into <mark> tags.
 */
export const SNIPPET_OPEN = '\uE000';
export const SNIPPET_CLOSE = '\uE001';

export interface SearchHit {
  uuid: string;
  idx: number;
  kind: string;
  toolName: string | null;
  ts: string | null;
  snippet: string;
}

export interface SearchGroup {
  session: SessionMeta;
  hits: SearchHit[];
}

export interface SearchResponse {
  query: string;
  groups: SearchGroup[];
  totalHits: number;
}

/**
 * One turn of the spine view: a user prompt plus a mechanical summary of what
 * happened under it, aggregated from main-chain tool calls (never an LLM).
 */
export interface TurnSummary {
  /** idx of the prompt row that starts the turn. */
  idx: number;
  /** idx the turn ends before (the next turn's start, or total). */
  endIdx: number;
  uuid: string;
  ts: string | null;
  /** Prompt text, truncated server-side; command wrappers stripped. */
  text: string;
  /** Slash-command name when the prompt is a command wrapper (e.g. "/clear"). */
  command: string | null;
  reads: number;
  edits: number;
  commands: number;
  /** Subagent (Task) launches. */
  tasks: number;
  otherTools: number;
  /** Failed tool results under this turn (main chain + sidechains). */
  errors: number;
  tokensOut: number;
}

export interface TurnsResponse {
  sessionId: string;
  turns: TurnSummary[];
  /** Messages in the session (turns' endIdx upper bound). */
  total: number;
  /** Rows before the first prompt (summaries, meta) — shown as a prelude. */
  preludeCount: number;
}

export interface ProjectInfo {
  projectKey: string;
  projectPath: string | null;
  sessionCount: number;
}

export interface StatsResponse {
  sessions: number;
  messages: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  projects: ProjectInfo[];
}

export interface StatusResponse {
  state: 'idle' | 'indexing';
  filesTotal: number;
  filesDone: number;
  lastError: string | null;
  lastScanAt: string | null;
  appVersion: string;
  /**
   * Drives the trial treatment in the UI: when false, only the 10 newest
   * sessions are openable. Real Ed25519 verification lands in Phase 3; until
   * then the server reports true (TURNLOG_UNLICENSED=1 previews trial mode).
   */
  licensed: boolean;
}
