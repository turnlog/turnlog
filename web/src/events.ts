/**
 * App-internal window events — cross-tree signals (chrome shortcuts, palette
 * actions) that would otherwise need context plumbing. One constant per
 * signal; no string literals at call sites.
 */
export const APP_EVENT = {
  /** Reveal the sidebar (project-filter jump from the home screen). */
  openSidebar: 'turnlog:open-sidebar',
  /** Flip the sidebar (B, palette action). */
  toggleSidebar: 'turnlog:toggle-sidebar',
  /** ⇧Q pressed — StopButton walks its arm-then-confirm two-step. */
  stopKey: 'turnlog:stop-key',
  /** Open the keyboard cheat sheet (palette action). */
  shortcuts: 'turnlog:shortcuts',
  /** Open the command palette without ⌘K — the design-system specimen uses
   *  this so the page can show the real overlay instead of a drawing. */
  palette: 'turnlog:palette',
} as const;

export type AppEvent = (typeof APP_EVENT)[keyof typeof APP_EVENT];

export function emitAppEvent(name: AppEvent): void {
  window.dispatchEvent(new Event(name));
}

/** Subscribe; returns the unsubscribe for direct use in useEffect. */
export function onAppEvent(name: AppEvent, fn: () => void): () => void {
  window.addEventListener(name, fn);
  return () => window.removeEventListener(name, fn);
}
