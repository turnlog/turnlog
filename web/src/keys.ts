/**
 * Platform-aware key labels for shortcut hints. macOS gets the real symbols;
 * everything else spells the modifier out.
 */
export const IS_MAC = /Mac|iP(hone|ad|od)/.test(navigator.platform);
export const MOD = IS_MAC ? '⌘' : 'Ctrl';
export const SHIFT = IS_MAC ? '⇧' : 'Shift';

/**
 * Display keys for every app shortcut — the single source the cheat sheet,
 * tooltips, and palette rows all read, so a reassignment is a one-line edit.
 * (The keydown handlers still match `e.key` themselves; they live with the
 * component that owns the behavior.)
 */
export const SHORTCUTS: Record<
  'palette' | 'search' | 'sidebar' | 'theme' | 'stop' | 'sheet' | 'find',
  string[]
> = {
  palette: [MOD, 'K'],
  search: ['/'],
  sidebar: ['B'],
  theme: ['T'],
  stop: [SHIFT, 'Q'],
  sheet: ['?'],
  find: [MOD, 'F'],
};

/** True while the event target is a place the user types — single-letter
 *  shortcuts must never fire there. */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return (
    el !== null &&
    (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
  );
}
