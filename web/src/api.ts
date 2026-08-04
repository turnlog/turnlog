import { useEffect } from 'react';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import type {
  BookmarksResponse,
  DiskUsageResponse,
  FileHistoryResponse,
  FileSummary,
  HealthResponse,
  IndexedEvent,
  MaintenanceResponse,
  MessageListResponse,
  MessageRow,
  PrefsResponse,
  SavedSearch,
  SpendResponse,
  ProjectInfo,
  SearchResponse,
  SearchTimelineResponse,
  SessionContextResponse,
  SessionChainResponse,
  SessionChildrenResponse,
  LiveResponse,
  SessionListResponse,
  SessionMeta,
  SessionMetaPatch,
  StatsResponse,
  StatusResponse,
  TurnsResponse,
} from './types';

/**
 * The per-launch session token arrives in the URL the CLI opens
 * (`/?token=…`). It must survive hash navigation — we never strip it,
 * because it IS the credential on reload. In dev the Vite proxy injects it
 * server-side instead, so an absent token is fine there.
 */
const token = new URLSearchParams(window.location.search).get('token');

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    let message = `${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message);
  }
  return res.json() as Promise<T>;
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let message = `${res.status}`;
    try {
      const errBody = (await res.json()) as { error?: string };
      if (errBody.error) message = errBody.error;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message);
  }
  return res.json() as Promise<T>;
}

/** UI prefs live server-side (ui_prefs) so they survive the random port. */
export function fetchPrefs(): Promise<PrefsResponse> {
  return apiFetch<PrefsResponse>('/api/prefs');
}

export function postPrefs(patch: Record<string, unknown>): Promise<PrefsResponse> {
  return apiPost<PrefsResponse>('/api/prefs', patch);
}

/** Update a session's pin/name/note; caches refresh from the returned row. */
export function useSetSessionMeta() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: SessionMetaPatch }) =>
      apiPost<SessionMeta>(`/api/sessions/${encodeURIComponent(id)}/meta`, patch),
    onSuccess: (updated) => {
      queryClient.setQueryData(['session', updated.id], updated);
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
      void queryClient.invalidateQueries({ queryKey: ['sessions-range'] });
    },
  });
}

/** Ask the CLI process to exit — the header's stop button. */
export async function shutdownServer(): Promise<void> {
  await apiPost<{ ok: boolean }>('/api/shutdown', {});
}

/** Ask the server to reveal the session's JSONL in the OS file manager. */
export function revealSession(id: string): void {
  void apiPost(`/api/sessions/${encodeURIComponent(id)}/reveal`, {}).catch(() => {
    /* local UX nicety — nothing actionable if it fails */
  });
}

export interface SessionsQuery {
  sort?: 'started_at' | 'ended_at' | 'cost_usd' | 'event_count' | 'tokens';
  dir?: 'asc' | 'desc';
  project?: string;
  /** Drop sessions with nothing in them (0 turns or 0 tokens, no cost). */
  hideEmpty?: boolean;
  /** Case-insensitive name/title/project filter (sidebar quick filter). */
  name?: string;
  /** Only sessions carrying this tag. */
  tag?: string;
  /** Collapse resume chains to their most recent part (sidebar list). */
  collapseChains?: boolean;
}

const PAGE = 100;

// Module-level so several useStatus consumers trigger one invalidation per scan.
let lastScanSeen: string | null = null;

export function useStatus() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['status'],
    queryFn: () => apiFetch<StatusResponse>('/api/status'),
    refetchInterval: (query) =>
      query.state.data?.state === 'indexing' ? 1000 : 15_000,
  });

  // The status poll doubles as a live-update fallback: the watcher reindexes
  // changed session files, each pass stamps lastScanAt, and a new stamp means
  // the index content moved. The SSE stream (useLiveEvents) is the fast path;
  // this catches anything it misses when the stream is down.
  const lastScanAt = query.data?.lastScanAt ?? null;
  useEffect(() => {
    if (lastScanAt === null || lastScanAt === lastScanSeen) return;
    const first = lastScanSeen === null;
    lastScanSeen = lastScanAt;
    if (first) return; // initial load, queries are already fresh
    invalidateIndexDerived(queryClient, null);
  }, [lastScanAt, queryClient]);

  return query;
}

type AppQueryClient = ReturnType<typeof useQueryClient>;

/** Refresh everything derived from the index; target one session when known. */
function invalidateIndexDerived(queryClient: AppQueryClient, sessionId: string | null): void {
  for (const key of ['sessions', 'sessions-range', 'stats', 'projects', 'spend', 'health', 'live']) {
    void queryClient.invalidateQueries({ queryKey: [key] });
  }
  if (sessionId !== null) {
    void queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
    void queryClient.invalidateQueries({ queryKey: ['turns', sessionId] });
    void queryClient.invalidateQueries({ queryKey: ['context', sessionId] });
  } else {
    void queryClient.invalidateQueries({ queryKey: ['session'] });
    void queryClient.invalidateQueries({ queryKey: ['turns'] });
    void queryClient.invalidateQueries({ queryKey: ['context'] });
  }
}

/**
 * Live index updates over SSE (`/api/events`) — mounted once in App. The
 * watcher-side reindex broadcasts `indexed`; each event refreshes what the
 * index feeds. EventSource reconnects on drops by itself, and the lastScanAt
 * fallback in useStatus covers the gaps.
 */
export function useLiveEvents() {
  const queryClient = useQueryClient();
  useEffect(() => {
    // EventSource can't set headers — the token rides the query string, the
    // same credential channel the opened URL uses (dev proxy injects it).
    const es = new EventSource(token ? `/api/events?token=${token}` : '/api/events');
    const onIndexed = (e: MessageEvent) => {
      let sessionId: string | null = null;
      try {
        sessionId = (JSON.parse(e.data as string) as IndexedEvent).sessionId;
      } catch {
        /* malformed frame — refresh broadly */
      }
      invalidateIndexDerived(queryClient, sessionId);
    };
    es.addEventListener('indexed', onIndexed);
    return () => es.close();
  }, [queryClient]);
}

export function useStats() {
  return useQuery({
    queryKey: ['stats'],
    queryFn: () => apiFetch<StatsResponse>('/api/stats'),
  });
}

/** Index health: skipped files + unknown-record tally (the cardinal rule, visible). */
export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => apiFetch<HealthResponse>('/api/health'),
    staleTime: 30_000,
  });
}

/**
 * Housekeeping on Turnlog's own index: 'prune' forgets session files that no
 * longer exist, 'vacuum' repacks the database. Both refresh the health card.
 */
/**
 * Sessions written to in the last few minutes. Short staleTime because the
 * whole point is recency; the SSE stream invalidates it on every write, so
 * this is only the floor.
 */
export function useLive() {
  return useQuery({
    queryKey: ['live'],
    queryFn: () => apiFetch<LiveResponse>('/api/live'),
    staleTime: 5_000,
    refetchInterval: 20_000,
  });
}

/** Every tag in use, with counts — the sidebar filter and editor suggestions. */
export function useTags() {
  return useQuery({
    queryKey: ['tags'],
    queryFn: () => apiFetch<{ tags: { tag: string; count: number }[] }>('/api/tags'),
    staleTime: 30_000,
  });
}

/**
 * Replace a session's tags. The whole set goes over the wire, so a dropped
 * request cannot leave half an edit applied.
 */
export function useSetSessionTags() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, tags }: { id: string; tags: string[] }) =>
      apiPost<{ tags: string[] }>(`/api/sessions/${encodeURIComponent(id)}/tags`, { tags }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
      void queryClient.invalidateQueries({ queryKey: ['session'] });
      void queryClient.invalidateQueries({ queryKey: ['tags'] });
      // A tag: query's results change the moment a tag moves.
      void queryClient.invalidateQueries({ queryKey: ['search'] });
    },
  });
}

export function useMaintenance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (action: 'prune' | 'vacuum' | 'deep-build' | 'deep-drop') =>
      apiPost<MaintenanceResponse>('/api/maintenance', { action }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['health'] });
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
      // Building or dropping the trigram index changes what a search can
      // find, so anything already fetched is stale.
      void queryClient.invalidateQueries({ queryKey: ['search'] });
    },
  });
}

export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: () => apiFetch<ProjectInfo[]>('/api/projects'),
  });
}

export function useSessions(q: SessionsQuery) {
  const params = new URLSearchParams();
  if (q.sort) params.set('sort', q.sort);
  if (q.dir) params.set('dir', q.dir);
  if (q.project) params.set('project', q.project);
  if (q.hideEmpty) params.set('hideEmpty', '1');
  if (q.name) params.set('name', q.name);
  if (q.tag) params.set('tag', q.tag);
  if (q.collapseChains) params.set('chains', 'collapse');

  return useInfiniteQuery({
    queryKey: [
      'sessions',
      q.sort ?? 'started_at',
      q.dir ?? 'desc',
      q.project ?? '',
      q.hideEmpty ?? false,
      q.name ?? '',
      // Every param the request varies by must be in the key, or React Query
      // serves the previous filter's result and the list looks frozen.
      q.tag ?? '',
      q.collapseChains ?? false,
    ],
    queryFn: ({ pageParam }) =>
      apiFetch<SessionListResponse>(
        `/api/sessions?${params.toString()}&limit=${PAGE}&offset=${pageParam}`,
      ),
    initialPageParam: 0,
    getNextPageParam: (last: SessionListResponse, all: SessionListResponse[]) => {
      const loaded = all.reduce((n, p) => n + p.sessions.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
    placeholderData: keepPreviousData,
  });
}

export function flattenSessions(
  data: InfiniteData<SessionListResponse> | undefined,
): SessionMeta[] {
  return data?.pages.flatMap((p) => p.sessions) ?? [];
}

export function useSession(id: string | null) {
  return useQuery({
    queryKey: ['session', id],
    queryFn: () => apiFetch<SessionMeta>(`/api/sessions/${encodeURIComponent(id!)}`),
    enabled: id !== null,
  });
}

export function useTurns(sessionId: string) {
  return useQuery({
    queryKey: ['turns', sessionId],
    queryFn: () =>
      apiFetch<TurnsResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/turns`),
    // Freshness comes from useLiveEvents (SSE) + the lastScanAt fallback —
    // the old 7s blind poll is gone.
  });
}

/** The rows of one spine turn, fetched only when it expands. */
export function useTurnRows(
  sessionId: string,
  startIdx: number,
  endIdx: number,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['turn-rows', sessionId, startIdx, endIdx],
    queryFn: async (): Promise<MessageRow[]> => {
      const res = await fetchMessages(sessionId, startIdx - 1, Math.max(1, endIdx - startIdx));
      return res.messages;
    },
    enabled,
    staleTime: 60_000,
  });
}

export function fetchMessages(
  sessionId: string,
  afterIdx: number,
  limit: number,
  lens?: string | null,
): Promise<MessageListResponse> {
  const lensParam = lens ? `&lens=${lens}` : '';
  return apiFetch<MessageListResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/messages?after_idx=${afterIdx}&limit=${limit}${lensParam}`,
  );
}

export function useSearch(q: string, sessionId?: string, deep?: boolean) {
  const scope = sessionId ? `&session=${encodeURIComponent(sessionId)}` : '';
  return useQuery({
    queryKey: ['search', q, sessionId ?? '', deep ?? false],
    queryFn: () =>
      apiFetch<SearchResponse>(
        `/api/search?q=${encodeURIComponent(q)}&limit=${sessionId ? 500 : 200}${scope}${deep ? '&deep=1' : ''}`,
      ),
    enabled: q.trim().length > 0,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

/** The full match set placed on the time axis — "when did this keep coming up?". */
export function useSearchTimeline(q: string, enabled = true, deep = false) {
  return useQuery({
    // deep is in the key for the same reason it is in the request: the two
    // views of one query must come from the same match set.
    queryKey: ['search-timeline', q, deep],
    queryFn: () =>
      apiFetch<SearchTimelineResponse>(
        `/api/search/timeline?q=${encodeURIComponent(q)}${deep ? '&deep=1' : ''}`,
      ),
    enabled: enabled && q.trim().length > 0,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

/** Context-window curve + compaction marks for one session's replay. */
export function useSessionContext(sessionId: string) {
  return useQuery({
    queryKey: ['context', sessionId],
    queryFn: () =>
      apiFetch<SessionContextResponse>(
        `/api/sessions/${encodeURIComponent(sessionId)}/context`,
      ),
    staleTime: 60_000,
  });
}

/**
 * The command palette's session pool: recent first, chains collapsed to their
 * tip, empties hidden. One page of 500 is plenty to fuzzy over — the palette
 * is a switcher, not a browser.
 */
export function usePaletteSessions(enabled: boolean) {
  return useQuery({
    queryKey: ['palette-sessions'],
    queryFn: async () =>
      (
        await apiFetch<SessionListResponse>(
          '/api/sessions?sort=ended_at&dir=desc&limit=500&hideEmpty=1&chains=collapse',
        )
      ).sessions,
    enabled,
    staleTime: 30_000,
  });
}

/** Every part of a session's resume chain, oldest first (chainLen > 1 only). */
export function useSessionChain(sessionId: string, enabled = true) {
  return useQuery({
    queryKey: ['chain', sessionId],
    queryFn: () =>
      apiFetch<SessionChainResponse>(
        `/api/sessions/${encodeURIComponent(sessionId)}/chain`,
      ),
    staleTime: 60_000,
    enabled,
  });
}

/** File-based subagent transcripts of a session (`<session>/subagents/`). */
export function useSessionChildren(sessionId: string) {
  return useQuery({
    queryKey: ['children', sessionId],
    queryFn: () =>
      apiFetch<SessionChildrenResponse>(
        `/api/sessions/${encodeURIComponent(sessionId)}/children`,
      ),
    staleTime: 60_000,
  });
}

/** Page a session (optionally one lens) to completion, 2000 rows at a time. */
async function fetchAllMessages(sessionId: string, lens?: string): Promise<MessageRow[]> {
  const out: MessageRow[] = [];
  let after = -1;
  for (let i = 0; i < 10; i++) {
    const res = await fetchMessages(sessionId, after, 2000, lens);
    out.push(...res.messages);
    if (out.length >= res.total || res.messages.length === 0) break;
    after = res.messages[res.messages.length - 1]!.idx;
  }
  return out;
}

/** Every row of a subagent transcript, fetched when its fold first opens. */
export function useChildRows(childId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['child-rows', childId],
    queryFn: () => fetchAllMessages(childId),
    enabled,
    staleTime: 60_000,
  });
}

/** Every row of one lens, paged to completion (the diffs pivot needs all diffs). */
export function useLensRows(sessionId: string, lens: string) {
  return useQuery({
    queryKey: ['lens-rows', sessionId, lens],
    queryFn: () => fetchAllMessages(sessionId, lens),
    staleTime: 60_000,
  });
}

/** Positions of failing tool results — the error jump markers. */
export function useErrorIdxs(sessionId: string) {
  return useQuery({
    queryKey: ['error-idxs', sessionId],
    queryFn: async (): Promise<number[]> => {
      const res = await fetchMessages(sessionId, -1, 1000, 'errors');
      return res.messages.filter((m) => m.isError).map((m) => m.idx);
    },
    staleTime: 60_000,
  });
}

/** Sessions within a started_at range (calendar week queries). */
export function useSessionsRange(sinceIso: string, untilIso: string, hideEmpty = false) {
  return useQuery({
    queryKey: ['sessions-range', sinceIso, untilIso, hideEmpty],
    queryFn: async (): Promise<SessionMeta[]> => {
      const res = await apiFetch<SessionListResponse>(
        `/api/sessions?since=${encodeURIComponent(sinceIso)}&until=${encodeURIComponent(untilIso)}&sort=started_at&dir=asc&limit=1000${hideEmpty ? '&hideEmpty=1' : ''}`,
      );
      return res.sessions;
    },
    staleTime: 30_000,
  });
}

export function useSpend(days: number, q: string) {
  const query = q.trim();
  return useQuery({
    queryKey: ['spend', days, query],
    queryFn: () =>
      apiFetch<SpendResponse>(
        `/api/spend?days=${days}${query ? `&q=${encodeURIComponent(query)}` : ''}`,
      ),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

/* ── saved searches ─────────────────────────────────────────────────── */

export function useSavedSearches() {
  return useQuery({
    queryKey: ['saved-searches'],
    queryFn: () => apiFetch<SavedSearch[]>('/api/searches'),
    staleTime: 30_000,
  });
}

export function useSaveSearch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, query }: { name: string | null; query: string }) =>
      apiPost<SavedSearch>('/api/searches', { name, query }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['saved-searches'] }),
  });
}

export function useDeleteSavedSearch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiPost<{ ok: boolean }>(`/api/searches/${id}/delete`, {}),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['saved-searches'] }),
  });
}

/* ── message bookmarks ──────────────────────────────────────────────── */

export function useBookmarks(sessionId: string) {
  return useQuery({
    queryKey: ['bookmarks', sessionId],
    queryFn: () =>
      apiFetch<BookmarksResponse>(
        `/api/sessions/${encodeURIComponent(sessionId)}/bookmarks`,
      ),
    staleTime: 30_000,
  });
}

export function useToggleBookmark(sessionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ idx, on }: { idx: number; on: boolean }) =>
      apiPost<BookmarksResponse>(
        `/api/sessions/${encodeURIComponent(sessionId)}/bookmarks`,
        { idx, on },
      ),
    onSuccess: (updated) => queryClient.setQueryData(['bookmarks', sessionId], updated),
  });
}

/* ── disk usage ─────────────────────────────────────────────────────── */

export function useDisk() {
  return useQuery({
    queryKey: ['disk'],
    queryFn: () => apiFetch<DiskUsageResponse>('/api/disk'),
    staleTime: 30_000,
  });
}

/* ── cross-session file history ─────────────────────────────────────── */

export function useFiles(q: string, find = '') {
  return useQuery({
    queryKey: ['files', q, find],
    queryFn: () =>
      apiFetch<FileSummary[]>(
        `/api/files?q=${encodeURIComponent(q)}&limit=200${find ? `&find=${encodeURIComponent(find)}` : ''}`,
      ),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

/** Launch the configured editor on a touched file (settings.json editorCommand). */
export function openFileInEditor(path: string): void {
  void apiPost('/api/files/open', { path }).catch(() => {
    /* local UX nicety — nothing actionable if it fails */
  });
}

export function useFileHistory(path: string | null) {
  return useQuery({
    queryKey: ['file-history', path],
    queryFn: () =>
      apiFetch<FileHistoryResponse>(`/api/files/history?path=${encodeURIComponent(path!)}`),
    enabled: path !== null,
    staleTime: 30_000,
  });
}

/** Session as markdown or a self-contained HTML page — the replay's exports. */
export interface ExportQuery {
  format?: 'markdown' | 'html';
  redact?: boolean;
  /** Message-idx bounds for a partial export (the share panel's turn range). */
  fromIdx?: number;
  toIdx?: number;
}

export async function fetchExport(sessionId: string, q: ExportQuery = {}): Promise<string> {
  const params = new URLSearchParams();
  if (q.format === 'html') params.set('format', 'html');
  if (q.redact) params.set('redact', '1');
  if (q.fromIdx !== undefined) params.set('from', String(q.fromIdx));
  if (q.toIdx !== undefined) params.set('to', String(q.toIdx));
  const qs = params.toString();
  const res = await fetch(
    `/api/sessions/${encodeURIComponent(sessionId)}/export${qs ? `?${qs}` : ''}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  );
  if (!res.ok) throw new ApiError(res.status, 'export failed');
  return res.text();
}

export function hasToken(): boolean {
  return token !== null || import.meta.env.DEV;
}
