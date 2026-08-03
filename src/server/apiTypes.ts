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
  /** User tags, alphabetical. Free-form labels, canonical lower case. */
  tags: string[];
  customName: string | null;
  note: string | null;
  /**
   * Claude Code's own name for the conversation, lifted off its 'ai-title' /
   * 'custom-title' log records (the user-set custom-title wins). Display
   * precedence: Turnlog's customName, then this, then the project name.
   */
  aiTitle: string | null;
  /**
   * Sessions in this session's resume chain, itself included (1 =
   * standalone). Resuming into a new session id copies history forward, so
   * chain parts share their first message's uuid — one logical conversation
   * across files.
   */
  chainLen: number;
  /** Which agent wrote the session: 'claude-code' (default) or 'codex'. */
  tool: string;
}

/** `GET /api/sessions/:id/chain` — every part of a resume chain, oldest first. */
export interface SessionChainResponse {
  sessionId: string;
  chain: SessionMeta[];
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
  /**
   * API response id. Claude Code writes one line per content block, so
   * consecutive rows sharing this id are one response — which is how the
   * replay tells a continuation line apart from a real branch.
   */
  messageId: string | null;
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
/**
 * One refinement offered for the current match set: a value, how many of the
 * matches carry it, and the operator that narrows to it.
 */
export interface SearchFacet {
  value: string;
  count: number;
  /** The token to append to the query — e.g. `tool:Bash`. */
  operator: string;
}

/**
 * Facets over the CURRENT match set, so refining is a click rather than
 * knowing the grammar. Each list is capped and ordered by count; an empty
 * list means the dimension does not distinguish these results.
 */
export interface SearchFacets {
  /** Which tool calls appear — Bash, Read, Edit… */
  tools: SearchFacet[];
  /** Which record kinds — prompt, tool_use, diff… */
  kinds: SearchFacet[];
  /** Which projects the matches sit in. */
  projects: SearchFacet[];
  /** Which agent wrote them. Only offered when more than one appears. */
  agents: SearchFacet[];
}

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
  /** Null for a session-scoped find, where there is nothing to refine. */
  facets: SearchFacets | null;
}

/**
 * One matched session placed on the time axis (`GET /api/search/timeline`).
 * The timeline answers "when did this keep coming up?" — sessions are the
 * markers because a session is one work episode; 50 hits inside it are still
 * one moment on the axis.
 */
export interface TimelineSession {
  session: SessionMeta;
  /** Matching messages in this session family (subagent transcripts included). */
  hits: number;
  /**
   * First hit's message idx in the root session itself — the jump target.
   * Null when every hit sits inside a subagent transcript.
   */
  firstIdx: number | null;
}

/** Computed over the FULL match set, not the truncated hit page. */
export interface SearchTimelineResponse {
  query: string;
  /** Matched root sessions, oldest first. */
  sessions: TimelineSession[];
}

/**
 * One API response's context footprint (`GET /api/sessions/:id/context`).
 * `context` is the prompt side of the request — input + cache read + cache
 * write tokens — i.e. how full the window was when this response started.
 */
export interface ContextPoint {
  idx: number;
  ts: string | null;
  context: number;
  tokensOut: number;
}

/** A `compact_boundary` system record — CC compacted the conversation here. */
export interface CompactionMark {
  idx: number;
  ts: string | null;
  /** Context size the moment before compaction (CC's own number), if logged. */
  preTokens: number | null;
}

/**
 * `GET /api/sessions/:id/context` — the context-window timeline: one point
 * per API response (main chain only; sidechains run their own context), with
 * compaction boundaries marked. Everything here is mechanical column math
 * over usage the index already holds.
 */
export interface SessionContextResponse {
  sessionId: string;
  points: ContextPoint[];
  compactions: CompactionMark[];
}

/**
 * One session that has been written to very recently — the "what are my
 * agents doing right now" row.
 *
 * `contextTokens` is null wherever the agent does not report window fill:
 * Codex rollouts carry per-response deltas, not a running total, and a number
 * that means something different per agent is worse than no number. Every
 * other field is agent-agnostic, so the panel reads the same whoever is
 * running.
 */
export interface LiveSession {
  id: string;
  /** Not nullable: sessions.tool is NOT NULL with a 'claude-code' default. */
  tool: string;
  projectKey: string | null;
  projectPath: string | null;
  name: string;
  /** Last indexed activity — how "live" this is. */
  lastActivityAt: string | null;
  turnCount: number;
  costUsd: number | null;
  /** The most recent thing the human asked, trimmed for one line. */
  lastPrompt: string | null;
  /** Tokens in the window at the latest response, where the agent says. */
  contextTokens: number | null;
}

export interface LiveResponse {
  /** Most recently active first. */
  sessions: LiveSession[];
  /** The window that counts as "now", so the UI can say it. */
  withinMinutes: number;
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

/**
 * A subagent transcript session (`<session>/subagents/*.jsonl`) belonging to
 * one parent, with the anchor the replay needs to nest it: the transcript's
 * opening prompt IS the spawning Task call's `input.prompt`.
 */
export interface ChildSessionSummary extends SessionMeta {
  firstPrompt: string;
}

/** `GET /api/sessions/:id/children` — file-based subagent transcripts. */
export interface SessionChildrenResponse {
  sessionId: string;
  children: ChildSessionSummary[];
}

/**
 * UI preferences (`GET/POST /api/prefs`) — server-side because the random
 * per-launch port gives the browser a new origin (and thus a fresh
 * localStorage) every run. POST merges: keys set to null are deleted.
 */
export interface PrefsResponse {
  prefs: Record<string, unknown>;
}

/** A session with its on-disk footprint (subagent files rolled in). */
export interface DiskSessionInfo extends SessionMeta {
  bytes: number;
  /** The session's own file is gone from disk (still indexed until pruned). */
  missing: boolean;
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
  /**
   * Mode governing this turn ('plan', 'acceptEdits', …): the last
   * mode/permission-mode value before the prompt, and 'plan' whenever the
   * turn contains a plan_mode_exit attachment (how current CC marks
   * planning). Null when never recorded.
   */
  mode: string | null;
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

/** A file the indexer could not read during the last scan — never silent. */
export interface SkippedFile {
  file: string;
  message: string;
}

/** What the index itself holds — the DB half of the health snapshot. */
export interface IndexFacts {
  /** Indexed JSONL files (sessions incl. subagent transcripts). */
  indexedFiles: number;
  /** Message rows in the index. */
  events: number;
  /** Records stored with kind='unknown' — kept raw, rendered collapsed. */
  unknownEvents: number;
  /** Unknown records grouped by their raw `type`, largest first. */
  unknownTypes: { type: string; count: number }[];
  /**
   * Indexed session files that no longer exist on disk (checked live — the
   * watcher can't see historic unlinks). Prune forgets them on request.
   */
  missingFiles: number;
  /** SQLite database size on disk. */
  dbBytes: number;
  /**
   * Whether the opt-in trigram index is built. Off by default: it costs
   * several times the word index's space, so the user asks for it.
   */
  deepSearch: boolean;
}

/**
 * `GET /api/health` — the cardinal rule made visible: what the index holds,
 * what it kept without understanding (kind='unknown', stored raw), and what
 * it could not read at all.
 */
export interface HealthResponse extends IndexFacts {
  state: 'idle' | 'indexing';
  lastScanAt: string | null;
  /** From the last full scan this launch; empty before one completes. */
  skipped: SkippedFile[];
}

/**
 * `POST /api/maintenance` — housekeeping on Turnlog's own index (never on
 * `~/.claude`, which stays read-only): `prune` drops rows for session files
 * that no longer exist, `vacuum` repacks the database, `deep-build` and
 * `deep-drop` turn substring search on and off. Returns the action's result
 * plus fresh index facts.
 */
export interface MaintenanceResponse extends IndexFacts {
  action: 'prune' | 'vacuum' | 'deep-build' | 'deep-drop';
  /** Sessions removed from the index (prune only). */
  pruned?: number;
  /** Bytes reclaimed by repacking (vacuum only). */
  freedBytes?: number;
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
  /**
   * settings.json carries an `editorCommand` template — the open-in-editor
   * buttons only render when there is something to launch.
   */
  editorConfigured: boolean;
  /**
   * `turnlog demo` — the sessions on screen are bundled samples, not the
   * user's. The UI says so, because a screenshot of a demo is otherwise
   * indistinguishable from a screenshot of someone's real history.
   */
  demo: boolean;
}
