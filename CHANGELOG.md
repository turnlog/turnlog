# Changelog

All notable changes to Turnlog are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.2.0]: https://github.com/turnlog/turnlog/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/turnlog/turnlog/releases/tag/v0.1.0
