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
  IndexedEvent,
  MessageListResponse,
  MessageRow,
  SpendResponse,
  ProjectInfo,
  SearchResponse,
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
  sort?: 'started_at' | 'ended_at' | 'cost_usd' | 'turn_count' | 'tokens';
  dir?: 'asc' | 'desc';
  project?: string;
  /** Drop sessions with nothing in them (0 turns or 0 tokens, no cost). */
  hideEmpty?: boolean;
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
  for (const key of ['sessions', 'sessions-range', 'stats', 'projects', 'spend']) {
    void queryClient.invalidateQueries({ queryKey: [key] });
  }
  if (sessionId !== null) {
    void queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
    void queryClient.invalidateQueries({ queryKey: ['turns', sessionId] });
  } else {
    void queryClient.invalidateQueries({ queryKey: ['session'] });
    void queryClient.invalidateQueries({ queryKey: ['turns'] });
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

  return useInfiniteQuery({
    queryKey: [
      'sessions',
      q.sort ?? 'started_at',
      q.dir ?? 'desc',
      q.project ?? '',
      q.hideEmpty ?? false,
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

export function useSearch(q: string, sessionId?: string) {
  const scope = sessionId ? `&session=${encodeURIComponent(sessionId)}` : '';
  return useQuery({
    queryKey: ['search', q, sessionId ?? ''],
    queryFn: () =>
      apiFetch<SearchResponse>(
        `/api/search?q=${encodeURIComponent(q)}&limit=${sessionId ? 500 : 200}${scope}`,
      ),
    enabled: q.trim().length > 0,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

/** Positions of failing tool results — the 4c jump markers. */
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

/** Session as markdown (text, not JSON) — copy/download from replay. */
export async function fetchExport(sessionId: string): Promise<string> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/export`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new ApiError(res.status, 'export failed');
  return res.text();
}

export function hasToken(): boolean {
  return token !== null || import.meta.env.DEV;
}
