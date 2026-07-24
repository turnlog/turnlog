import type { SessionMeta } from './types';

/** A session's display title: the user's custom name wins over the project. */
export function sessionName(
  s: Pick<SessionMeta, 'customName' | 'projectPath' | 'projectKey'>,
): string {
  return s.customName ?? projectName(s);
}

/** `-Users-gor-WebstormProjects-turnlog` → `turnlog`; real paths → basename. */
export function projectName(s: Pick<SessionMeta, 'projectPath' | 'projectKey'>): string {
  const p = s.projectPath;
  if (p && p !== '') {
    const parts = p.split(/[\\/]/).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1]!;
  }
  const key = s.projectKey ?? '';
  const segs = key.split('-').filter(Boolean);
  return segs.length > 0 ? segs[segs.length - 1]! : '(unknown)';
}

export function fmtCost(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  if (v === 0) return '$0';
  if (v < 0.01) return '<$0.01';
  return `$${v.toFixed(2)}`;
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${(n / 1_000_000_000).toFixed(1)}B`;
}

export function fmtCount(n: number): string {
  return n.toLocaleString('en-US');
}

const DAY_MS = 86_400_000;

export function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const time = d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
  if (d.getTime() >= startOfToday) return `today ${time}`;
  if (d.getTime() >= startOfToday - DAY_MS) return `yest ${time}`;
  const sameYear = d.getFullYear() === now.getFullYear();
  const date = d.toLocaleDateString('en-US', {
    month: 'short',
    day: '2-digit',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  return `${date} ${time}`;
}

export function fmtTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function fmtDuration(startIso: string | null, endIso: string | null): string {
  if (!startIso || !endIso) return '—';
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  return `${h}h ${mins % 60}m`;
}

/** `claude-sonnet-4-5-20250929` → `sonnet-4-5`; unknown shapes pass through. */
export function fmtModel(model: string | null): string {
  if (!model) return '';
  return model
    .replace(/^claude-/, '')
    .replace(/-\d{8}$/, '');
}

export function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

/**
 * Deterministic per-project tile color: hash the project key into one of 8
 * validated categorical hues (`--tile-0…7`, defined in theme.css). Color
 * follows the project key, never its position in a list, so filtering/sorting
 * never repaints a project. Collisions past 8 projects are disambiguated by the
 * tile's initial + the project name (the required secondary encoding).
 */
export function tileClass(key: string | null): string {
  let h = 0;
  for (const ch of key ?? '') h = (h * 31 + ch.charCodeAt(0)) | 0;
  return `tile-${Math.abs(h) % 8}`;
}
