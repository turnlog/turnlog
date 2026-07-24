/**
 * The in-app What's New page's single source of truth. Ships inside the
 * bundle — nothing is ever fetched (the no-network promise holds).
 *
 * Convention (see CLAUDE.md): BEFORE tagging any release, add that version's
 * entry here in user-level language — added / improved / fixed, plain words
 * a user skims, never commit messages or internal names. Newest first.
 */

export type NoteKind = 'added' | 'improved' | 'fixed';

export interface ReleaseNotes {
  version: string;
  /** ISO date the version was tagged. */
  date: string;
  notes: { kind: NoteKind; text: string }[];
}

export const RELEASES: ReleaseNotes[] = [
  {
    version: '0.5.0',
    date: '2026-07-24',
    notes: [
      {
        kind: 'added',
        text: 'Give your agent memory: turnlog mcp lets Claude Code search your past sessions mid-task. Register once with: claude mcp add turnlog -- npx turnlog mcp',
      },
      {
        kind: 'added',
        text: 'Search from the terminal: turnlog search <query> — same operators as the UI, with links that open the running UI at the match.',
      },
      {
        kind: 'added',
        text: 'Bookmarks: hover any message in a replay and mark the moment; a yellow rail jumps between your marks.',
      },
      {
        kind: 'added',
        text: 'A disk tab under Spend shows which sessions are eating your storage, with a reveal button to clean up by hand.',
      },
      {
        kind: 'improved',
        text: 'The Spend header stays put while the content scrolls.',
      },
    ],
  },
  {
    version: '0.4.0',
    date: '2026-07-24',
    notes: [
      {
        kind: 'added',
        text: 'Search operators: narrow any search with tool:Bash, kind:prompt, is:error, project:name, model:opus, or before:/after: dates — alone or combined with text.',
      },
      {
        kind: 'added',
        text: 'Saved searches: keep the queries you rerun as one-click chips under the search box.',
      },
      {
        kind: 'added',
        text: 'Files screen: pick any file and see every session that ever touched it, with the edits in order — like blame, but for agent work.',
      },
      {
        kind: 'added',
        text: 'This page — release notes now live in the app; the status dot in the header opens them.',
      },
      {
        kind: 'improved',
        text: 'The diffs lens opens as a per-file view: touched files on the left, that file’s edits on the right.',
      },
      {
        kind: 'improved',
        text: 'Search lives in a header button now (press / anywhere to jump there), and the session toolbar gained a find button (same as ⌘F).',
      },
      {
        kind: 'improved',
        text: 'Clearer pressed states on lenses and header buttons, and properly centered controls throughout.',
      },
    ],
  },
  {
    version: '0.3.1',
    date: '2026-07-23',
    notes: [
      {
        kind: 'added',
        text: 'Stop Turnlog from the browser — a power button in the header shuts the local server down cleanly (click twice; the first click arms it).',
      },
      {
        kind: 'added',
        text: 'Spend can show a full year or all time, not just the last 90 days.',
      },
      {
        kind: 'improved',
        text: 'Session notes show as a small sticky-note marker — hover it to read the note, in the sidebar and the replay header.',
      },
      {
        kind: 'improved',
        text: 'Pinned sessions are highlighted in yellow in the sidebar, with a filled pin.',
      },
      {
        kind: 'improved',
        text: 'The hide-empty-sessions filter is now an eye button next to the sort controls.',
      },
      {
        kind: 'improved',
        text: 'The replay view toggle is simpler: spine and log. Edits live in the diffs lens.',
      },
      {
        kind: 'fixed',
        text: 'The note editor no longer types in the wrong font.',
      },
    ],
  },
  {
    version: '0.3.0',
    date: '2026-07-22',
    notes: [
      {
        kind: 'added',
        text: 'Pin sessions to keep them at the top of the list, whatever the sort.',
      },
      {
        kind: 'added',
        text: 'Name your sessions and attach notes — they survive reindexes and rebuilds.',
      },
      {
        kind: 'added',
        text: 'Show a session’s file in Finder / Explorer straight from the replay header.',
      },
      {
        kind: 'improved',
        text: 'A cleaner replay header and a roomier sidebar.',
      },
    ],
  },
  {
    version: '0.2.7',
    date: '2026-07-22',
    notes: [
      { kind: 'added', text: 'Hide empty sessions from the sidebar with one toggle.' },
      { kind: 'improved', text: 'A consistency pass across the app’s controls.' },
    ],
  },
  {
    version: '0.2.6',
    date: '2026-07-22',
    notes: [
      {
        kind: 'improved',
        text: 'Sorting starts with activity — the session you touched last is always on top.',
      },
    ],
  },
  {
    version: '0.2.5',
    date: '2026-07-22',
    notes: [
      { kind: 'improved', text: 'Turnlog is back on npm — same tool, fresh release line.' },
    ],
  },
];
