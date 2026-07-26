import { useSyncExternalStore } from 'react';
import { getPref, setPref } from './prefs';

export type Theme = 'dark' | 'light';

let current: Theme = 'dark';

/** Called from main.tsx after prefs load, before the first render. */
export function initTheme(): void {
  // URL override (dev/visual-testing hook), then saved choice, then OS.
  const fromUrl = new URLSearchParams(window.location.search).get('theme');
  const stored = getPref('theme');
  current =
    fromUrl === 'dark' || fromUrl === 'light'
      ? fromUrl
      : stored === 'dark' || stored === 'light'
        ? stored
        : window.matchMedia('(prefers-color-scheme: light)').matches
          ? 'light'
          : 'dark';
  document.documentElement.dataset.theme = current;
}

const listeners = new Set<() => void>();

export function getTheme(): Theme {
  return current;
}

export function setTheme(theme: Theme): void {
  current = theme;
  setPref('theme', theme);
  document.documentElement.dataset.theme = theme;
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, getTheme);
}
