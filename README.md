<div align="center">

# Turnlog

**Search and replay every coding-agent session you've ever run — locally.**

```sh
npx turnlog
```

[![npm](https://img.shields.io/npm/v/turnlog?color=e8542f&label=npm)](https://www.npmjs.com/package/turnlog)

[turnlog.dev](https://turnlog.dev) · [npm](https://www.npmjs.com/package/turnlog) · MIT

</div>

Turnlog indexes your Claude Code, OpenAI Codex, and Cursor history into
full-text search and turn-by-turn replay, then opens a local web UI. Find that
session from three weeks ago in two seconds. **100% local — no accounts, no
telemetry, no cloud.**

Work on the same repo lands in one project timeline whichever agent you pointed
at it — so a repo reads as a single history, not two.

## Install & run

```sh
npx turnlog          # try it now — indexes everything, opens the UI
npm i -g turnlog     # or install globally
```

Requires **Node.js 22+** (the runtime your agent CLI already runs on).
macOS, Linux, Windows. No build step, no installer, no postinstall scripts.

### Opening the UI

`turnlog` starts the local server and prints a URL, then opens your browser to it:

```
turnlog <version>
  UI:       http://127.0.0.1:52431/?token=a1b2c3…
  Projects: /Users/you/.claude/projects
  Codex:    /Users/you/.codex/sessions (read-only)
  Cursor:   /Users/you/.cursor/projects (read-only)
```

The Codex and Cursor lines appear only if those histories exist; there is
nothing to configure either way. Cursor comes in two flavors and both are
read: cursor-agent CLI transcripts, and the IDE's own chats — the IDE's
state database is copied before it is read, so the original is never even
opened.

Turnlog picks a random free port each run, so the URL is different every time.
**If the browser doesn't open** — over SSH, on a headless box, or with no default
browser — copy that `UI:` line into a browser yourself. The `?token=…` is
generated fresh each launch and is required on every request, so open the whole
URL, not just `127.0.0.1:<port>`.

- `--port <n>` — pin the port instead of choosing a random one.
- `--no-open` — start the server without launching a browser (handy when
  port-forwarding from a remote machine: `ssh -L 52431:127.0.0.1:52431 …`).
- `Ctrl-C` stops the server.

### Updating on Windows

If `npm i -g turnlog@latest` prints an `EPERM … better_sqlite3.node` cleanup
warning, the update still succeeded: a running Turnlog (or the MCP process
your agent keeps alive) had the old native module loaded, and Windows won't
delete a loaded library. npm leaves the old copy behind as a
`.turnlog-<random>` directory — Turnlog removes it automatically the next
time it starts, once nothing is holding the old file.

## What it does

- **Every agent, one history** — Claude Code, OpenAI Codex, and Cursor
  sessions are all indexed, read-only, and appear side by side. Every session
  says which agent wrote it, and a repo you worked on with several reads as
  one timeline. A **Projects screen** lists every repo you've worked in, and
  each gets its own **project page**: every agent's
  sessions interleaved, who worked there, what it cost, the files it touched
  most, and a live row when something is running in it right now.
- **Search everything** — full-text FTS5 across your whole history, grouped by
  session, jump straight to the match. Identifiers and `snake_case` included.
  Subagent transcripts (the separate files newer Claude Code versions write per
  Task run) are indexed too, as is everything the run actually saw — including
  files you attached with `@` and edits you made by hand while it was running.
  Filter by file (`path:api.ts`), by date in plain
  words (`after:7d`), by agent (`agent:codex`), by your own tags
  (`tag:billing`), by tool, model, project or error — or click a **refine
  chip** to narrow by what the results actually contain. Flip to a
  **timeline** to see when a topic kept coming up, or build the opt-in **deep
  search** index to match inside words — `eWebSock` finds `useWebSocket`.
  Also from the terminal: `turnlog search <query>` prints hits with deep
  links into the running UI. Search `is:error` and you also get **recurring
  failures**: the same error grouped across runs, ranked by how many sessions
  hit it — "this happened in 13 sessions across 3 projects".
- **Rich replay, every agent** — tool calls show the command or arguments
  they actually ran and pair with their output, and thinking folds away,
  whichever agent wrote the session.
- **Turn spine** — a 5,000-message session collapses to ten scannable turns,
  each with a mechanical summary (reads, edits, commands, errors). Any prompt
  copies with one click, because finding what you asked is usually the first
  half of asking it again.
- **Lenses & files** — collapse a session to just its diffs, commands, or
  errors; or pivot to a file and read every change it made, in order. Diffs
  read **unified or side-by-side**, your choice, everywhere they appear.
- **Bookmarks** — mark any moment in a replay, give it a caption in your own
  words, and find every marked moment later on one page.
- **Screenshots** — images you pasted to an agent, and screenshots tools
  handed back, render inline in the replay. They were always in your logs;
  now you can see them.
- **Spend tracker** — cost by day, model, or project — and, uniquely, cost
  filtered by a search query ("what did *this kind of work* cost me"). Usage is
  counted once per API response (the logs repeat it per line), priced from a
  shipped table covering Anthropic and OpenAI rates, and always labeled an
  estimate. Cursor IDE sessions use the cost Cursor itself recorded. Rates
  wrong for you (Bedrock, Vertex, enterprise)? Override any model via
  `modelPricing` in settings.json.
- **Calendar** — your sessions placed in time: a week timeline (days as rows,
  sessions as blocks at their real hours) or a month heat-map, coloured by
  project or by agent.
- **Live** — the UI refreshes within about a second as your agent writes, over
  a local event stream. No reloads, no polling loops.
- **Context window** — the replay's stats panel draws how full the context was
  at every response, with compaction points marked on the curve and on the turn
  where they happened.
- **Keyboard-first** — `⌘K` opens a command palette over every session, screen
  and saved search; `?` shows the cheat sheet.
- **Export** — `turnlog export <id>` prints a session as markdown, HTML or JSON,
  optionally redacted; a share panel does the same from the UI. Your pins,
  names, notes, **tags** and bookmarks travel with
  `turnlog annotations export|import`.
- **Agent memory (MCP)** — `turnlog mcp` serves your history to any MCP-capable
  agent as a read-only server, so it can search its own past sessions mid-task
  ("how did we fix this last month?").

## Give your agent memory (MCP)

`turnlog mcp` is a plain stdio MCP server — **any MCP-capable client can use
it**, not just the one that wrote the sessions. In Claude Code that is one
command:

```sh
claude mcp add turnlog -- npx turnlog mcp
```

Anywhere else, register the same command however your client takes MCP
servers — `npx` with the arguments `turnlog mcp`, no port and no URL, because
it speaks over stdio rather than a socket.

From then on the agent can consult your session history mid-task through six
read-only tools: `search` (same operators as the UI — `tool:`, `agent:`,
`tag:`, `is:error`, `is:pinned`, `has:note`, `project:`, `before:`/`after:`…),
`list_sessions`, `get_session` (the turn spine), `get_messages` (read the
context around a hit), `get_context` (how full the window was, and where it
was compacted — worth checking before trusting a session's late-conversation
memory), and `file_history` (every session that ever touched a file).

It runs on your machine — no server port, no network — and is **strictly
read-only, with no flag that changes that**: an agent can read your history
but never write to it. It reads the same index the app builds, so run
`turnlog` or `turnlog index` once first; on each start it does a quick
incremental catch-up so recent sessions are included.

## Privacy

Turnlog binds to `127.0.0.1` only, with `Host`-header validation (DNS-rebinding
defense) and a per-launch token required on every request. It makes **no
outbound connections** — verify it yourself:

```sh
lsof -iTCP -sTCP:LISTEN | grep node
```

The single optional network touch is a version-check against the npm registry
on startup — surfaced as a subtle "update available" notice in the terminal and
a dismissible banner in the web UI. The browser never contacts npm itself; the
result rides along on the local status API. Turn it off with
`TURNLOG_NO_UPDATE_CHECK=1` or `"checkUpdates": false` in
`~/.config/turnlog/settings.json`.

## Commands

```
turnlog                     Start the local server and open the UI
turnlog index               Incrementally index your agent history and exit
turnlog index --rebuild     Drop the index and rebuild from scratch
turnlog export <id>         Print a session as markdown (id or unique prefix);
                            --format html|json, --redact to scrub keys, emails
                            and home paths, --from/--to for a message range
turnlog search <query>      Search from the terminal (--limit n, --json);
                            same operators as the UI: tool: kind: is:error
                            is:pinned has:note tag: agent: project: model:
                            path: before: after:
turnlog annotations export  Print pins, names, notes, bookmarks and saved
                            searches as one JSON document
turnlog annotations import <file>
                            Merge a previous export back in
turnlog doctor              Print a diagnostic report for a bug thread:
                            versions, paths, settings, index facts per agent,
                            integrity, index-vs-disk drift
turnlog demo                Run against bundled sample sessions in a scratch
                            index — your own history is never read
turnlog mcp                 Serve the index to your agent over MCP (stdio, read-only)
```

Turnlog reads `~/.claude/projects`, `~/.codex/sessions`, `~/.cursor/projects`,
and the Cursor IDE's state databases (via a copy — the originals are never
opened), and never writes to any of them. The index lives in
`~/.config/turnlog/` (`%APPDATA%\turnlog` on Windows); override with
`TURNLOG_DATA_DIR`.

## Settings

Optional, and there is no settings UI on purpose — create
`~/.config/turnlog/settings.json` (`%APPDATA%\turnlog\settings.json` on
Windows) only if you want one of these:

```jsonc
{
  // Correct the shipped price table for your rates — Bedrock, Vertex,
  // enterprise agreements, or simple disagreement. USD per million tokens;
  // any field you omit keeps the shipped value. Matched by model id.
  "modelPricing": {
    "claude-sonnet-4-5-20250929": { "input": 2.4, "output": 12 }
  },

  // Open-in-editor buttons in the web UI. Unset, they don't render.
  // `{path}` is replaced with the file's absolute path; never run through a
  // shell. Try "code -g {path}" or "webstorm {path}".
  "editorCommand": "code -g {path}",

  // Skip the npm version check on startup (same as TURNLOG_NO_UPDATE_CHECK=1).
  "checkUpdates": false,

  // Drop the "Exported with Turnlog" footer from markdown exports.
  "exportFooter": false
}
```

Costs stay labeled estimates either way — they are computed from the token
counts in your own logs, not from a bill.

## License

[MIT](LICENSE) — free and open source. Index and open every session, no limits.
Fork it, ship it, build on it.

## Development

```sh
npm install
npm test               # vitest suite incl. golden-file parser snapshots
npm run build          # tsc → dist/ + Vite → web/dist/
npm run dev            # server + Vite together (scripts/dev.mjs)
```

Every agent's log format is undocumented and changes without notice. The
parser's rule is *never crash, never drop*: unrecognized records are stored as
`kind='unknown'` with the raw line preserved. Adapter changes ship with corpus
fixtures and regenerated golden files (`npm run golden:update`).

Architecture and conventions live in `AGENTS.md` — `CLAUDE.md` is a symlink to
the same file, so whichever name your agent looks for, it finds the one
document.

---

*For Claude Code, OpenAI Codex, and Cursor. Not affiliated with Anthropic,
OpenAI, or Anysphere; product names and marks belong to their owners and are
used only to say whose sessions Turnlog reads.*
