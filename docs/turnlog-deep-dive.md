# Turnlog — Deep Dive (v3)
*Search and replay every agent session you've ever run — locally.*
*Distribution model · tech stack · licensing · payments · roadmap · sales*
*July 2026 — revised after strategy discussion*

**Changes from v1:** standalone product (no Reikon branding); distribution switched from signed Electron desktop app to **npm CLI + local web UI**, eliminating all code-signing costs; licensing finalized as honor-system with a documented activation escalation path; **name locked: Turnlog** (v3).

---

## 0. Locked decisions

### 0.1 Fully standalone product

Separate brand, separate name, no "by Reikon" byline. Clean kill-safety: if the kill criterion triggers, it open-sources without touching anything else. Internally you can still lift design tokens and component patterns from Reikon's codebase — that's code reuse, not brand coupling.

### 0.2 Name: **Turnlog** — locked

Agents work in *turns*; Turnlog is the log of every turn ever taken. Honest, agent-native vocabulary, not tied to Claude or even to "sessions" — survives the multi-tool future (Codex/Gemini CLI/Aider). `npx turnlog` is the entire install pitch. Working tagline: *"Every turn your agents ever took — searchable."*

Diligence record (July 2026):
- **npm `turnlog`: available** at check time. Rejected alternatives: `reelback` (active AI video-search product at reelback.io — same conceptual pitch, real confusion risk), `pastport` (crowded: multiple apps plus a patent-pending digitization product at pastport.com), `shiplog`/`flightlog`/`agentrail` (active 2026 npm packages doing agent/app logging — the space is being circled). Fallback if Turnlog ever dies: `sessiongrep` (available, guaranteed clean, but caps the brand at "utility").
- **Only existing mark:** turnLOG® — German industrial container/merchandise-management hardware (Keller & Kalmbach / SFS). Different trademark class and universe from developer software; practical risk near zero, but since Paddle sells into the EU, do a 10-minute EUIPO class check before the name goes on invoices. turnlog.com is parked (possibly buyable cheap); SERP is effectively empty — ownable within weeks.
- **Known caveat:** the `-log` suffix reads as "logging library" in npm culture (epilog, chronolog, afterlog). The demo GIF and tagline must correct this instantly — lead every surface with *search and replay*, never "logs."
- **Claim today:** npm package `turnlog`, turnlog.dev, GitHub org (`turnlogdev`/`turnlogapp` — bare name is squatted by a dormant account), X handle.

Anthropic constraint stands regardless: "for Claude Code" in taglines and marketing copy only — "Claude" never appears in the product or package name.

### 0.3 Honest competition check

The *stats* half of the product is already free: **ccusage** (popular OSS CLI) owns Claude Code token/cost reporting mindshare. Several OSS session viewers / transcript-to-HTML converters exist on GitHub — janky and unmaintained, but they exist. What doesn't exist as a polished product: **indexed full-text search + proper replay across the entire history**. That's the wedge. Lead marketing with "find that session from three weeks ago in two seconds," not with cost stats. Re-verify the landscape the week before launch — this space moves monthly.

---

## 1. Distribution model: npm CLI + local web UI

The core architectural decision, replacing the Electron desktop app.

**How it works:** `npx turnlog` (or a global install) starts a localhost-only Node server that indexes `~/.claude/projects/` and opens the browser to the full React UI. The Drizzle Studio / Prisma Studio pattern. The audience has Node by definition — Claude Code itself installs via npm.

**What this eliminates, permanently:**

- All code-signing costs and process. npm packages never touch Gatekeeper or SmartScreen — the quarantine problem is specific to app bundles downloaded via a browser. macOS $99/yr: gone. Windows cert ~$300/yr: gone. Notarization pipeline: gone.
- Installers, dmg/NSIS packaging, electron-builder configuration.
- Auto-update infrastructure entirely — **npm is the update channel.** `npx` runs latest automatically; global installs update with one command. Given the permanent maintenance tax of Claude Code format churn, frictionless updates on every platform matter more than anything signing would have bought.
- Electron-specific native-module rebuild pain. better-sqlite3 in plain Node uses standard prebuilds on every platform.

**What survives untouched:** the React/TS UI, SQLite + FTS5 index, the parser/adapter architecture, file watching while running, offline Ed25519 licensing, the stateless trial, Paddle + the CF Worker. The privacy claim survives too: the server binds to localhost only, and "no outbound network" remains verifiable (`lsof`/`netstat` it yourself — say exactly that on the landing page).

**Accepted trade-offs:**

- **Perceived value.** $29 for "an npm package" reads lower than $29 for an app. Price at **$19–24** (launch week $15–17). Revisit upward if conversion is strong.
- **No ambient presence.** No dock icon; indexing happens only while it's running. Acceptable — this is a look-things-up tool, not a monitor. Index catch-up on launch must therefore be fast (see §2.2 exit criteria).
- **License tampering is trivially easier** (readable JS in node_modules vs. asar). Irrelevant — the licensing model is honor-system anyway (§3).

**One-way-safe:** the architecture (local server + web frontend) wraps into Electron in about a week if a "real app" is ever demanded. The reverse migration would have been a rewrite. Optional future Windows path if a warning-free installable is ever wanted: MSIX via the Microsoft Store — Microsoft signs Store packages themselves, the individual account is ~$19 one-time, and non-game apps can keep their own payment/licensing at 0% commission. Post-launch curiosity, not a plan.

### 1.1 Localhost server hardening (required, not optional)

A local web server is an attack surface; for a privacy-branded product it must be visibly hardened:

- Bind **127.0.0.1 only**, never 0.0.0.0. Random high port.
- **Validate the `Host` and `Origin` headers** against localhost — this is the defense against DNS-rebinding attacks, where a malicious website tricks the browser into calling your local server. Reject anything else with 403.
- Generate a **random session token at startup**, put it in the URL the CLI opens, require it on every API request. Prevents other local processes and drive-by web pages from querying your session index.
- No CORS headers at all (same-origin only).

This is ~50 lines and becomes a landing-page bullet: "hardened localhost server — Host validation, token auth, loopback-only."

---

## 2. Technology stack

### 2.1 Runtime layout

- **CLI/server:** Node 20+, TypeScript. Small CLI surface: `turnlog` (start + open browser), `turnlog license <key>`, `turnlog index --rebuild`, `turnlog export <session-id>`. Fastify or bare `node:http` for the server — it serves the built React bundle plus a JSON API.
- **Indexer in a worker thread** (or child process): JSONL parsing and SQLite writes never block the API. Same isolation principle as the old utilityProcess plan, simpler primitives.
- **Frontend:** React + TS + Vite, built and shipped inside the npm package. State via React Query over the local API. Reuse Reikon's design tokens/components internally.
- **Packaging:** single npm package containing CLI + prebuilt frontend. CI: GitHub Actions → `npm publish` on tag. That's the entire release pipeline.
- **Node version guard:** check `process.version` at startup with a friendly error — the one "installer" bug class you still have.

### 2.2 Data layer: SQLite + FTS5

- **better-sqlite3** (synchronous, fastest, standard prebuilds for all platforms in plain Node). WAL mode, `synchronous=NORMAL`, single writer (the indexer worker).
- **Schema sketch:**

```sql
sessions(id, project_path, file_path, started_at, ended_at,
         model, turn_count, input_tokens, output_tokens,
         cache_read_tokens, cache_write_tokens, cost_usd,
         files_touched_count, schema_version, file_byte_offset)
messages(id, session_id, parent_id, idx, role, kind,   -- prompt/assistant/tool_use/tool_result/summary/unknown
         tool_name, ts, tokens_in, tokens_out, raw_json)
files_touched(session_id, path, change_kind)
messages_fts(content)   -- FTS5, external-content on messages
```

- **FTS5 config:** `tokenize = "unicode61 tokenchars '_$.'"` plus `prefix='2 3'` — handles identifiers like `useWebSocket` and `session_id`. The **trigram tokenizer** (true substring search for code) inflates the index 3–5× and slows writes; keep it as a v1.1 "deep code search" toggle if users ask.
- **Store message text in the DB for v1.** The purist design (contentless FTS + lazy byte-offset reads from source JSONL) keeps the DB tiny but breaks replay if the user moves/deletes logs. A few GB of SQLite on a dev machine is a non-problem.
- **Incremental indexing:** track `(file_path, last_byte_offset, mtime, size)` per file. On a watch event or startup, seek to the stored offset and parse only appended lines. Full reindex only when size < stored offset (rewritten file) or the adapter version bumps. DB lives in `~/.config/turnlog/` (respect XDG on Linux, `%APPDATA%` on Windows).

### 2.3 The parser — where the product actually lives

Claude Code's JSONL format is **undocumented and changes without notice**. Everything below is the working hypothesis; build a real test corpus from your own `~/.claude/projects/` plus files donated by beta users on different CC versions.

Known landmines to design for:

- **Files at** `~/.claude/projects/<dash-encoded-cwd>/<session-uuid>.jsonl`, one JSON object per line. Stream-parse with readline over an fs stream — sessions run 50–500MB; never `JSON.parse` a whole file.
- **Threading is a `parentUuid` chain**, not a flat array — branches happen (retries, edits). Normalize to a tree flattened to display order, not naive line order.
- **Subagents:** sidechain-flagged records belong to Task/subagent runs. Render as nested, collapsible threads under the spawning tool call — a hard rendering problem and a real differentiator if nailed.
- **Tool pairing:** `tool_use` blocks pair with later `tool_result` records by ID. Results can be enormous (whole-file reads) — store, collapse by default.
- **Cost:** older CC versions wrote a per-message cost field; newer ones only write token usage. Compute cost from a **model pricing table shipped with the package** (updated via npm releases), with a user override in settings for Bedrock/enterprise rates. Label as estimates.
- **Summaries / compaction / resume:** summary records reference conversations via a leaf UUID; resumed/compacted sessions produce new files that are logical continuations. v1: one file = one session, store the linkage; v1.5: stitch into timelines.
- **Unknown records — the cardinal rule:** *never crash, never drop.* Unrecognized records are stored with `kind='unknown'` + `raw_json` and rendered as a collapsed "unrecognized event (view raw)" row. This turns format churn into a cosmetic bug instead of data loss.

Architecture: `RawLine → VersionSniffer → AdapterVN → NormalizedRecord`. Adapters are pure functions in one directory; a CC format change is a new adapter file plus corpus fixtures. Snapshot-test the whole corpus (raw → normalized golden files) so upgrades are diff-reviewable.

### 2.4 Rendering

- **Virtualization is mandatory:** thousands of turns, wildly variable row heights. `react-virtuoso` handles variable heights and reverse scrolling well. Memoize rows; collapsed-by-default tool results keep initial layout cheap.
- **Syntax highlighting: Shiki** in a web worker, lazy, language whitelist (ts/js/tsx/py/go/rust/json/bash/diff covers ~95%). Highlight on-demand as rows become visible. Cap highlighting at N KB per block with a "highlight anyway" button.
- **Diffs:** normalize Edit/Write tool records into unified-diff form, render with a small custom component (side-by-side is v1.5). Reuse the diff patterns from Reikon's review surface.
- **Search UX:** results grouped by session, FTS5 `highlight()` snippets, click → session opened scrolled to the hit, prev/next match navigation. **This screen is the demo GIF; polish beyond reason.**

### 2.5 Export

Markdown serializer over the normalized model: prompts as blockquotes, assistant prose verbatim, tool calls as `<details>` blocks, diffs as fenced ```diff blocks. Footer attribution link on by default, plainly removable in settings. Add "copy session as markdown" — clipboard into Slack is how it actually spreads. Also exposed as `turnlog export <id>` for scripting.

---

## 3. Licensing

### 3.1 Design principle

The brand promise is *100% local, no account, no telemetry.* The license system works **fully offline** — the app never phones home. This also rules out MoR-native license keys (Lemon Squeezy/Polar are server-validated), which is fine: owning the keygen keeps you MoR-portable.

### 3.2 Signed offline keys (Ed25519)

- One Ed25519 keypair. **Private key** only in a Cloudflare Worker secret plus one offline backup (losing it = reissuing every customer). **Public key** embedded in the npm package.
- **Payload** (compact JSON → base64url):

```json
{ "lid": "ulid", "email": "buyer@x.com", "product": "turnlog",
  "major": 1, "seats": 2, "iat": 1720000000 }
```

- License string = `payload.signature`, both base64url — pasteable. Verification is ~20 lines with Node's built-in `crypto.verify`. Stored at `~/.config/turnlog/license`.
- **The email in the payload is the anti-sharing mechanism.** "Licensed to buyer@x.com" shows in the UI footer/About. People forward keys to a friend; they don't post a key carrying their own email to a public forum.

### 3.3 Multi-machine policy: honor system, with a documented escalation path

**Shipped policy (v1):** "Personal license, up to 2 machines" is a **license term, not a technical control**. Stated at checkout and in the EULA; the app enforces nothing. Installing on a new machine = paste the same key again. Rationale: offline-only verification cannot technically prevent copying; enforcement mechanisms only ever punish paying customers (new laptop, reinstall, VM); piracy losses on a ~$20 dev utility round to zero.

**Leak handling:** keys are traceable via `lid` + email. A leaked-public key gets added to a small **blocklist JSON shipped inside each npm release** — checked locally at verification time, still zero network.

**Escalation path (only if sharing becomes a measurable revenue problem — don't build now):** *activate-once, offline-forever.* First run on a new machine sends `{licenseKey, machineFingerprint}` to the CF Worker once; Worker checks KV against a generous lifetime activation cap (e.g. 5 activations on a 2-machine license — Sublime-style buffer for reinstalls, no deactivation UI needed) and returns a machine-bound signed token cached locally. Zero network afterward. Fingerprint = hash of the OS machine ID. Include a manual paste-code-on-website path for airgapped machines. This slightly dents "no network" (one explicit activation call), so it ships only with clear justification.

### 3.4 Trial gating: zero stored state

The trial limit — *view only the 10 most recent sessions* — is a pure function of the data on disk. No trial timestamp, no countdown, no clock-tampering defense. Unlicensed mode shows the **full library** (the user sees how much history they have — the sales pitch rendered as UI) but only the 10 newest sessions are openable/searchable; older rows are visibly locked yet still show metadata (date, project, cost). Let them feel what they can't open.

### 3.5 Upgrades

`major` in the payload is the upgrade mechanism: v1.x accepts `major >= 1`; v2 requires `major >= 2`. Upgrade sale = unique Paddle discount code emailed to v1 customers (~$15 on the v2 product). The last v1 package version remains installable forever (`npm i turnlog@1`) — abandoning paid users of a "durable utility" is brand suicide.

### 3.6 Delivery pipeline, end to end

```
1. Buy button → Paddle overlay checkout on the landing page
2. Paddle transaction.completed webhook → CF Worker
     → verify Paddle signature
     → generate Ed25519-signed key (email, product, major in payload)
     → store {lid, email, key} in Workers KV
     → key delivered in the buyer's receipt email
3. User: `turnlog license <paste-key>` (or paste in web UI settings)
     → offline signature verification against embedded public key
     → written to ~/.config/turnlog/license
4. Every launch: read file, verify locally. New machine = paste same key.
5. Lost key: site page → enter purchase email → Worker KV lookup → resend (rate-limited)
6. Refund: Paddle webhook → Worker flags lid revoked → blocklist updated in next npm release
```

Total backend: one Worker, one KV namespace, one email template, ~200 lines. The only server component in the product, and the app never depends on it.

---

## 4. Payments & sales platform

### 4.1 Merchant of record is non-negotiable from Armenia

Selling globally means VAT/GST/sales-tax obligations across dozens of jurisdictions; an MoR becomes the legal seller and handles tax calculation/remittance, refunds, chargebacks, and fraud. Stripe direct isn't available to Armenian individuals anyway — MoR is both the compliant path and the only practical one.

### 4.2 Platform choice: Paddle

| Platform | Fee | Armenia seller | Verdict |
|---|---|---|---|
| **Paddle** | 5% + $0.50 | ✅ Explicitly on Paddle's supported-country list; pays out worldwide except sanctioned countries | **Primary.** Most mature tax coverage; the boring, durable choice. Vets products at onboarding. No native license keys (not needed). |
| Lemon Squeezy | 5% + $0.50 | ✅ On the bank-payout country list | Fallback. Post-Stripe-acquisition drift: slowed roadmap, support incidents in 2026, makers migrating away. |
| Polar | 5% + $0.50 (free tier); 4% + $0.30 on $100/mo plan | ⚠️ Runs on Stripe underneath; Armenia payout support unconfirmed | Best dev-audience fit and fees at scale, but the Armenia question blocks it. One email to their support settles it — worth sending as a hedge, not worth blocking on. |

Practical Paddle notes: **apply in week 0** — domain verification and product review can take days to a couple of weeks, and a landing-page skeleton must be live for approval. Use Paddle Billing (new API), overlay checkout embedded on the landing page. 14-day no-questions refund policy — cheaper than chargebacks and a conversion asset.

### 4.3 Pricing

npm-CLI packaging lowers perceived value versus a desktop app: price at **$19–24** (launch week **$15–17**, time-boxed and public). Each $22 sale nets ~$20.4 after Paddle. Add a **team pack** SKU early — 5 keys at ~$79 — dev leads with budgets are in the buyer persona and multi-quantity is trivial in Paddle. PPP discounts: later, not launch.

---

## 5. Distribution & updates

- **npm is the entire distribution and update channel.** `npx turnlog` for try-it-now (this *is* the trial funnel — one command, no download page, no unzip); `npm i -g turnlog` for regulars. `npx` users get the latest version automatically; global users get a subtle "update available" notice in the CLI output (a local version-string compare against the npm registry — make this check opt-out-able and document it, since it's technically a network call; or skip it entirely for purity and rely on release notes).
- **Publishing hygiene:** enable npm 2FA + provenance (`npm publish --provenance` from GitHub Actions) — supply-chain trust is the npm-world equivalent of code signing, and it's free. Package name squatting: claim the name the day it's chosen.
- **Release pipeline:** tag → GitHub Actions → build frontend → test corpus snapshots → `npm publish`. Minutes, not the hours of a signing pipeline.
- **Optional later:** Homebrew formula (dev-audience distribution channel, free), winget manifest, Microsoft Store MSIX (~$19 one-time, Microsoft-signed) if a warning-free Windows installable is ever demanded, Electron wrap if "real app" demand materializes — the local-server + web-frontend architecture makes that ~a week of packaging.

**Costs to launch: ~$10–20 (domain).** Ongoing: <$10/mo (Cloudflare mostly free tier). No certificates, no Apple program, ever — unless the Electron wrap returns someday.

---

## 6. Roadmap

Original 4-week plan assumed full-time. With Reikon, Nova, the day job, and a World Cup: **6 weeks part-time**, external dependencies started day one. The npm pivot removes roughly a week of packaging/signing work versus the Electron plan — bank it as buffer, don't spend it on scope.

### Phase 0 — Decisions & applications (2–3 days, this week)

- **Claim the name today** (npm was available at check time — it will not stay that way): `npm publish` a 0.0.1 placeholder for `turnlog`, register turnlog.dev, grab the GitHub org and X handle. 10-minute EUIPO class check on turnLOG® (§0.2).
- **Paddle seller application submitted** (landing skeleton live). Longest external dependency — first action.
- Ed25519 keypair generated; private key backed up offline.
- Test corpus: your full `~/.claude/projects/` (scrubbed) into a fixtures repo + donated files from 3–5 devs on different CC versions/OSes.
- 30-minute competitive re-scan (GitHub/X).

### Phase 1 — Parsing & index (weeks 1–2)

- CLI scaffold, localhost server with hardening (§1.1), worker-thread indexer, typed API layer.
- Streaming JSONL parser → version sniffer → adapter → normalized model; golden-file snapshot tests over the corpus.
- SQLite schema + FTS5; incremental indexing with byte offsets; chokidar watcher with debounce.
- Cost computation with shipped pricing table + override.
- Verify better-sqlite3 prebuilds on macOS arm64/x64, Windows, Linux in CI.
- *Exit criteria:* 2GB projects dir fully indexed in a couple of minutes; **startup catch-up indexing feels instant on a warm index** (critical — no ambient daemon means every launch catches up); search <50ms; live session updates within seconds.

### Phase 2 — Viewer UI (weeks 2–4)

- Library: sortable/filterable by date, project, cost, duration; locked-row trial treatment designed now, not bolted on.
- Replay: virtuoso list, threaded turns, collapsible tool calls, sidechain nesting, diff rendering, shiki-in-worker.
- Search: query → grouped results → jump-to-context with match navigation. **The demo GIF screen — disproportionate polish.**
- Per-session stats panel.
- *Exit criteria:* a 5,000-turn session scrolls at 60fps; you personally use it daily instead of grep.

### Phase 3 — Product hardening (weeks 4–5)

- `license` CLI command + web UI paste flow; offline verification; blocklist mechanism.
- CF Worker: Paddle webhook → keygen → KV → email; lost-key page; refund→revoke flow.
- Markdown export + clipboard copy + `export` CLI command.
- npm packaging polish: postinstall-free (no install scripts — they're a trust smell), Node version guard, `--help` that doesn't embarrass you. Publish with provenance from CI.
- Crash-free handling of filesystem edges: permissions, symlinks, iCloud-offloaded files, 0-byte JSONLs, mid-write lines.

### Phase 4 — Beta & launch (weeks 5–6)

- Private beta: 5–10 heavy CC users; their weird JSONL files are the real QA — expect at least one adapter fix.
- Landing page: 30s screen recording above the fold; 20s GIF for social; pricing; privacy statement ("localhost-only, verify with lsof — here's how"); FAQ.
- SEO pages (§7.3) live and indexed *before* launch day.
- Docs: install (`npx turnlog` — the whole thing), supported CC versions, log locations, troubleshooting.
- Launch sequence: soft-launch to beta list at launch price → Show HN Tuesday morning ET → r/ClaudeAI + X same week → directory pitches over the following two weeks.

### Post-launch (v1.1 → v1.5)

Ordered strictly by support-ticket and refund-reason frequency; expected sequence: adapter fixes for CC updates (permanent tax) → bookmarks/tags → trigram deep-code-search toggle → session stitching for resume/compact chains → diff-focused per-file view → project timelines → Codex/Gemini CLI/Aider adapters (each new tool is a re-launch marketing moment, not just a feature).

---

## 7. Sales playbook

### 7.1 The install command is the funnel

`npx turnlog` is the entire trial pitch — no download page, no unzip, no security warning, running in fifteen seconds. Put the command itself (copy button) as the primary CTA above the fold, ahead of any "download" language. Every social post ends with the one command. This is a genuine conversion advantage over every signed-installer competitor and it cost nothing.

### 7.2 Launch mechanics

- **Show HN:** Tue–Thu, ~8–10am ET. "Show HN: Search and replay your Claude Code sessions locally." First comment: the origin story (grep and suffering), the privacy stance, honest limitations, the one-command trial. Stay in the thread all day. HN's values — local-first, no telemetry, one-time pricing, `npx` try-it-now — are your positioning verbatim; state it plainly, not smugly.
- **r/ClaudeAI:** check current self-promo rules that week; demo-GIF post framed as "I made CC's session logs readable" with real engagement.
- **X:** the 20-second GIF, posted natively, ending on the `npx` command.
- **Product Hunt:** a coordinated day in week 2–3 post-launch — don't split HN and PH energy.

### 7.3 SEO for the desperate

One genuinely useful page each, product CTA at the bottom: "where does Claude Code store session history," "read Claude Code JSONL files," "search Claude Code conversation history," "export Claude Code session to markdown," "Claude Code cost per session," "resume old Claude Code session." 400-word honest answers *including the free/manual way* — honesty is what ranks and converts. Indexed before launch.

### 7.4 Funnel measurement without telemetry

No in-app analytics, ever — keep the promise absolutely. Instrument the edges instead: npm download counts, landing → checkout rates (Cloudflare Web Analytics, cookieless), Paddle conversion. The kill-criterion math (<2% trial→paid after pricing/limit experiments) is computable from these. One optional question on the refund/uninstall docs page is the entire user-research pipeline.

### 7.5 Word of mouth

The markdown-export footer is the passive engine (removable in settings — never hostage-y). The export → user-pastes-to-own-gist flow keeps sharing user-controlled while the footer travels. Personally answer every "how do I find old CC sessions" question on Reddit/SO/Discord for the first three months; each answer is permanent SEO.

### 7.6 Numbers, honest

Launch cost ~$15. Ongoing <$10/mo. At $22 net ~$20.4/sale: ~$400/mo needs ~20 sales. Realistic ramp $300–800/mo after a decent launch, spiking with Claude Code growth waves and each new tool adapter. A lifestyle utility with near-zero support burden — plus a paying-customer email list of heavy agent users, strategically valuable regardless of MRR.

---

## 8. Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Anthropic ships native session search/history in CC | Medium, rising | Multi-tool adapters are the moat; accelerate Codex/Aider if signals appear. Depth (replay polish, cross-project search, export) beats a built-in list view. |
| CC log format breaks parsing | Certain, repeatedly | Adapter architecture + unknown-record fallback + corpus snapshots. ~Half a day per CC major release, forever. npm makes shipping the fix same-day. |
| npm packaging depresses perceived value / conversion | Medium | Priced for it ($19–24); `npx` funnel advantage offsets; Electron wrap remains a one-week option if demand demands an "app." |
| Paddle application rejected/delayed | Low–medium | Apply day one; Lemon Squeezy (Armenia-confirmed) as fallback; keygen is MoR-agnostic by design. |
| Local server security incident | Low, high reputational cost | §1.1 hardening is mandatory scope: loopback-only, Host/Origin validation, token auth. Publicize the hardening. |
| Market smaller than it feels inside the bubble | Medium | Kill criterion (<2% conversion after experiments) measurable from edge analytics — honor it: open-source for goodwill, fold learnings into Reikon. |
| Your hours: this cannibalizes Reikon momentum | **High — the real risk** | Hard 6-week timebox; the npm pivot already cut ~a week of packaging — keep it as buffer, not scope. A 4-month viewer is a strategic loss even if it sells. |

---

## 9. Decision checklist

1. ☑ Standalone product, no Reikon branding (§0.1)
2. ☑ Distribution: npm CLI + local web UI; no signing, ever (§1)
3. ☑ Licensing: offline Ed25519, honor-system 2-machine term, blocklist via releases; activation server only as documented escalation (§3.3)
4. ☑ Name locked: **Turnlog** — ☐ npm placeholder published, turnlog.dev + GitHub org + X handle claimed, EUIPO check done (§0.2)
5. ☐ Paddle application submitted with landing skeleton (§4.2)
6. ☐ Ed25519 keypair generated, private key backed up offline (§3.2)
7. ☐ Test corpus collected from ≥3 CC versions (§2.3)
8. ☐ Localhost hardening in v1 scope: loopback bind, Host/Origin validation, token auth (§1.1)
9. ☐ Price set in the $19–24 band, launch-week discount defined (§4.3)
10. ☐ Optional hedge: email Polar re: Armenia payouts (§4.2)
11. ☐ 6-week timebox committed, Reikon protected (§8)
