import { createContext } from 'react';

/**
 * Bookmark state shared down the replay tree so every BlockView (log view,
 * expanded spine turns) can render its "mark this moment" toggle without
 * prop-drilling. Provided by Replay; the default (null toggle) hides the
 * affordance anywhere that renders blocks outside a session context.
 */
export interface BookmarkState {
  idxs: ReadonlySet<number>;
  toggle: ((idx: number) => void) | null;
}

export const BookmarkContext = createContext<BookmarkState>({
  idxs: new Set(),
  toggle: null,
});
