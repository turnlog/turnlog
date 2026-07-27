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
    version: '0.7.0',
    date: '2026-07-27',
    notes: [
      {
        kind: 'added',
        text: 'Sessions now show Claude Code’s own name for the conversation instead of the project name — in the sidebar, the replay, search results and exports. A name you set yourself still wins.',
      },
      {
        kind: 'added',
        text: 'A share button gathers every way a session leaves Turnlog into one panel: markdown or web page, redaction on or off, and the option to export just a range of turns instead of the whole session.',
      },
      {
        kind: 'added',
        text: 'Continue where you left off: a play button in the replay header copies the claude --resume command for that session, ready to paste in your terminal.',
      },
      {
        kind: 'added',
        text: 'Search your own marks: is:pinned, has:note and has:bookmark narrow to the sessions and moments you flagged — on their own or combined with anything else.',
      },
      {
        kind: 'added',
        text: 'Housekeeping on the home screen: forget sessions whose log files are gone, and repack the index to reclaim the space. Your pins and notes survive both.',
      },
      {
        kind: 'improved',
        text: 'Attached files, plan mode and permission changes are now shown properly in the replay instead of counting as unrecognized events — about a third of everything Turnlog stored became readable.',
      },
      {
        kind: 'fixed',
        text: 'Spend no longer counts a resumed conversation’s history twice. Estimates get a little smaller and a lot more honest, and the Spend screen is faster.',
      },
      {
        kind: 'fixed',
        text: 'Interrupting Claude and retyping no longer leaves a ghost turn — the abandoned attempt folds away, one click from view.',
      },
    ],
  },
  {
    version: '0.6.0',
    date: '2026-07-26',
    notes: [
      {
        kind: 'added',
        text: 'Resumed sessions now stitch into one conversation — the sidebar shows a single row with a part count, and the replay header steps between the parts.',
      },
      {
        kind: 'added',
        text: 'Subagent work that Claude Code logs to separate files now appears inside the parent replay, folded under the Task that ran it.',
      },
      {
        kind: 'added',
        text: 'Export any session as a single styled HTML page — dark and light, tool calls collapsible, nothing loads from the network. Next to the markdown export in the replay header.',
      },
      {
        kind: 'added',
        text: 'Redacted exports: scrub API keys, emails, and home-folder paths from a markdown or HTML export before you share it.',
      },
      {
        kind: 'added',
        text: 'An index health panel on the home screen: what’s indexed, the index size on disk, and anything Turnlog couldn’t read — nothing is dropped silently.',
      },
      {
        kind: 'improved',
        text: 'Your theme, sidebar, and view choices now survive restarts instead of resetting each launch.',
      },
      {
        kind: 'improved',
        text: 'After an update, the header status dot wears a yellow ring until you’ve opened What’s New.',
      },
    ],
  },
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
