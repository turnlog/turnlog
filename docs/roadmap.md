# Turnlog — Implementation Roadmap

Engineering plan derived from `turnlog-deep-dive.md`. Six weeks part-time, hard timebox. Phases are in strict implementation order — each phase's output is the next phase's input. External dependencies (Paddle review, name claims) start on day one because their latency is outside our control.

Timeline map: Phase 0 = days 1–3 · Phase 1 = weeks 1–2 · Phase 2 = weeks 2–4 · Phase 3 = weeks 4–5 · Phase 4 = weeks 5–6.

---

## Phase 0 — Claims, keys, corpus (days 1–3)

Nothing here is code, but all of it gates later phases: the name gates the package, Paddle gates selling, the keypair gates licensing, the corpus gates the parser.

- [ ] **Claim the name** (npm was available at check time; it will not stay that way):
  - [ ] `npm publish` a 0.0.1 placeholder for `turnlog` (2FA enabled on the npm account)
  - [ ] Register `turnlog.dev`
  - [ ] Claim GitHub org (`turnlogdev`/`turnlogapp` — bare name is squatted) and X handle
  - [ ] 10-minute EUIPO class check on turnLOG® (§0.2 of deep-dive)
- [ ] **Submit Paddle seller application** — longest external dependency. Requires a live landing-page skeleton first: single static page on `turnlog.dev` (tagline, screenshot placeholder, price, privacy statement).
- [ ] **Generate Ed25519 keypair.** Private key → Cloudflare Worker secret + one offline backup. Public key → will be embedded in the package. Losing the private key = reissuing every customer.
- [ ] **Build the test corpus:** own `~/.claude/projects/` (scrubbed) into a private fixtures repo + donated JSONL files from 3–5 devs on different Claude Code versions/OSes. The parser is only as good as this corpus.
- [ ] 30-minute competitive re-scan (GitHub/X) — the space moves monthly.
- [ ] Optional hedge: email Polar re: Armenia payouts.

**Exit:** name claimed everywhere, Paddle application in review, keypair backed up, corpus repo has ≥3 CC versions represented.

---

## Phase 1 — Parsing, index, server core (weeks 1–2)

The product's foundation and its hardest problem (the parser). No UI yet — everything verifiable via tests and a throwaway JSON endpoint.

### 1.1 Repo & CLI scaffold

- [x] Single npm package layout: `src/cli/`, `src/server/`, `src/indexer/`, `src/parser/`, `src/parser/adapters/`, `web/` (Vite app), `fixtures/` (corpus submodule or copy)
- [x] TypeScript strict, ESLint, Vitest; Node 20+ `engines` field
- [x] CLI entrypoint with subcommands: `turnlog` (start + open browser), `turnlog index --rebuild`, `turnlog export <id>`, `turnlog license <key>` (stubs OK for the last two)
- [x] Node version guard at startup with a friendly error — the one remaining "installer" bug class
- [x] Config/data dir resolution: `~/.config/turnlog/` (XDG on Linux, `%APPDATA%` on Windows)

### 1.2 Localhost server + hardening (v1 scope, not optional — §1.1)

- [x] Bare `node:http` (chosen over Fastify — zero extra deps); serves static frontend bundle + JSON API
- [x] Bind **127.0.0.1 only**, random high port
- [x] Validate `Host` and `Origin` headers against localhost; 403 otherwise (DNS-rebinding defense)
- [x] Random session token generated at startup, embedded in the opened URL, required on every API request
- [x] No CORS headers (same-origin only)
- [x] Tests that actually exercise each rejection path

### 1.3 Parser pipeline — where the product lives (§2.3)

- [x] Streaming JSONL reader (readline over fs stream — sessions run 50–500MB, never whole-file `JSON.parse`)
- [x] `RawLine → VersionSniffer → AdapterVN → NormalizedRecord` architecture; adapters as pure functions in one directory
- [x] Normalized model: threading from `parentUuid` chains (branches exist), flattened to display order; sidechain records marked as subagent runs; `tool_use`/`tool_result` paired by ID
- [x] **Cardinal rule wired in from the first line:** unrecognized records → `kind='unknown'` + `raw_json`, never crash, never drop
- [x] Golden-file snapshot tests over the whole corpus (raw → normalized); upgrades become diff-reviewable
- [x] Cost computation: shipped model pricing table + user override in settings; labeled as estimates

### 1.4 SQLite index (§2.2)

- [x] better-sqlite3, WAL, `synchronous=NORMAL`, single writer
- [x] Schema: `sessions`, `messages`, `files_touched`, `messages_fts` (FTS5 external-content, `unicode61 tokenchars '_$.'`, `prefix='2 3'`)
- [x] Message text stored in the DB (replay must survive moved/deleted source logs)
- [x] Incremental indexing: `(file_path, last_byte_offset, mtime, size)` per file; append-only fast path; full reindex only on shrink or adapter version bump
- [x] Indexer runs in a worker thread — parsing and writes never block the API
- [x] chokidar watcher with debounce for live sessions
- [ ] CI matrix verifying better-sqlite3 prebuilds: macOS arm64/x64, Windows, Linux

### 1.5 API layer

- [x] Typed JSON API: list sessions (sort/filter), get session (paged messages), search (FTS5 with `highlight()` snippets, grouped by session), stats
- [x] Search endpoint returns jump-to-context data (message idx + match offsets) for Phase 2's navigation

**Exit criteria:** 2GB projects dir fully indexed in a couple of minutes; startup catch-up on a warm index feels instant; search <50ms; live session updates within seconds; corpus snapshot suite green on all CI platforms.

**Status 2026-07-05 — Phase 1 code complete.** 63 tests green. Measured on a real 280MB / 89-session `~/.claude/projects`: cold index 4.9s (extrapolates to ~35s for 2GB), warm catch-up 0.28s, search 0.6–27ms. Implementation decisions worth knowing: one message row per JSONL line (tree flattening is a Phase 2 renderer concern); a trailing line without newline is consumed only if it parses as complete JSON (mid-write safety); cache-write cost uses the 5m/1h TTL breakdown present in real logs; real CC 2.1.x already emits five record types beyond the documented set (`ai-title`, `attachment`, `last-prompt`, `mode`, `queue-operation`) — all land as `kind='unknown'` as designed. Remaining: CI matrix goes green on first push.

---

## Phase 2 — Viewer UI (weeks 2–4)

React + TS + Vite in `web/`, React Query over the local API, built bundle shipped inside the package. Reuse Reikon design tokens/components internally (code reuse, not brand coupling).

### 2.1 Library screen

- [ ] Session list: sortable/filterable by date, project, cost, duration
- [ ] **Trial treatment designed now, not bolted on:** unlicensed mode shows the full library, only the 10 newest sessions openable; older rows visibly locked but showing metadata (date, project, cost)

### 2.2 Replay screen

- [ ] react-virtuoso list (variable heights, reverse scroll); memoized rows
- [ ] Threaded turns from the parent chain; tool calls collapsed by default (results can be enormous)
- [ ] Sidechain/subagent runs as nested collapsible threads under the spawning tool call — hard rendering problem, real differentiator
- [ ] Diff rendering: normalize Edit/Write tool records to unified diff, small custom component (side-by-side is v1.5)
- [ ] Shiki in a web worker: lazy, on-demand as rows become visible, language whitelist (ts/js/tsx/py/go/rust/json/bash/diff), size cap per block with "highlight anyway"

### 2.3 Search screen — the demo GIF; polish beyond reason

- [ ] Query → results grouped by session with `highlight()` snippets
- [ ] Click → session opened scrolled to the hit; prev/next match navigation
- [ ] Keyboard-first: focus search on open, arrow through results

### 2.4 Stats

- [ ] Per-session stats panel: tokens, cost, duration, files touched, tool usage

**Exit criteria:** a 5,000-turn session scrolls at 60fps; you personally use Turnlog daily instead of grep.

---

## Phase 3 — Licensing, backend, packaging (weeks 4–5)

Turns the working tool into a sellable product. Depends on Phase 0's keypair and Paddle approval.

### 3.1 Licensing (offline Ed25519 — §3.2–3.5)

- [ ] Key verification (~20 lines, Node `crypto.verify`) against the embedded public key; license stored at `~/.config/turnlog/license`
- [ ] `turnlog license <key>` CLI command + paste flow in web UI settings
- [ ] "Licensed to buyer@x.com" in UI footer/About (the anti-sharing mechanism)
- [ ] Trial gate: pure function of data on disk — 10 newest sessions openable, zero stored trial state
- [ ] Blocklist JSON shipped inside each npm release, checked locally at verification time
- [ ] `major` field honored: v1.x accepts `major >= 1`

### 3.2 Cloudflare Worker (the only server component; the app never depends on it)

- [ ] Paddle `transaction.completed` webhook → verify Paddle signature → generate signed key → store `{lid, email, key}` in KV → key in receipt email
- [ ] Lost-key page: purchase email → KV lookup → resend, rate-limited
- [ ] Refund webhook → flag lid revoked → enters blocklist in next release
- [ ] Total budget: one Worker, one KV namespace, one email template, ~200 lines

### 3.3 Export (§2.5)

- [ ] Markdown serializer over the normalized model: prompts as blockquotes, assistant prose verbatim, tool calls as `<details>`, diffs as fenced ```diff
- [ ] Footer attribution link on by default, plainly removable in settings
- [ ] "Copy session as markdown" (clipboard is how it spreads) + `turnlog export <id>` for scripting

### 3.4 Packaging & hardening polish

- [ ] **No postinstall scripts** (trust smell); `--help` that doesn't embarrass; friendly first-run output
- [ ] Release pipeline: tag → GitHub Actions → build frontend → corpus snapshot tests → `npm publish --provenance`
- [ ] Optional update-available notice for global installs (version compare against registry — opt-out-able and documented, or skipped for purity)
- [ ] Crash-free filesystem edges: permissions errors, symlinks, iCloud-offloaded files, 0-byte JSONLs, mid-write partial lines

**Exit criteria:** full buy → key email → paste → licensed flow works end to end against Paddle sandbox; `npx turnlog` from a clean machine reaches a working UI in under 30 seconds.

---

## Phase 4 — Beta & launch (weeks 5–6)

- [ ] **Private beta:** 5–10 heavy Claude Code users. Their weird JSONL files are the real QA — expect at least one adapter fix. Corpus grows with every donation.
- [ ] **Landing page:** 30s screen recording above the fold; 20s GIF for social; `npx turnlog` with copy button as the primary CTA (the install command *is* the funnel); pricing ($19–24, launch week $15–17, time-boxed and public); privacy statement ("localhost-only — verify with lsof, here's how"); FAQ
- [ ] **SEO pages live and indexed before launch day** (§7.3): where CC stores history, reading JSONL files, searching conversation history, export to markdown, cost per session, resuming old sessions — 400-word honest answers including the free/manual way
- [ ] **Docs:** install (`npx turnlog` — the whole thing), supported CC versions, log locations, troubleshooting
- [ ] **Team pack SKU** in Paddle: 5 keys ≈ $79
- [ ] **Edge analytics** (no in-app telemetry, ever): npm download counts, Cloudflare Web Analytics on landing, Paddle conversion — enough to compute the kill criterion (<2% trial→paid after experiments)
- [ ] **Launch sequence:** soft-launch to beta list at launch price → Show HN Tue–Thu ~8–10am ET (stay in the thread all day) → r/ClaudeAI + X same week → Product Hunt week 2–3 → directory pitches over two weeks

**Exit criteria:** launched; first sales through the full pipeline; support inbox quiet.

---

## Post-launch — v1.1 → v1.5

Ordered strictly by support-ticket and refund-reason frequency; expected sequence:

1. Adapter fixes for CC format churn (permanent tax, ~half a day per CC major, same-day ship via npm)
2. Bookmarks / tags
3. Trigram tokenizer toggle ("deep code search" — true substring matching, 3–5× index size, opt-in)
4. Session stitching for resume/compaction chains (one file = one session in v1; linkage already stored)
5. Diff-focused per-file view; side-by-side diffs
6. Project timelines
7. **Codex / Gemini CLI / Aider adapters** — each new tool is a re-launch marketing moment and the moat against Anthropic shipping native search

---

## Standing constraints (apply to every phase)

- Hard 6-week timebox; the npm pivot banked ~a week vs. the Electron plan — keep it as buffer, never spend it on scope.
- The privacy promise is absolute: localhost-only, no outbound network from the app, no telemetry. Any feature that dents it needs explicit justification (§3.3 activation escalation is the only documented exception, and it isn't built until sharing is a measured revenue problem).
- Parser changes always come with corpus fixtures; a green snapshot suite is the definition of "parser works."
- If the kill criterion triggers (<2% trial→paid after pricing/limit experiments): open-source it, fold learnings into Reikon.
