# Turnlog

Search and replay every Claude Code agent session you've ever run — locally. A paid, standalone npm CLI (`npx turnlog`) that starts a localhost-only server, indexes `~/.claude/projects/` JSONL logs into SQLite + FTS5, and opens a React web UI for full-text search and session replay.

The full product spec, strategy, and rationale live in `docs/turnlog-deep-dive.md`. Read it before making architectural decisions — most big questions are already settled there. Key locked decisions:

- **Distribution is npm CLI + local web UI** — never an Electron app, no code signing, no installers. npm is the update channel.
- **100% local, no telemetry, no accounts.** The app never phones home. This is the brand promise; nothing may violate it. The single optional network touch is a CLI update-available check (opt-out-able) — nothing else.
- **Name is Turnlog.** "Claude" may appear in marketing copy ("for Claude Code") but never in product or package names. Lead all copy with *search and replay*, never "logs."
- **Licensing is offline Ed25519 signed keys**, honor-system 2-machine term, blocklist shipped inside npm releases. Public key embedded in the package; private key lives only in a Cloudflare Worker. Trial gating is stateless: only the 10 newest sessions are openable unlicensed.
- **Payments via Paddle** (merchant of record), keygen in a CF Worker — the only server component, and the app never depends on it.

## Stack

- **CLI/server:** Node 20+, TypeScript. Server binds 127.0.0.1 only, serves the built React bundle + JSON API.
- **Indexer:** worker thread (or child process) — JSONL parsing and SQLite writes must never block the API.
- **Data:** better-sqlite3, WAL mode, single writer. FTS5 with `unicode61 tokenchars '_$.'` + `prefix='2 3'`. Message text stored in the DB. Incremental indexing via per-file byte offsets. DB in `~/.config/turnlog/` (XDG on Linux, `%APPDATA%` on Windows).
- **Frontend:** React + TypeScript + Vite, shipped prebuilt inside the npm package. React Query over the local API. react-virtuoso for session lists (virtualization is mandatory), Shiki in a web worker for highlighting.
- **Packaging:** single npm package. No postinstall scripts, ever. Publish with `--provenance` from GitHub Actions on tag.

## Hard rules

- **Localhost hardening is v1 scope, not optional:** loopback-only bind, random high port, validate `Host`/`Origin` headers against localhost (DNS-rebinding defense), random session token in the opened URL required on every API request, no CORS headers.
- **Parser cardinal rule: never crash, never drop.** Claude Code's JSONL format is undocumented and changes without notice. Unrecognized records are stored with `kind='unknown'` + `raw_json` and rendered as collapsed "unrecognized event" rows. Format churn must be a cosmetic bug, not data loss.
- **Parser architecture:** `RawLine → VersionSniffer → AdapterVN → NormalizedRecord`. Adapters are pure functions in one directory; snapshot-test the whole corpus with golden files. Stream-parse JSONL (sessions run 50–500MB) — never `JSON.parse` a whole file.
- **Threading is a `parentUuid` chain**, not a flat array — branches exist. Sidechain records are subagent runs, rendered as nested collapsible threads. `tool_use` pairs with `tool_result` by ID; results can be enormous — collapse by default.
