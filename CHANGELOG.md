# Changelog

All notable changes to Turnlog are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- A sixth MCP tool, `get_context`: how full a session's context window was
  and where it was compacted — so an agent can check whether a past session's
  late answers came after its early context was summarized away, before
  trusting them. Read-only like the other five; agents that don't log a
  running window total (Codex) get honest nulls rather than a wrong curve.

- The HTML export learned the spine: each prompt is a folding turn — the ask
  plus tool and error counts on the summary line — so a shared 300-turn
  session reads as 300 scannable lines instead of an endless scroll. Native
  `<details>`, no script, so the no-JS promise holds. Small sessions arrive
  expanded; big ones arrive folded, which is the case the fold exists for.

- `turnlog doctor` prints everything a bug report needs in one paste:
  versions, resolved paths, your settings, index facts split per agent,
  SQLite's own integrity verdict, and whether the index has drifted from
  what's on disk. It is strictly read-only — it will not create, migrate, or
  touch an index, so it is safe to run against a broken one (and exits
  non-zero if the integrity check fails, for scripts).

## [0.10.1] — 2026-08-04

### Fixed

- `turnlog demo` failed on Windows: the bundled sample sessions were resolved
  through a file URL's pathname, which on Windows yields `/C:/…` and points
  nowhere. Nothing else was affected — every other command was fine.

## [0.10.0] — 2026-08-04

### Fixed

- The Spend screen's "only work matching…" filter now understands the full
  query language, not just text — `tool:Bash`, `agent:codex`, `is:error` and
  the rest narrow the spend the way they narrow a search. They used to be
  searched as literal words, silently, only on this screen.

- With deep search on, the search timeline now shows the same match set as
  the hits view — it used to quietly fall back to word matching, so the two
  views of one query could disagree.

- Refine chips tidy up after themselves: any dimension left with a single
  value is dropped (the rule that already applied to agents), so clicking
  `tool:Bash` no longer re-offers a Bash chip that filters nothing, and a
  search with nothing to refine shows no empty band.

- The MCP tools caught up with the last two releases: `list_sessions` now
  says which **agent** wrote each session and lists its tags, and `search`
  advertises the `agent:` and `tag:` operators (and that a value with a space
  needs quoting). An agent recalling past work can now tell whether the work
  was its own.

- `turnlog annotations import` was silently importing tags without saying so
  — its summary line never mentioned them, so restoring on a new machine gave
  no sign they had arrived.

- Operator values containing a space now work if you quote them:
  `tag:"needs review"`, `project:"my project"`. They used to split on the
  space and silently match nothing, which made multi-word tags look broken.

- A session's message count was labelled "turns" everywhere it appeared —
  the sidebar, search, home, the calendar, session stats, exports and the MCP
  tools. It never counted turns: a session with 38 turns and 2,786 messages
  read as "2,786 turns". The number was always right and the word always
  wrong, so it now says **events**, which is what the rest of the app already
  called it. Sorting by it still works, including from an old bookmarked URL.

### Added

- The turn spine is keyboard-navigable: **j** and **k** move between turns,
  **enter** expands the one you're on, and **e** jumps to the next turn that
  errored (wrapping, so it cycles). The first keypress picks up wherever
  you've scrolled to rather than jumping to the top. Listed in the `?` cheat
  sheet with everything else.

- `turnlog demo` runs the real app against bundled sample sessions, in a
  scratch index — so you can see what Turnlog does before you have any agent
  history, and nobody has to hand you a screenshot. Your own sessions are
  never read: the demo redirects its data directory to a temp tree and
  rebuilds it fresh each run. A banner says "demo data" the whole time, and
  it can't be dismissed.

- A fresh index now starts with three example saved searches — `is:error
  after:7d`, `has:bookmark`, `kind:prompt after:today`. The operator grammar
  is the most useful thing in Turnlog and the hardest to discover; three
  working examples teach it better than a list of syntax. They are ordinary
  saved searches: delete any you don't want and they stay deleted.

- Refine chips on search results: under the result count, a row of what your
  matches actually contain — which agents, tools, record kinds and projects,
  with counts. Click one to narrow to it. The operator grammar is powerful and
  invisible; this makes the common half of it a click, and the cheat line
  still teaches the rest. A dimension that no longer distinguishes anything
  (one agent left, say) stops being offered.

- A new `agent:` operator to go with them — `agent:codex`, `agent:claude` —
  narrowing any search to the agent that wrote the session. The short form
  works as well as the stored one.

- A "Now" card on the home screen: while any session is being written to, it
  shows what your agents are doing this minute — which agent, which project,
  the last thing you asked, turns and cost so far, and how full the context
  window is where the agent reports it. Click through to the live-tailing
  replay. Two agents working at once show side by side. It appears only while
  something is running and is absent otherwise, so it costs nothing when
  you're not mid-flight.

- Session tags: free-form labels on any session — `refactor`, `billing`,
  `wip`. Add them from the replay header, see them on sidebar rows, filter the
  sidebar to one from the filter popover, and narrow any search with
  `tag:billing` (combines with every other operator). Tags are yours, not
  derived: they survive a re-index, and they travel with
  `turnlog annotations export|import` like your pins and notes. Casing and
  spacing are normalised, so `Refactor` and `refactor` are one tag rather than
  two. Works across every indexed agent — a tag belongs to the session, not to
  the tool that wrote it.

- Deep search: an opt-in index that matches **inside** words. The normal
  search matches whole words, so a fragment like `eWebSock`, half an error
  string, or part of a UUID finds nothing — the one thing grep still did
  better than Turnlog. Turn it on from the health card's Maintain row
  ("build deep search"); it costs several times the index's usual size, which
  is why it is a choice rather than the default, and the button tells you the
  new size when it finishes. Once built, a **words | inside words** toggle
  appears on the search screen. Everything else still works alongside it —
  `tool:`, `is:error`, `project:` and the rest narrow a deep search the same
  way. Drop it any time from the same button; nothing else about your index
  changes. Works across every indexed agent, and any added later.

## [0.9.1] — 2026-08-03

### Changed

- The project README caught up with the app: it still described a
  Claude-Code-only tool, two releases after that stopped being true. Now
  covers Codex sessions, the search operators and timeline, the context-window
  strip, the command palette, the export formats and annotation portability —
  and the `Commands` block matches the CLI's own help again. No changes to
  Turnlog itself; npm renders the README from the published tarball, so
  shipping the corrected one needs a version.

## [0.9.0] — 2026-08-03

### Changed

- The interface got a visual overhaul. New type — Plus Jakarta Sans for the
  app's own voice, Space Mono for anything quoted from your logs — and a
  reworked palette where colour means one thing at a time: green is success
  and nothing else, diffs moved to teal, and errors are their own red rather
  than sharing a hex with the accent. Every button in the app frame is now
  one control, so the header, the sidebar toggle, the hero search and the
  stop button share a height, a padding and an icon size instead of six
  near-identical implementations. Toggles read more clearly too: a control
  that is switched on now fills solid rather than sitting one shade off its
  own hover, and the replay's lens buttons carry their category as the fill
  with the icon reversed out of it. Notes, exports and the command palette
  all picked up the same treatment.

### Added

- The sidebar got a quick filter: type a few letters and the session list
  narrows by name, title, or project — across your whole history, not just
  the rows already loaded. Everything else — project, sort order, direction,
  and empty-session visibility — now lives in a filter popover behind one
  button beside it, with a dot on the button (and a reset link inside)
  whenever a hidden control is narrowing the list.

- Turnlog now reads OpenAI Codex sessions. Rollouts under
  `~/.codex/sessions` are indexed automatically when the directory exists
  (read-only, like everything else): full-text search, the turn spine,
  replay, spend and disk views all work, sessions wear a CODEX badge, and
  the resume button copies `codex resume <id>`. Codex work on a repo lands
  in the **same project** as your Claude Code work on that repo — one
  timeline per repo, whichever agent you pointed at it. Every session now
  names its agent — an uppercase chip in the agent's brand color (Anthropic
  clay, OpenAI green) in the sidebar and replay header, and correct speaker
  labels in the replay and exports. The calendar can color blocks by
  project or by agent (a new toggle) — and whichever one fills the block,
  the other becomes its edge stripe, so a mixed week reads at a glance
  either way. Codex token
  accounting reads the per-response usage the logs record (cached input
  split out), so totals are exact; GPT model pricing isn't bundled yet, so
  costs show as estimates only if you add rates via `modelPricing` in
  settings.json.

### Fixed

- Controls sitting directly on the page background (the Spend and calendar
  header toggles, the calendar's arrows and "This week" pill) were nearly
  invisible in the light theme — they now use the card tone, like the
  header pills always have.

- A to-do list in a tool result showed no difference between the task being
  worked on and the ones still queued — the "in progress" row was meant to
  stand out and never did. The live task now reads in full ink, ahead of the
  pending ones and the faded, finished ones.

- A pass over the interface for small inconsistencies that had crept in:
  agent badges (CLAUDE, CODEX) were the only text in the app below the
  legible floor and are now a touch larger; every screen title is one size;
  the disk total is sized like the spend total it sits beside; inline
  `code` in the interface is one shape everywhere instead of four; the
  update-available banner lines up with the content beneath it; and hover
  timing is uniform across every control.

## [0.8.0] — 2026-07-29

### Added

- Search-anchored timeline: the search screen gains a hits | timeline toggle
  (`#/search?q=…&v=timeline`). Every matching session becomes a dot on a
  time axis — project-colored, sized by hit count, spanning first match to
  last with the gaps kept visible — and clicking one lands in that session
  at its first hit. Answers "when did this keep coming up?" over the FULL
  match set, not the truncated hit page (`GET /api/search/timeline`). Long
  ranges bucket by week.
- Context-window timeline: the replay's stats panel now draws how full the
  context window was at every response (input + cache tokens the index
  already holds), with the peak called out. Compaction boundaries are marked
  on the curve, listed as clickable jump chips, and flagged with a
  "compacted" chip on the spine turn where they happened — so "did it lose
  the plot after the compaction?" is one glance (`GET
  /api/sessions/:id/context`).
- Command palette: ⌘K / Ctrl-K anywhere opens a fuzzy switcher over your
  sessions — CC's own titles make them findable by name — plus screens and
  saved searches; anything typed is also one Enter away from a full-text
  search. `/` still focuses search.
- Files joined the query language: `path:api.ts` narrows any search to
  sessions that touched a matching file (combinable with everything else),
  and the Files screen gained the reverse — an "in sessions matching…"
  filter that keeps only files touched by matching work.
- Date operators take plain words now: `after:7d`, `after:yesterday`,
  `before:today` — alongside the ISO prefixes.
- Turns spent in plan mode wear a quiet "plan" chip on the spine — lifted
  from Claude Code's own mode records and plan-mode-exit markers.
- Deleted session files show up honestly everywhere, live: the health card
  counts files gone from disk the moment they vanish, disk-usage rows are
  marked "file gone", and pruning from the health card is the one way to
  forget them. The old "stays until index --rebuild" caveat is retired.
- Open a file in your editor straight from the diffs pivot or the Files
  screen. Configure once in settings.json — `"editorCommand": "code -g
  {path}"` — and the button appears; only files your sessions actually
  touched can be opened, and nothing runs through a shell.
- Your curation travels: `turnlog annotations export` writes pins, names,
  notes, bookmarks, and saved searches as one JSON file, and `… import`
  merges them back — machine moves and reinstalls stop losing them.
- A third export format for scripts: `turnlog export <id> --format json`
  (or `?format=json`) emits the normalized message stream for jq —
  same range and redaction options as the human formats.
- Keyboard shortcuts got a real home: press `?` anywhere for a cheat sheet
  (also reachable from the palette), and every shortcut hint in the app —
  tooltips included — now renders as proper keycaps next to the label
  instead of text like "(⌘F)". Modifier labels follow your platform (⌘ on
  macOS, Ctrl elsewhere). New chrome shortcuts: `B` toggles the sidebar,
  `T` switches the theme, and `⇧Q` stops Turnlog — pressed twice, the same
  arm-then-confirm two-step as the button.

### Improved

- Find in session is fully keyboard-driven: Enter jumps to the next match
  and ⇧Enter to the previous one, cycling from wherever you are.
- Counts and dates inside tooltips (lens counts, resume-chain part dates)
  now read as data — set off from the label in the monospace metadata
  style instead of run into the sentence.
- List rows everywhere (sidebar, home lists, spend splits, file history,
  and the replay's turn spine) dropped their hairline rules for rounded
  hover pills — the edge-to-edge lines that read as a table grid are gone
  and hovers are clean rounded washes. The home, search, spine, and log
  views also stopped centering at a fixed measure: content now uses the
  full window width.
- The home card's "See all" link is gone — the sidebar already is the
  see-all.
- Icon buttons speak one language: the last text "✕" buttons became real
  icons, the error/bookmark jump rails no longer stack a browser tooltip on
  top of the app's own, and the bookmark toggle uses the same tooltip pill
  as every other icon button.

## [0.7.0] — 2026-07-27

### Added

- Sessions now wear Claude Code's own title for the conversation: the name CC
  generates (or the one you set in CC) shows in the sidebar, replay header,
  exports, search results, and MCP listings instead of the bare project name.
  A Turnlog custom name still wins. Titles are searchable.
- The biggest unknown-record types are now understood (adapter v4, full
  reindex on first run): file and directory attachments render as chips with
  their path — and the paths are searchable — permission-mode switches show
  as quiet markers in the replay, and plan-mode entry/exit is visible. The
  health panel's unrecognized count now means actual format drift (~12% of
  events on a real corpus, down from ~35%; what remains is deliberate
  bookkeeping).
- Share panel: the replay header's three loose export buttons became one
  popover — pick markdown or web page, flip redaction on with the scrub list
  spelled out (nothing is scrubbed or kept silently), and export a turn
  range instead of the whole session. The API gains `from`/`to` message
  bounds on `GET …/export`, and the CLI gains `turnlog export --from --to`;
  partial exports are labeled "excerpt".
- Continue a session from Turnlog: a play button in the replay header copies
  the ready-to-paste `cd <project> && claude --resume <id>` command. For a
  resumed conversation it targets the latest part — the one that carries the
  whole history.
- Index maintenance on the home screen's health card: "forget deleted files"
  drops index rows for session logs that no longer exist (the watcher sees
  writes, not deletions), and "repack index" reclaims the space afterwards.
  Your pins, names, and notes survive both — if a file comes back, so do
  they. Turnlog still only ever writes to its own index.
- Your annotations joined the search language: `is:pinned` and `has:note`
  narrow to sessions you flagged, `has:bookmark` matches the exact moments
  you bookmarked — combinable with text and every other operator, in the UI,
  the CLI, and MCP. Saved searches over them make living collections.

### Fixed

- Interrupting Claude and retyping no longer leaves a ghost turn. The first,
  abandoned attempt used to replay as a normal turn and count in the spine;
  it now folds into an "abandoned attempt" marker you can open — the
  conversation reads as what actually happened, with the road not taken still
  one click away.
- Spend no longer double-bills resumed conversations. Resuming a session
  copies its whole history into the new file, so a 3-part chain's shared
  prefix used to count 3× in every spend number. Money and tokens now count
  each message once per conversation — on the day it actually ran; session
  counts are unchanged. Estimates you can trust, slightly smaller and
  honest.

## [0.6.0] — 2026-07-26

### Added

- Resume chains stitched together: resuming a session into a new file used to
  show up as a near-duplicate row. Parts of one conversation are now linked
  (they share their opening message), the sidebar lists only the latest part
  with a badge showing the part count, and the replay header gains
  part-by-part navigation. Served by `GET /api/sessions/:id/chain`; the
  session list accepts `chains=collapse`.
- Subagent transcripts nested in replay: Task runs that newer Claude Code
  logs to separate files (`<session>/subagents/`) now appear inside the
  parent replay, folded under the Task call that spawned them and loaded when
  expanded — same as inline subagent runs. Served by
  `GET /api/sessions/:id/children`.
- UI preferences survive restarts: theme, sidebar visibility, hide-empty,
  spine/log choice, and dismissed update notices now live in the local index
  (`GET`/`POST /api/prefs`) instead of the browser — the random per-launch
  port gave the browser a fresh localStorage every run, resetting them.
- After an update, the header status dot wears a yellow ring until you open
  What's New once; the page itself clears it.
- Index health panel on the home screen: how many session files and events
  are indexed, the on-disk index size, any files the last scan could not
  read (with the reason), and a count of unrecognized record types — which
  Turnlog keeps raw rather than dropping, so a Claude Code format change
  shows up here as a number instead of as silent data loss. Served by
  `GET /api/health`.
- Static HTML export: every session can now leave as one self-contained,
  styled web page — dark/light theme, prompts and replies as cards, tool
  calls as collapsible details, diffs colored. Nothing in the file loads
  from the network. Available as a new download button in the replay header,
  `turnlog export <id> --html` in the terminal, and
  `GET /api/sessions/:id/export?format=html`.
- Redaction for exports: pass `--redact` (CLI) or `redact=1` (API) to scrub
  API-key-shaped tokens, JWTs, `key=value` secrets, email addresses, and
  home-directory paths from an export before sharing it — both the markdown
  and HTML formats.

## [0.5.0] — 2026-07-24

### Added

- MCP server mode: `turnlog mcp` serves your session history to Claude Code
  (or any MCP client) as read-only agent memory over stdio — five tools:
  `search` (with operators), `list_sessions`, `get_session`, `get_messages`,
  and `file_history`. Register with
  `claude mcp add turnlog -- npx turnlog mcp`. No network, no writes; reads
  the same index the app builds, with a quick incremental catch-up on start.
- Message bookmarks: hover any block in a replay and mark the moment — a
  bookmark toggle in the left gutter, stored in the local index (schema v6,
  survives rebuilds), with a yellow jump rail beside the error rail to cycle
  between marks. Served by token-guarded `GET`/`POST`
  `/api/sessions/:id/bookmarks`.
- Disk usage view: a third tab under Spend ranks sessions by on-disk bytes
  (subagent transcript files rolled into their parent) with a relative-size
  bar and a reveal-in-file-manager button per row. Turnlog stays read-only —
  deleting is yours to do in the file manager.
- `turnlog search <query>`: search from the terminal with the same operators
  as the UI; hits grouped by session with highlighted matches, `--limit` and
  `--json` flags, and — when the local server is running — a deep link per
  session that opens the UI at the first match. The running server records
  its URL in `server.json` next to the index (0600, removed on shutdown) to
  make those links resolvable.

### Fixed

- The Spend header (title, tabs, period picker, filter, export) scrolled
  away with the content; it now stays pinned while the body scrolls.

## [0.4.0] — 2026-07-24

### Added

- Search operators: narrow any query with `tool:Bash`, `kind:prompt`,
  `is:error`, `project:name`, `model:opus`, `before:2026-07`, `after:2026-01`
  — combinable with text terms or usable alone. An always-visible cheat-line
  under the search box lists them.
- Saved searches: save the current query under a name; saved searches show
  as chips under the search box, one click re-runs, deletable. Stored in the
  local index database (survives rebuilds).
- Cross-session file history: a new Files screen (header pill) — filter by
  path, pick a file, and see every session that ever touched it, newest
  first; expanding a session shows its edits to that file with
  view-in-session jumps. The replay's diffs pivot links each file to its
  history.
- What's New page: in-app release notes in plain language at `#/whats-new`,
  opened from the status dot in the header. Notes ship inside the package —
  nothing is fetched.
- A find-in-session button in the replay toolbar (same as ⌘F).

### Changed

- The diffs lens now opens as the per-file pivot (the former files view):
  touched files with edit/failure counts on the left, that file's edits in
  order on the right, each with a view-in-session jump — instead of a
  chronological filtered log.
- The header's search input is now a circle button (before the theme
  toggle) that opens the search screen; the `/` shortcut goes there too and
  the search input autofocuses.
- The active lens now reads as the contrast surface, matching the sidebar's
  toggle states; the What's New entry highlights like the header pills while
  open; error prev/next buttons are properly centered with consistent icon
  sizes.

## [0.3.1] — 2026-07-23

### Added

- Stop Turnlog from the browser: a power button in the header (click twice —
  it arms first) shuts the CLI process down cleanly and closes the tab where
  the browser allows it, leaving a farewell card with a copyable
  `npx turnlog` to start again. Backed by a new token-guarded
  `POST /api/shutdown` route that only exists when the CLI wires it up.
- Spend periods `1y` and `all` (all-time) alongside 7/30/90 days; the chart
  axis starts at your first recorded day instead of zero-filling empty
  history.

### Changed

- The hide-empty-sessions toggle is now a circular eye button next to the
  sort direction control, matching the sidebar's other controls; the eye
  reflects the state (open = empty sessions shown, closed = hidden) instead
  of always showing a closed eye. Both sidebar toggles now center their
  icons properly and use the same icon size as the replay actions.
- Session notes surface as a tiny tilted sticky-note marker — on sidebar
  rows and in the replay header's meta line — and hovering (or focusing) it
  opens the note as a yellow folded-corner paper block. Replaces the inline
  note text under the replay title.
- Pinned sessions get a note-yellow row wash in the sidebar, so the pinned
  block on top is visible at a glance.

### Fixed

- The note editor's textarea fell back to the browser's monospace default;
  both annotation fields now use the app font.

### Removed

- The replay's "files" view — it drew from the same data as the diffs lens,
  so the view toggle is back to spine · log and per-file browsing happens
  through the diffs lens. `?v=files` deep links fall back to the default
  view.

## [0.3.0] — 2026-07-22

The first minor since the relaunch: sessions become annotatable. The index
database gains a schema migration (v4, automatic, no reindex) and the local
server gains its first — and only — two write endpoints.

### Added

- Pin sessions: a pin control on every sidebar row (hover) and in the replay
  header keeps chosen sessions at the top of the list, whatever the sort.
  Pinned sessions are never hidden by the hide-empty filter.
- Custom names and notes: the pen button in the replay header opens a small
  editor; a custom name replaces the session's title everywhere (sidebar,
  replay, search, calendar, home), and the note shows under the replay
  header. Pins, names, and notes live in the local index database and
  survive reindexes and rebuilds.
- "Show in file manager": a folder button in the replay header reveals the
  session's JSONL file in Finder / Explorer / your file manager.
- The server grew a minimal write surface for the above — exactly two
  token-guarded POST routes; everything else remains GET-only, and the
  hardening tests now cover the write paths too.

### Changed

- The sidebar is a little wider (324 → 356px), and its controls breathe
  again: the session count sits with the project filter, the sort row keeps
  a smaller direction toggle, and the hide-empty filter is now a labeled
  chip on its own filters row (was an unlabeled eye icon).
- The replay header is one compact block: the left side stacks the title,
  an id · model · date subline, and the session note (clamped to two
  lines); the right side stacks the spine|log|files toggle plus the lens
  filters — now icon buttons in their legend colors with count tooltips —
  over the secondary actions (pin, edit, reveal, copy, download, stats).
  Long custom names ellipsize instead of wrapping.
- One gutter rhythm everywhere: the gaps between the screen edges, the
  sidebar, the replay header, and the content cards are all the sidebar's
  14px floating inset (screens were padded 28px horizontally before).
- README: the example startup output uses a `<version>` placeholder and the
  header carries a live npm version badge, so the docs never trail releases.

### Fixed

- The hide-empty-sessions filter now actually catches real-world empties:
  it hides sessions that read zero on either axis (no turns *or* no
  tokens), not only the both-zero case — prompt-only session files with no
  assistant response were slipping through. Sessions with recorded cost are
  never hidden (old Claude Code versions logged cost without token counts).

## [0.2.7] — 2026-07-22

### Added

- Empty sessions (0 turns and 0 tokens) can be hidden: an eye toggle in the
  sidebar next to the sort direction, remembered across launches. The filter
  applies everywhere sessions are listed — the sidebar and both calendar
  views.

### Changed

- UI consistency pass: one emphasis weight (600) everywhere bold appeared,
  uppercase label tracking unified, stray gaps and radii snapped to the
  spacing scale, the search screen input matched to the hero input, and the
  last hardcoded whites replaced with theme tokens (new `--tile-on`).

## [0.2.6] — 2026-07-22

### Changed

- The sidebar sort dropdown now lists "by activity" first, matching the
  default sort order.
- README: the example startup output no longer shows an old version.

## [0.2.5] — 2026-07-21

### Changed

- Republished to npm. The package was fully unpublished from the registry
  on 2026-07-20; npm permanently retires every previously published version
  number, so the return required a new version. Functionally identical
  to 0.2.4.

## [0.2.4] — 2026-07-11

### Changed

- New UI typeface: Geist + Geist Mono (variable fonts, still bundled —
  nothing loads from the network), matching turnlog.dev. The smallest
  text sizes are raised roughly a point across the app — metadata rows,
  labels, chips, and calendar block text are no longer sub-11px.
- The browser-tab icon now matches the turnlog.dev mark (vermilion
  rounded square, white log lines) instead of the old dark/amber one.

## [0.2.3] — 2026-07-10

### Changed

- The session sidebar is now a floating card (rounded on all four sides,
  inset from the edges) that slides open and closed; while open it carries
  the sidebar toggle and the Turnlog brand, which return to the header when
  closed.
- The sidebar defaults to sorting by activity — the most recently active
  session first.
- Text arrows (`← → ↑ ↓`) replaced with proper icons everywhere: Solar
  chevrons for the replay back button, error/match navigation, and calendar
  prev/next; Solar sort-vertical for the sidebar sort direction (mirrors to
  show ascending/descending).
- Micro-interactions pass: buttons ease on hover and press down on click,
  tooltips fade-slide in from their anchor side, sidebar open/close animates.
- The icon set is now 100% Solar (CC BY 4.0): the four hand-authored stand-ins
  (copy, download, chart, check) replaced with vendored Solar path data, and
  every icon annotated with its exact solar:* name.

## [0.2.2] — 2026-07-10

### Added

- Sidebar: sort "by activity" (most recently active session first) and a
  pulsing dot on sessions active within the last five minutes — together with
  live updates, the running session is always one glance away.
- Calendar tooltips (week blocks and month cells) now include token usage.

### Fixed

- Tooltips near the right viewport edge (index status, late-day calendar
  blocks) no longer squeeze to the trigger's width and wrap word-by-word —
  the pill now sizes to its content.

## [0.2.1] — 2026-07-09

### Added

- Spend chart: a daily | weekly toggle — weekly buckets group into
  Monday-start calendar weeks, with range tooltips.
- Token usage surfaced where money already was: session rows in the sidebar
  show total tokens, the spend headline shows the period's token total, and
  the session list can sort by tokens.
- Live updates, pushed: a dependency-free SSE stream (`GET /api/events`,
  token-guarded like every API route) notifies the UI the moment the watcher
  reindexes a changed session file — list, replay spine, stats, and spend
  refresh in about a second. The status poll remains as a fallback, and the
  spine's old 7-second blind poll is gone.

### Changed

- Calendar week view transposed into a timeline: days are now rows and time
  runs across, so sessions read as horizontal blocks with the project name
  and cost inline. Same trimmed hour window, overlap lanes, tooltips, and
  today treatment as before.

### Fixed

- Spend chart zero-fill now uses local calendar days, matching the server's
  local-time day buckets (the 0.2.0 change left the client generating UTC
  keys, misplacing bars for anyone not on UTC), and is DST-safe.

## [0.2.0] — 2026-07-09

### Fixed

- **Cost and token estimates were roughly 2.5–3× too high.** Claude Code writes
  one JSONL line per content block of a response, and every line repeats the
  same `message.id` with an identical usage object — Turnlog summed them all.
  Usage is now counted once per API response. Existing indexes rebuild
  automatically on the next launch.
- Sonnet 5 usage recorded before 2026-09-01 is priced at the introductory rate
  ($2/$10 per MTok) instead of the sticker rate.
- Legacy Opus 4.0 pricing now also matches Vertex-form model ids
  (`claude-opus-4@20250514`).
- Sessions no longer display `<synthetic>` (Claude Code's placeholder for
  locally generated messages) as their model.
- Moving or copying a project directory mid-session no longer corrupts
  incremental indexing when the same session id appears under two paths — the
  newest file wins, older copies are skipped.
- Invalid numeric query parameters return 400 instead of 500.

### Added

- Subagent transcripts (`<project>/<session>/subagents/*.jsonl`, written by
  newer Claude Code versions) are indexed: their content is searchable and
  their usage counts toward the parent session's totals. They stay out of the
  session list; search hits inside them attribute to the parent session.

### Changed

- Injected-context records (`isMeta`) are classified as meta instead of user
  prompts — they no longer create false turns in the spine, show up in the
  prompts lens, or leak into markdown exports.
- Spend view: daily buckets use the machine's local calendar day (was UTC), and
  the per-model split is attributed per message, so sessions that mix models
  (subagents, mid-session model switches) split correctly.

## [0.1.0] — 2026-07-08

Initial public release.

- `npx turnlog` starts a localhost-only server and opens a React web UI.
- Full-text search (SQLite FTS5) and session replay over `~/.claude/projects/`
  JSONL logs — turn spine, lenses, in-session find, files outcome pivot.
- Incremental indexing with live file watching; crash-free parsing of
  undocumented log formats (unrecognized records are kept, never dropped).
- Markdown export (`turnlog export <id>` and copy-as-markdown).
- Spend view with daily rollups and model/project splits, priced from a
  shipped table (all costs are labeled estimates).
- Localhost hardening: loopback-only bind, Host/Origin validation, per-launch
  session token, no CORS. 100% local — no telemetry, no accounts; the only
  network touch is an opt-out-able npm update check.

[0.2.4]: https://github.com/turnlog/turnlog/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/turnlog/turnlog/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/turnlog/turnlog/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/turnlog/turnlog/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/turnlog/turnlog/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/turnlog/turnlog/releases/tag/v0.1.0
