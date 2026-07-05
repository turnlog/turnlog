import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  type InfiniteData,
} from '@tanstack/react-query';
import type {
  MessageListResponse,
  MessageRow,
  ProjectInfo,
  SearchResponse,
  SessionListResponse,
  SessionMeta,
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

export interface SessionsQuery {
  sort?: 'started_at' | 'ended_at' | 'cost_usd' | 'turn_count';
  dir?: 'asc' | 'desc';
  project?: string;
}

const PAGE = 100;

export function useStatus() {
  return useQuery({
    queryKey: ['status'],
    queryFn: () => apiFetch<StatusResponse>('/api/status'),
    refetchInterval: (query) =>
      query.state.data?.state === 'indexing' ? 1000 : 15_000,
  });
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

  return useInfiniteQuery({
    queryKey: ['sessions', q.sort ?? 'started_at', q.dir ?? 'desc', q.project ?? ''],
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

/** The trial-open set: ids of the 10 newest sessions. Only fetched when unlicensed. */
export function useTrialOpenIds(enabled: boolean) {
  return useQuery({
    queryKey: ['trial-open'],
    queryFn: async () => {
      const res = await apiFetch<SessionListResponse>(
        '/api/sessions?sort=started_at&dir=desc&limit=10',
      );
      return new Set(res.sessions.map((s) => s.id));
    },
    enabled,
  });
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
    // Cheap aggregate; keeps the spine fresh while a session is live.
    refetchInterval: 7000,
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

/** Every row of one lens, paged to completion (files view needs all diffs). */
export function useLensRows(sessionId: string, lens: string) {
  return useQuery({
    queryKey: ['lens-rows', sessionId, lens],
    queryFn: async (): Promise<MessageRow[]> => {
      const out: MessageRow[] = [];
      let after = -1;
      for (let i = 0; i < 10; i++) {
        const res = await fetchMessages(sessionId, after, 2000, lens);
        out.push(...res.messages);
        if (out.length >= res.total || res.messages.length === 0) break;
        after = res.messages[res.messages.length - 1]!.idx;
      }
      return out;
    },
    staleTime: 60_000,
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

export function hasToken(): boolean {
  return token !== null || import.meta.env.DEV;
}
