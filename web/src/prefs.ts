import { useSyncExternalStore } from 'react';
import { fetchPrefs, postPrefs } from './api';

/**
 * Server-backed UI preferences. The random per-launch port gives the browser
 * a fresh origin (and an empty localStorage) every run, so persisted UI state
 * lives next to the index instead (`ui_prefs`, GET/POST /api/prefs).
 *
 * Loaded once before first render (initPrefs in main.tsx), then kept in this
 * module store with write-through: setPref updates the UI synchronously and
 * POSTs in the background — a lost write costs a preference, never data.
 */

let prefs: Record<string, unknown> = {};
const listeners = new Set<() => void>();

export async function initPrefs(): Promise<void> {
  try {
    prefs = (await fetchPrefs()).prefs;
  } catch {
    /* server unreachable or tokenless — session defaults still work */
  }
}

export function getPref(key: string): unknown {
  return prefs[key];
}

/** Set (or, with null, clear) one preference; fire-and-forget persistence. */
export function setPref(key: string, value: unknown): void {
  if (value === null || value === undefined) delete prefs[key];
  else prefs[key] = value;
  listeners.forEach((fn) => fn());
  void postPrefs({ [key]: value ?? null }).catch(() => {
    /* keep the in-memory value; it just won't survive this launch */
  });
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function usePref(key: string): unknown {
  return useSyncExternalStore(subscribe, () => prefs[key]);
}
