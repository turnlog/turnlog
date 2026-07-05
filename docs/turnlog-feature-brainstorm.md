# Turnlog — Feature Strategy Brainstorm
*Cost tracking · expanded stats · timeline navigation*
*July 2026 — companion to the deep-dive; read §0.3 competition first*

**Framing:** this is not a feature spec. Every idea below is scored against *who already owns that ground* (from the July competitive research) and reduced to the version that is defensible for Turnlog rather than derivative. The recurring rule: Turnlog's one defensible seam is **search-first — indexed FTS5 across all history, done well and sold as a reliable product.** Any feature that widens that seam is worth weeks; any feature that drags positioning back toward "another stats tool" or onto an incumbent's signature mechanic is worth, at most, a quiet afternoon.

Verdict legend: 🟢 build (widens the moat) · 🟡 include quietly (table stakes, don't headline) · 🔴 don't chase (incumbent-owned or off-thesis).

---

## 1. AI cost tracking — 🟡 show it, don't sell it

### The competitive reality
This is the most crowded lane in the entire space:
- **ccusage** — free, OSS, owns Claude Code token/cost mindshare.
- **SessionWatcher** — commercial, $6.99 one-time, live cost/rate-limit tracking across Claude/Codex/Copilot/Cursor/Gemini in the macOS menu bar.
- **Local dashboards** (multiple, free, OSS) — already ship cost + cache analytics, per-project breakdowns, and usage heatmaps.

Entering here as a paid headline feature means being the fifth version of something four tools give away, and — worse — it re-anchors Turnlog as "a stats tool," the exact mindshare trap the research says to avoid.

### Why a little of it is still mandatory
Turnlog already parses every token field (`input_tokens`, `output_tokens`, cache read/write) to build the index. Per-session and per-project cost is therefore *nearly free to compute*, and users opening a "session viewer" expect to see what a session cost. Omitting it entirely reads as a gap, not as discipline.

### The defensible line
- **Ship (🟡):** per-session cost on the session row and in the stats panel; a simple per-project rollup. Computed from the shipped pricing table with the user override (Bedrock/enterprise rates). Labeled as estimates. This is table stakes — present, never the pitch.
- **Do NOT ship as headline:** a cost *dashboard*, budget pacing, rate-limit prediction, live menu-bar tracking. That's SessionWatcher's and ccusage's job; competing there is competing where Turnlog loses.
- **The one cost angle that is actually differentiated** (and only because it's search-powered): **"what did this *kind of work* cost me?"** — i.e., cost aggregated over a *search result set*, not a time window. "Every session where I touched the websocket layer cost $340 total." No cost tracker can answer that because none of them index content. If cost is ever elevated above table-stakes, this is the only version that belongs to Turnlog. File as a v1.5 experiment, not v1.

**Net:** cost is the second thing users see, never the first. Marketing never leads with a number ccusage gives away.

---

## 2. Expanded stats — 🟡 mostly, 🟢 for the search-derived ones

### The reality
Generic dev-productivity stats (sessions/day, tokens over time, activity heatmap, per-project token burn) are already shipped by the free local dashboards. Rebuilding them is undifferentiated work that, again, tilts positioning toward "analytics tool."

### The split
- **🟡 Table-stakes stats** (include, don't headline): per-session tokens/cost/duration/files-touched; a per-project summary; a modest activity view if it's cheap. Users expect these; they don't sell anything.
- **🔴 Vanity/productivity dashboards** (skip): streaks, leaderboards, "you coded 47 days in a row," week-over-week token trend charts. Pure surface area, owned by free tools, off-thesis.
- **🟢 Search-derived stats — the only genuinely Turnlog-native category.** Because Turnlog is the only tool with a content index, it can answer questions phrased about *content*, which no stats tool can:
  - "How many sessions touched `auth.ts`?" (you already have `files_touched`.)
  - "Which files show up most across all sessions where the agent used the Bash tool?"
  - "Show every session that mentions 'rate limit' and what each cost."
  - Tool-usage breakdown *filtered by a search query*, not globally.

  These aren't a stats dashboard; they're **search results with aggregates attached.** That framing keeps them on-thesis (search-first) while delivering the "insight" feel people want from stats. This is the version worth building.

**Net:** ship the obvious per-session numbers as table stakes; invest only in stats that are a *byproduct of the content index*, because those are the only ones nobody else can copy for free.

---

## 3. Video-like timeline — 🔴 as conceived; 🟢 only as a search-anchored timeline

### The hard truth
Scrub-through-your-session-like-a-video **is Mantra's core mechanic and literal tagline** ("Time Travel for AI-Assisted Programming" — scrub forward/backward through turns and watch the codebase change in real time). Mantra is a polished, multi-platform, paid-looking incumbent that already owns this interaction and already does multi-tool + redaction + MCP hub around it.

Building a video-scrubber into Turnlog means:
- walking onto the exact hill an established competitor owns,
- as the newer, less-featured product,
- spending a large chunk of a six-week timebox rebuilding *their* signature feature instead of deepening *your* seam.

You do not out-Mantra Mantra on the Mantra mechanic. 🔴.

### The version that is actually Turnlog's
Temporal navigation is fine — *derivative replay-as-video* is the problem, not "time." The differentiated version is a **search-anchored timeline**: a time axis where **search hits are the markers**, and clicking a marker jumps into that session at that moment. Time in service of *search*, not replay.

- Query "websocket refactor" → the timeline shows every session/moment that matched, spread across weeks → click any hit → land in context.
- This is a *navigation-of-results* surface, not a scrubber. It answers "when did this keep coming up?" — a search question — rather than "let me watch this one session play back," which is Mantra's.
- It reinforces the one-liner (find that session from three weeks ago in two seconds) instead of diluting it.

Cost to build is far lower than a real video-scrubber (no per-turn file-tree reconstruction, no codebase-state diffing over time — just placing existing search results on a time axis).

### What to explicitly NOT build
- Per-turn full codebase-state reconstruction (Mantra's heavy lift; huge effort, their turf).
- A play/pause/scrub transport control.
- Side-by-side "watch the file change" playback.

If users beg for true replay-scrub later and the metrics justify it, it's a v2 conversation — and by then the Electron-wrap question is already on the table. Not a v1 fight.

---

## 4. Within-session navigation — 🟢 the real answer to "it's just a scrollable log"

### The actual problem
The complaint is correct and it is not about motion. A linear transcript has **no structure**, so navigation degenerates into scrolling — and scrolling a prettier transcript is no better than scrolling the live chat. Rendering the same firehose with nicer fonts adds nothing. The fix is the one IDEs use to make a 5,000-line file navigable: they don't animate it, they impose an **outline, folding, and go-to.** Do that to the session. This is where the "enhance the experience" effort should go instead of a timeline scrubber, and none of the competitors have done it well — Mantra scrubs, the OSS viewers render-prettier, nobody imposes structure.

### The organizing idea: the turn is the unit, not the message
On the nose for a product named Turnlog. You remember sessions as "I asked it to do X, then to fix Y" — never as message #147. Your prompts are the spine. Everything below hangs off that.

**4a. The turn spine — 🟢 the core; build first.**
Default view is not the full log. It's a collapsed skeleton of just your prompts, each with a one-line "what happened under here" line:
> *Refactor auth middleware → read 8 files, edited 3, ran tests (1 fail → fixed)*

Scan the whole session in ten rows; expand only the turn you care about. A left-rail outline of the same turns gives click-to-jump. This is a **document outline for a session** — the single highest-leverage anti-scroll move, and the one structural thing the field is missing. The summary line is generated *mechanically* from the tool calls under the turn (counts of reads/edits/commands/errors), **not** by an LLM — keeps the local/no-network promise intact.

**4b. Lenses — 🟢 cheap, high leverage.**
You already store `kind` on every message. Let the user collapse the session to one dimension: *diffs only · bash + output only · errors only · my-prompts only.* One linear stream becomes several navigable views for a few hours of filtering work.

**4c. Jump-to-error markers — 🟢.**
Auto-detect failures (non-zero exits, tool errors) and surface them as jump points: "3 errors in this session →." When reviewing what went wrong, that's exactly the moment you want, and hunting for it is the worst part of the transcript today.

**4d. The outcome pivot (file-tree → cumulative diff) — 🟢 possibly the most valuable; a genuinely different question.**
Often you don't want the conversation at all — you want *what this session did to my code.* A file-tree of touched files → click a file → the cumulative diff of every edit the session made to it, in order. This promotes the roadmap's "diff-focused view" from a v1.5 footnote to a first-class navigation **mode**. It answers the question devs actually have during review and sidesteps the transcript entirely. Higher effort than 4a–4c; worth it.

**4e. In-session find + sticky "you are here" — 🟢 table stakes, must be flawless.**
Cmd-F scoped to the session with next/prev is the literal answer to the complaint — polish it beyond reason. A sticky breadcrumb showing which turn you're currently under keeps a long session from ever losing the reader.

### Why this coheres with the search seam
You end up with **find-at-every-zoom**: cross-session FTS answers *which* session · in-session find answers *where in it* · the turn spine / lenses / file-pivot answer *by what structure.* That triad is the differentiated experience against both raw chat and Mantra's scrubber — and none of it requires building motion you'd lose on.

### Priority within the timebox
Turn spine + collapse-by-default (4a) first — it's the whole ballgame. Then lenses + in-session find (4b, 4e) — cheap, high leverage. Then the file-pivot mode (4d) — higher effort, high value, v1-if-the-timebox-holds else first v1.5. Per-turn AI summaries stay opt-in-only and later (network promise).

---

## 5. Summary table

| Idea | Verdict | v1? | Why |
|---|---|---|---|
| **Turn spine (collapsed prompt skeleton + outline rail)** | 🟢 | **Yes — first** | The core anti-scroll; a session outline nobody has built well |
| **Lenses (collapse to diffs/bash/errors/prompts)** | 🟢 | Yes | Cheap (`kind` already stored); big navigation win |
| **In-session find + sticky "you are here"** | 🟢 | Yes | Literal answer to the complaint; must be flawless |
| **Jump-to-error markers** | 🟢 | Yes | Surfaces the exact moment review needs |
| **Outcome pivot (file-tree → cumulative diff)** | 🟢 | v1 if timebox holds, else v1.5 | The "what did it do to my code" question; sidesteps transcript |
| Per-session / per-project cost | 🟡 table stakes | Yes | Nearly free from the index; expected; never the pitch |
| Per-session tokens/duration/files | 🟡 table stakes | Yes | Expected in a viewer |
| Search-derived aggregates (files/tools/cost by query) | 🟢 | v1–v1.5 | Byproduct of the index; nobody can copy free |
| Cost over a *search result set* | 🟢 (small) | v1.5 | Only cost view that needs the content index — uniquely Turnlog |
| Search-anchored timeline | 🟢 | v1.5 | Time in service of search; reinforces the seam; cheap |
| Cost dashboard / budget / rate-limit | 🔴 | No | ccusage + SessionWatcher own it, free/$6.99 |
| Productivity/vanity dashboards | 🔴 | No | Free tools own it; off-thesis |
| Video scrubber (Mantra-style) | 🔴 | No | Incumbent's signature mechanic; wrong hill |

---

## 6. The through-line

Two properties separate every 🟢 from every 🔴:

1. **It's an expression of the content index or the session's structure** — search-derived aggregates, the turn spine, the file-pivot, in-session find. These are things Turnlog can do *because* it parses and indexes; they can't be cloned by a free stats tool or a scrubber.
2. **It's sold as *finding*, never as *analytics* or *replay***. The moment Turnlog markets a cost dashboard it becomes "another stats tool" (ccusage/SessionWatcher win); the moment it markets a scrubber it becomes "a worse Mantra." It stays alive by being the tool that makes any session — and any moment in it — instantly findable.

So the enhancement to the "scrollable log" problem is not motion. It's **structure plus find-at-every-zoom.** Cost and stats ride along only in their index-derived, search-framed forms. Everything else is surface area the six-week timebox can't defend or afford.
