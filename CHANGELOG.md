# Changelog

All notable changes to Turnlog are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
