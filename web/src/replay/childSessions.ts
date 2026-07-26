import { createContext } from 'react';
import type { ChildSessionSummary } from '../types';

/**
 * File-based subagent transcripts of the open session
 * (`<session>/subagents/*.jsonl`, indexed as child sessions). Provided by
 * Replay so Task tool blocks anywhere in the tree — log view, expanded spine
 * turns — can nest the transcript that call spawned.
 */
export const ChildSessionsContext = createContext<readonly ChildSessionSummary[]>([]);

const key = (s: string) => s.trim().slice(0, 200);

/**
 * The transcript a Task call spawned: its opening prompt IS the call's
 * `input.prompt` (same anchor trick as inline sidechain runs). When several
 * transcripts share a prompt (parallel identical Tasks), the one starting
 * closest to the call's timestamp wins.
 */
export function matchChildSession(
  children: readonly ChildSessionSummary[],
  prompt: string | null,
  ts: string | null,
): ChildSessionSummary | null {
  if (prompt === null || children.length === 0) return null;
  const k = key(prompt);
  if (k === '') return null;
  const matches = children.filter((c) => key(c.firstPrompt) === k);
  if (matches.length <= 1) return matches[0] ?? null;
  if (ts === null) return matches[0]!;
  const t = new Date(ts).getTime();
  return [...matches].sort(
    (a, b) =>
      Math.abs(new Date(a.startedAt ?? 0).getTime() - t) -
      Math.abs(new Date(b.startedAt ?? 0).getTime() - t),
  )[0]!;
}
