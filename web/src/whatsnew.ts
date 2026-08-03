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
    version: '0.9.0',
    date: '2026-08-03',
    notes: [
      {
        kind: 'added',
        text: 'Turnlog now reads OpenAI Codex sessions. Anything under ~/.codex/sessions is indexed automatically when that folder exists — search, replay, spend and disk all work the same, and the resume button copies codex resume <id>. Codex and Claude Code work on the same repo land in one project timeline, so a repo reads as a single history whichever agent you pointed at it.',
      },
      {
        kind: 'added',
        text: 'Every session now says which agent wrote it: a badge in the agent’s own brand colour in the sidebar and the replay header, and the right speaker names in the replay and in exports.',
      },
      {
        kind: 'added',
        text: 'The calendar can colour blocks by project or by agent — whichever one fills the block, the other becomes its edge stripe, so a mixed week reads at a glance either way.',
      },
      {
        kind: 'added',
        text: 'A quick filter on the sidebar: type a few letters and the session list narrows by name, title or project across your whole history, not just the rows already loaded. Project, sort order and the rest moved behind one filter button beside it, which shows a dot whenever something hidden is narrowing the list.',
      },
      {
        kind: 'improved',
        text: 'A new look. Fresh type — one face for the app’s own voice, another for anything quoted from your logs — and a palette where a colour means one thing: green is success, deletions and errors are their own red, and diffs moved to teal.',
      },
      {
        kind: 'improved',
        text: 'Buttons behave consistently now. Every control in the app frame — the header, the sidebar toggle, the search button, the stop button — is one size and one shape, and a toggle that is switched on fills solid instead of sitting a shade off its own hover.',
      },
      {
        kind: 'improved',
        text: 'Release notes — this page — group under one heading per kind instead of repeating a tag on every line, and sit in a readable column instead of running the full width of your window.',
      },
      {
        kind: 'fixed',
        text: 'The bookmark button in the log view was cut off at the left edge of the window. It sits in the margin where it belongs.',
      },
      {
        kind: 'fixed',
        text: 'Controls sitting straight on the page background — the Spend and calendar toggles, the calendar arrows and the “This week” button — were nearly invisible in the light theme.',
      },
      {
        kind: 'fixed',
        text: 'A to-do list in a tool result showed no difference between the task being worked on and the ones still queued. The live task now reads in full ink, ahead of the pending ones and the faded, finished ones.',
      },
    ],
  },
  {
    version: '0.8.0',
    date: '2026-07-29',
    notes: [
      {
        kind: 'added',
        text: 'Search results on a timeline: flip the new hits | timeline toggle and every matching session becomes a dot on a time axis — when did this keep coming up? Click a dot to land right at the match.',
      },
      {
        kind: 'added',
        text: 'See the context window fill up: the replay’s stats panel draws how full Claude’s context was at every response, with compaction points marked on the curve, listed as jump badges, and flagged on the turn where they happened.',
      },
      {
        kind: 'added',
        text: 'A command palette: press ⌘K (Ctrl+K) anywhere to jump to any session by name, switch screens, run saved searches, or fire an action — anything you type is also one Enter from a full search.',
      },
      {
        kind: 'added',
        text: 'Keyboard shortcuts grew up: press ? for a cheat sheet, and every hint in the app shows real keycaps. B toggles the sidebar, T switches the theme, Enter/⇧Enter cycle find matches, and ⇧Q (pressed twice) stops Turnlog.',
      },
      {
        kind: 'added',
        text: 'Files joined the search language: path:api.ts narrows any query to sessions that touched that file, and the Files screen can filter to files touched by sessions matching a search.',
      },
      {
        kind: 'added',
        text: 'Dates in plain words: after:7d, after:yesterday and before:today work anywhere the date operators do.',
      },
      {
        kind: 'added',
        text: 'Open a file in your editor straight from the diffs view — set "editorCommand" once in settings.json and the button appears.',
      },
      {
        kind: 'added',
        text: 'Your pins, names, notes, bookmarks and saved searches can move with you: turnlog annotations export | import carries them to a new machine as one JSON file.',
      },
      {
        kind: 'added',
        text: 'A third export format for scripts: turnlog export --format json emits the full message stream for jq, with the same range and redaction options.',
      },
      {
        kind: 'improved',
        text: 'Turns spent in plan mode wear a quiet "plan" badge on the spine.',
      },
      {
        kind: 'improved',
        text: 'Deleted session files show up honestly the moment they vanish: counted on the health card, marked "file gone" in disk usage — and pruning is the one way to forget them.',
      },
      {
        kind: 'improved',
        text: 'A cleaner look everywhere: list rows are rounded and full-width with no ruled lines, screens use your whole window instead of centering in a column, and every icon button speaks the same visual language.',
      },
      {
        kind: 'fixed',
        text: 'Search group headers no longer let rows peek through while scrolling, and long session names no longer overflow their tooltips.',
      },
    ],
  },
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
        text: 'Saved searches: keep the queries you rerun as one-click badges under the search box.',
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
