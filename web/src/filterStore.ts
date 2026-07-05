import { useSyncExternalStore } from 'react';

/**
 * Project filter shared between the sidebar and the home composer pills.
 * Module-level store (same pattern as theme.ts) — no context plumbing.
 */

let project = '';
const listeners = new Set<() => void>();

export function getProjectFilter(): string {
  return project;
}

export function setProjectFilter(value: string): void {
  project = value;
  listeners.forEach((fn) => fn());
  // The sidebar shows the result — make sure it's visible.
  window.dispatchEvent(new CustomEvent('turnlog:open-sidebar'));
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useProjectFilter(): string {
  return useSyncExternalStore(subscribe, getProjectFilter);
}
