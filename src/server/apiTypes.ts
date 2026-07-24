/**
 * The typed contract between the local server and the web UI — the React app
 * imports these types (type-only, so nothing from src/ enters the bundle).
 */

export interface SessionMeta {
  id: string;
  projectPath: string | null;
  projectKey: string | null;
  /**
   * Set for subagent transcripts (Task runs newer CC versions log to
   * <session>/subagents/*.jsonl): the session that spawned this one. Child
   * sessions are hidden from session lists; their usage rolls up into the
   * parent's totals.
   */
  parentSessionId: string | null;
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
  /** User annotations (session_meta table) — survive reindex and rebuild. */
  pinned: boolean;
  customName: string | null;
  note: string | null;
}

/** Partial update for a session's user annotations (`POST …/meta`). */
export interface SessionMetaPatch {
  pinned?: boolean;
  customName?: string | null;
  note?: string | null;
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
 * Lenses collapse a session to one dimension. Tool lenses
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

/**
 * Aggregates over the FULL match set (not the truncated hit page) — the
 * "what did this kind of work cost me" number nobody without a content
 * index can compute.
 */
export interface SearchAggregates {
  matchedSessions: number;
  totalCostUsd: number;
  /** Sessions excluded from the sum (unknown model, no override). */
  unpricedSessions: number;
  totalTurns: number;
  totalTokens: number;
}

export interface SearchResponse {
  query: string;
  groups: SearchGroup[];
  totalHits: number;
  aggregates: SearchAggregates | null;
}

/** A named, persisted search query (schema v5; survives rebuilds). */
export interface SavedSearch {
  id: number;
  name: string;
  query: string;
  createdAt: string | null;
}

/** One touched file across all sessions — the cross-session pivot's list. */
export interface FileSummary {
  path: string;
  /** Distinct root sessions that touched the file. */
  sessions: number;
  lastTouched: string | null;
}

/** Every session that touched one path, newest first. */
export interface FileHistoryResponse {
  path: string;
  sessions: SessionMeta[];
}

/** Bookmarked message idxs for one session (`GET/POST …/bookmarks`). */
export interface BookmarksResponse {
  sessionId: string;
  idxs: number[];
}

/** A session with its on-disk footprint (subagent files rolled in). */
export interface DiskSessionInfo extends SessionMeta {
  bytes: number;
}

export interface DiskUsageResponse {
  /** Every indexed JSONL file summed, children included. */
  totalBytes: number;
  fileCount: number;
  /** Root sessions ranked by family bytes, largest first. */
  sessions: DiskSessionInfo[];
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
  /** Estimated — sum of the project's session costs. */
  costUsd: number;
}

export interface SpendDay {
  /** YYYY-MM-DD (session start date — cost attributes to the day it began). */
  date: string;
  costUsd: number;
  tokens: number;
  sessions: number;
}

export interface SpendSplit {
  /** Model id or project key. */
  key: string;
  costUsd: number;
  tokens: number;
  sessions: number;
}

export interface SpendResponse {
  days: SpendDay[];
  byModel: SpendSplit[];
  byProject: SpendSplit[];
  totals: {
    costUsd: number;
    unpricedSessions: number;
    sessions: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    /** Est. saved by prompt caching vs. paying input rate for read tokens. */
    cacheSavedUsd: number;
  };
  sinceDays: number;
  query: string | null;
}

export interface StatsResponse {
  sessions: number;
  messages: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  projects: ProjectInfo[];
}

/**
 * Payload of the `indexed` SSE event on `GET /api/events` — emitted after the
 * watcher reindexes a changed session file, or with sessionId null for broad
 * changes (startup scan, subagent transcripts that roll into a parent).
 */
export interface IndexedEvent {
  sessionId: string | null;
  at: string;
}

export interface StatusResponse {
  state: 'idle' | 'indexing';
  filesTotal: number;
  filesDone: number;
  lastError: string | null;
  lastScanAt: string | null;
  appVersion: string;
  /**
   * A newer published version if the CLI's startup registry check found one,
   * else null (also null while the check is in flight, or when it's disabled
   * via TURNLOG_NO_UPDATE_CHECK / `checkUpdates:false`). The browser never
   * contacts npm itself — this mirrors the CLI's one sanctioned network touch
   * (src/cli/updateCheck.ts) so the web UI can surface the same notice.
   */
  updateAvailable: string | null;
}
