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

/**
 * Hide-empty-sessions preference, shared between the sidebar list and the
 * calendar. Persisted so the choice survives relaunches.
 */

let hideEmpty = localStorage.getItem('turnlog-hide-empty') === '1';
const hideEmptyListeners = new Set<() => void>();

export function getHideEmpty(): boolean {
  return hideEmpty;
}

export function setHideEmpty(value: boolean): void {
  hideEmpty = value;
  localStorage.setItem('turnlog-hide-empty', value ? '1' : '0');
  hideEmptyListeners.forEach((fn) => fn());
}

function subscribeHideEmpty(fn: () => void): () => void {
  hideEmptyListeners.add(fn);
  return () => hideEmptyListeners.delete(fn);
}

export function useHideEmpty(): boolean {
  return useSyncExternalStore(subscribeHideEmpty, getHideEmpty);
}
