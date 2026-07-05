import { useSyncExternalStore } from 'react';

/**
 * Hash-based routing on purpose: the hardened server serves exactly `/` and
 * the static bundle — there is no SPA fallback for arbitrary paths, and the
 * `?token=` credential must stay untouched in the query string. Everything
 * after `#` is ours.
 *
 *   #/                      library
 *   #/session/<id>          replay
 *   #/session/<id>?m=42&q=… replay, scrolled to message idx 42, match nav for q
 *   #/search?q=…            search
 */
export type Route =
  | { name: 'library' }
  | { name: 'session'; id: string; jumpIdx: number | null; query: string | null }
  | { name: 'search'; query: string };

export function parseRoute(hash: string): Route {
  const h = hash.startsWith('#') ? hash.slice(1) : hash;
  const qIndex = h.indexOf('?');
  const path = qIndex === -1 ? h : h.slice(0, qIndex);
  const params = new URLSearchParams(qIndex === -1 ? '' : h.slice(qIndex + 1));

  const session = /^\/session\/([^/?]+)$/.exec(path);
  if (session) {
    const m = params.get('m');
    return {
      name: 'session',
      id: decodeURIComponent(session[1]!),
      jumpIdx: m !== null && /^\d+$/.test(m) ? Number(m) : null,
      query: params.get('q'),
    };
  }
  if (path === '/search') {
    return { name: 'search', query: params.get('q') ?? '' };
  }
  return { name: 'library' };
}

function subscribe(cb: () => void): () => void {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  return parseRoute(hash);
}

export function navigate(to: string): void {
  window.location.hash = to;
}

export function sessionHash(id: string, opts: { m?: number; q?: string } = {}): string {
  const params = new URLSearchParams();
  if (opts.m !== undefined) params.set('m', String(opts.m));
  if (opts.q) params.set('q', opts.q);
  const qs = params.toString();
  return `#/session/${encodeURIComponent(id)}${qs ? `?${qs}` : ''}`;
}

export function searchHash(q: string): string {
  return `#/search?q=${encodeURIComponent(q)}`;
}
