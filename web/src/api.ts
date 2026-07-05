import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  type InfiniteData,
} from '@tanstack/react-query';
import type {
  MessageListResponse,
  ProjectInfo,
  SearchResponse,
  SessionListResponse,
  SessionMeta,
  StatsResponse,
  StatusResponse,
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

export function fetchMessages(
  sessionId: string,
  afterIdx: number,
  limit: number,
): Promise<MessageListResponse> {
  return apiFetch<MessageListResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/messages?after_idx=${afterIdx}&limit=${limit}`,
  );
}

export function useSearch(q: string) {
  return useQuery({
    queryKey: ['search', q],
    queryFn: () => apiFetch<SearchResponse>(`/api/search?q=${encodeURIComponent(q)}&limit=200`),
    enabled: q.trim().length > 0,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function hasToken(): boolean {
  return token !== null || import.meta.env.DEV;
}
