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
- [x] TypeScript strict, ESLint, Vitest; Node 22+ `engines` field (raised from 20 on 2026-07-05: Node 20 went EOL in April 2026 and better-sqlite3 dropped its ABI-115 prebuilds in 12.10 — supporting it would mean freezing the native dep at 12.9)
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

- [x] Session list: sortable/filterable by date, project, cost, duration
- [x] **Trial treatment designed now, not bolted on:** unlicensed mode shows the full library, only the 10 newest sessions openable; older rows visibly locked but showing metadata (date, project, cost)

### 2.2 Replay screen

- [x] react-virtuoso list (variable heights, reverse scroll); memoized rows
- [x] Threaded turns from the parent chain; tool calls collapsed by default (results can be enormous)
- [x] Sidechain/subagent runs as nested collapsible threads under the spawning tool call — hard rendering problem, real differentiator
- [x] Diff rendering: normalize Edit/Write tool records to unified diff, small custom component (side-by-side is v1.5)
- [x] Shiki in a web worker: lazy, on-demand as rows become visible, language whitelist (ts/js/tsx/py/go/rust/json/bash/diff), size cap per block with "highlight anyway"

### 2.3 Search screen — the demo GIF; polish beyond reason

- [x] Query → results grouped by session with `highlight()` snippets
- [x] Click → session opened scrolled to the hit; prev/next match navigation
- [x] Keyboard-first: focus search on open, arrow through results

### 2.4 Stats

- [x] Per-session stats panel: tokens, cost, duration, files touched, tool usage

**Exit criteria:** a 5,000-turn session scrolls at 60fps; you personally use Turnlog daily instead of grep.

**Status 2026-07-05 — Phase 2 code complete.** `web/` is an npm workspace (Vite + React 18 + React Query + react-virtuoso + Shiki); bundle ships at ~139KB gz with language grammars lazily code-split. Verified end-to-end against the real 91-session index through the hardened server, including headless-browser screenshots of all three screens and the search→replay jump. Implementation decisions worth knowing: hash routing because the server deliberately serves only `/` (and `?token=` must survive reloads); the trial gate reads a new `licensed` flag on `/api/status` (hardcoded true until Phase 3; `TURNLOG_UNLICENSED=1` previews the locked UI); sidechain runs anchor to their Task call by matching the run's opening prompt against `input.prompt` (nearest-preceding-Task fallback, orphan runs render standalone — never dropped); message windows grow bidirectionally over the forward-only `after_idx` API; assistant prose renders via react-markdown (never raw HTML — session logs are untrusted input and the origin holds the API token); Instrument Sans + Fira Code woff2 bundled locally (OFL notice alongside; sans swapped twice as the design system iterated). Deferred, deliberately: server-side enforcement of the trial gate + excluding locked sessions from search (Phase 3, with real licensing); branch-point rendering beyond file order (v1.5); 60fps-on-5,000-turns validation and daily-use verdict await real use. Post-completion UI iterations (same day, three rounds): the design landed on the full-bleed bento system now recorded in `design-system.md` (read that, not this); persistent session sidebar zone; dark + light themes as CSS tokens on `data-theme`, Shiki follows; Solar outline icons vendored (CC BY 4.0); Instrument Sans + Fira Code bundled; custom listbox dropdowns; `npm run dev` one-command dev loop (Vite proxy needs `changeOrigin` — the Host check rejects the dev origin's port otherwise).

---

## Phase 2.5 — Session structure & navigation

Derived from `turnlog-feature-brainstorm.md` §4: the fix for "it's just a scrollable log" is not motion (that hill is Mantra's) — it's what IDEs do to a 5,000-line file: **outline, folding, go-to**. Spends part of the banked npm-pivot buffer; every item is independently shippable, in strict priority order. Together with cross-session FTS this completes find-at-every-zoom: *which session → where in it → by what structure*.

- [x] **4a Turn spine — the core; build first.** Default replay view is a collapsed skeleton of the user's prompts, each with a one-line mechanical summary of what happened under it (reads/edits/commands/subagents/errors — derived from tool calls, never an LLM; the no-network promise holds). Left outline rail, click-to-jump, expand per turn. Data prerequisites: `is_error` normalized out of raw JSON (adapter v2 + schema v2, forces reindex) and a `/api/sessions/:id/turns` aggregate endpoint.
- [x] **4b Lenses:** collapse the session to one dimension — diffs only · bash only · errors only · prompts only. Cheap: `kind` is already a column. (Server-side `lens=` filter on the messages endpoint pulls paired tool_use/result rows in together; lens pills with counts in the replay header; tool blocks open by default inside a lens; `?l=` in the session URL.)
- [x] **4e In-session find + sticky "you are here":** session-scoped find with next/prev (FTS `session=` filter, hits in document order) and a breadcrumb of the current turn. (Cmd/Ctrl-F opens the find bar; it drives the same `?q=` the global search uses, so the match bar is shared; log view gets a floating current-turn breadcrumb, the spine outline marks the topmost visible turn.)
- [x] **4c Jump-to-error markers:** "N errors in this session →" from `is_error`, as jump points. (Floating error-nav pill cycles failing results in either view via the jump mechanism — the spine auto-expands the containing turn.)
- [x] **4d Outcome pivot:** files view (third segment beside spine/log, `?v=` deep-linkable) — touched-file list with edit counts and failure marks → the file's cumulative diffs in order, each with a "view in session" jump. Made v1-cheap by grouping the diffs lens client-side instead of a new endpoint; `files_touched` stays unexposed until something needs it cross-session.

**Exit criteria:** a 5,000-turn session scans in ~ten spine rows; "where did it go wrong" is one click (error marker), not a scroll hunt.

**Status 2026-07-05 — Phase 2.5 complete** (all five items, same day). Find-at-every-zoom now exists end to end: cross-session FTS → in-session find (`session=`-scoped, document-ordered hits, Cmd-F) → structure (spine · lenses · files pivot · error markers · you-are-here). The four dimensions carry a fixed color legend (diffs=mint, cmds=purple, errors=vermilion, prompts=ink). Session URLs encode everything: `?m=` jump, `?q=` find, `?l=` lens, `?v=` view.

---

## Phase 2.6 — Spend view (individual · local · search-powered)

Decision 2026-07-05, refining the brainstorm's 🔴 on cost dashboards with guardrails: an individual, Claude Code-only, 100% local spend screen ships **inside Turnlog**, because the hard 20% of any spend tracker (parsers, pricing, watcher, backfill) *is* our existing index — a spend view is a query layer over it. The positioning trap is avoided two ways: every number is fusable with a search query (the brainstorm's one 🟢 cost angle — "what did work-matching-X cost me", which no content-blind tracker can copy), and spend is a launch *hook* (shareable screenshot, content posts), never the headline — the landing page still leads with search & replay. **Team mode is explicitly not a Turnlog feature**: any sync path breaks the absolute no-network promise; if demand appears it becomes a separate product sharing the parser core. Cost attribution is session-level (start date) — one source of truth with every other number in the app; per-message daily attribution would need the cache-TTL split we don't store per row.

- [x] Per-project cost rollup (finishes the table stakes: `ProjectInfo` gains cost/turns)
- [x] Search aggregates: `SearchResponse.aggregates` computed over the **full** match set, not the truncated page (sessions, est. cost, turns, tokens, unpriced count); quiet strip on the search screen
- [x] `/api/spend`: daily rollups over sessions (start-date attribution), splits by model and project, period param, optional `q=` FTS filter, cache-savings estimate from the pricing table
- [x] Spend screen: daily bars (hand-rolled SVG, design-system palette — no chart dependency), model/project breakdowns with legend dots, cache-efficiency stat, 7/30/90d toggle, search filter, CSV/JSON export; header nav entry + home spend card links to it
- [ ] Explicitly not building: budgets/alerts, menu-bar live cost, rate-limit prediction, team sync, non-CC tools until their *search* adapter exists

**Exit criteria:** "what did work-matching-X cost me" is one query; the spend screenshot is shareable without Turnlog reading as a stats tool.

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
