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
  /** Total messages in the session (for pagination). */
  total: number;
}

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
