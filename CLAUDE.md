# Turnlog

Search and replay every Claude Code agent session you've ever run — locally. A free, MIT-licensed npm CLI (`npx turnlog`) that starts a localhost-only server, indexes `~/.claude/projects/` JSONL logs into SQLite + FTS5, and opens a React web UI for full-text search and session replay.

The design/strategy docs live in a **separate documentation repo**, not in this repo — `../documentation/turnlog/` (`turnlog-deep-dive.md`, `roadmap.md`, `design-system.md`, `landing-prd.md`, `turnlog-feature-brainstorm.md`). The full product spec, strategy, and rationale live in `../documentation/turnlog/turnlog-deep-dive.md`. Read it before making architectural decisions — most big questions are already settled there (note: its paid-model sections are historical; Turnlog is now free/MIT). Key locked decisions:

- **Distribution is npm CLI + local web UI** — never an Electron app, no code signing, no installers. npm is the update channel.
- **100% local, no telemetry, no accounts.** The app never phones home. This is the brand promise; nothing may violate it. The single optional network touch is a CLI update-available check (opt-out-able) — nothing else.
- **Name is Turnlog.** "Claude" may appear in marketing copy ("for Claude Code") but never in product or package names. Lead all copy with *search and replay*, never "logs."
- **Free and open source (MIT).** No accounts, license keys, trial gate, or payment path — index and open every session with no limits. Turnlog began as a paid product; the originally-planned offline Ed25519 licensing, Paddle payments, and Cloudflare Worker keygen were all dropped. Treat any lingering references to them in the `documentation` repo as historical — the code no longer has a trial gate or `licensed` flag.

## Repo layout & commands

Phases 1 (parser, index, server core), 2 (React viewer UI), and Phase 3's export + packaging polish are implemented; the originally-planned licensing + CF Worker were dropped when Turnlog went free/MIT — see `../documentation/turnlog/roadmap.md` for status checkboxes.

- `src/parser/` — streaming line reader with byte offsets, `normalize.ts` (sniffer + cardinal-rule wrapper), `adapters/v1.ts` (pure function, raw record → `NormalizedRecord`)
- `src/indexer/` — SQLite schema (`db.ts`), incremental `Indexer`, worker-thread driver (`workerDriver.ts` + `worker.ts`), in-process driver for tests/CLI, chokidar watcher
- `src/server/` — hardened `node:http` server, typed API (`api.ts` + `apiTypes.ts`, the contract the web UI imports type-only), serves `web/dist`
- `src/cost/pricing.ts` — shipped pricing table; cache writes priced by TTL breakdown (1.25× 5m / 2× 1h)
- `src/export/markdown.ts` — session → markdown serializer (deep-dive §2.5); dependency-free (minimal ±line diffs, no diff lib in the server). Used by `turnlog export <id>` and `GET /api/sessions/:id/export`
- `web/` — npm workspace: Vite + React viewer. Visual language (full-bleed bento, tokens, component rules) is documented in `../documentation/turnlog/design-system.md` — read it before touching UI; tokens live in `web/src/theme.css`, dark + light via `data-theme`. Screens: home (hero + bento), session sidebar zone, replay (turn spine default · log · files outcome pivot; lenses via `?l=`, views via `?v=`, in-session find via `?q=`), search. `web/src/replay/thread.ts` builds display blocks (tool_use/result folding, sidechain runs nested under Task calls); `web/src/replay/raw.ts` re-parses `raw` JSONL tolerantly (UI half of the cardinal rule — degrade, never throw); Shiki runs in a web worker with a lang whitelist + size cap. Instrument Sans + Fira Code woff2 bundled in `web/public/fonts/`, Solar outline icons vendored as path data in `web/src/icons.tsx` (CC BY 4.0 — credits in `web/public/CREDITS.txt`) — nothing ever loads from the network.
- `fixtures/corpus/` — synthetic fake projects dir; `fixtures/golden/` — committed normalization snapshots
- `test/` — vitest; `bin/turnlog.cjs` — plain-CJS Node-version-guard shim

Commands: `npm test` · `npm run typecheck` (server + web) · `npm run lint` · `npm run build` (server tsc + web bundle) · `npm run golden:update` (regenerate goldens after an adapter change — review the diff, that's the point of them). Smoke test against real data without touching the user's config: `TURNLOG_DATA_DIR=<scratch> node bin/turnlog.cjs index` (reads `~/.claude/projects`, writes the index to the scratch dir). UI dev loop: `npm run dev` (one command: builds the server, boots API + Vite with a shared token, Ctrl-C stops both; `scripts/dev.mjs`). The Vite proxy injects the token and rewrites Host (`changeOrigin` — the DNS-rebinding defense rejects the dev origin's port otherwise). `TURNLOG_FAKE_UPDATE=x.y.z` seeds a fake newer version so the CLI line + web update banner render without a published release.

Conventions: any adapter change ships with corpus fixtures + regenerated goldens. Bump `ADAPTER_VERSION` in `src/version.ts` when normalization output changes — it forces a full reindex. Every user-visible change gets a line under `[Unreleased]` in `CHANGELOG.md` (Keep a Changelog format); retitle that section to the version when tagging a release. The server-hardening tests in `test/server.test.ts` are load-bearing; never weaken them. Note: `fetch` can't forge a Host header (undici strips it) — hardening tests must use raw `http.request`.

## Stack

- **CLI/server:** Node 22+ (20 is EOL and better-sqlite3 ≥12.10 ships no prebuilds for it), TypeScript, ESM. Server is bare `node:http` (chosen over Fastify — zero runtime deps beyond better-sqlite3 + chokidar), binds 127.0.0.1 only, serves the built React bundle + JSON API.
- **Indexer:** worker thread (or child process) — JSONL parsing and SQLite writes must never block the API.
- **Data:** better-sqlite3, WAL mode, single writer. FTS5 with `unicode61 tokenchars '_$.'` + `prefix='2 3'`. Message text stored in the DB. Incremental indexing via per-file byte offsets. DB in `~/.config/turnlog/` (XDG on Linux, `%APPDATA%` on Windows).
- **Frontend:** React + TypeScript + Vite, shipped prebuilt inside the npm package. React Query over the local API. react-virtuoso for session lists (virtualization is mandatory), Shiki in a web worker for highlighting.
- **Packaging:** single npm package. No postinstall scripts, ever. Publish with `--provenance` from GitHub Actions on tag.

## Hard rules

- **Localhost hardening is v1 scope, not optional:** loopback-only bind, random high port, validate `Host`/`Origin` headers against localhost (DNS-rebinding defense), random session token in the opened URL required on every API request, no CORS headers.
- **Parser cardinal rule: never crash, never drop.** Claude Code's JSONL format is undocumented and changes without notice. Unrecognized records are stored with `kind='unknown'` + `raw_json` and rendered as collapsed "unrecognized event" rows. Format churn must be a cosmetic bug, not data loss.
- **Parser architecture:** `RawLine → VersionSniffer → AdapterVN → NormalizedRecord`. Adapters are pure functions in one directory; snapshot-test the whole corpus with golden files. Stream-parse JSONL (sessions run 50–500MB) — never `JSON.parse` a whole file.
- **Threading is a `parentUuid` chain**, not a flat array — branches exist. Sidechain records are subagent runs, rendered as nested collapsible threads. `tool_use` pairs with `tool_result` by ID; results can be enormous — collapse by default. Newer CC also writes Task subagent transcripts to separate files (`<project>/<session>/subagents/*.jsonl`) — indexed as child sessions (`sessions.parent_session_id`), hidden from lists, rolled into the parent's aggregates.
- **Usage counts once per API response, never per line.** CC writes one JSONL line per content block; every line repeats the same `message.id` and the same `usage` object. The indexer zeroes duplicate lines' usage (cost NULL) via `messages.message_id` — summing per line inflates costs ~2.7×. `isMeta:true` user records are kind `'meta'`, not prompts.
