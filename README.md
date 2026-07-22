<div align="center">

# Turnlog

**Search and replay every Claude Code session you've ever run — locally.**

```sh
npx turnlog
```

[turnlog.dev](https://turnlog.dev) · [npm](https://www.npmjs.com/package/turnlog) · MIT

</div>

Turnlog indexes your `~/.claude/projects/` history into full-text search and
turn-by-turn replay, then opens a local web UI. Find that session from three
weeks ago in two seconds. **100% local — no accounts, no telemetry, no cloud.**

## Install & run

```sh
npx turnlog          # try it now — indexes everything, opens the UI
npm i -g turnlog     # or install globally
```

Requires **Node.js 22+** (the runtime Claude Code already installs with).
macOS, Linux, Windows. No build step, no installer, no postinstall scripts.

### Opening the UI

`turnlog` starts the local server and prints a URL, then opens your browser to it:

```
turnlog 0.2.6
  UI:       http://127.0.0.1:52431/?token=a1b2c3…
  Projects: /Users/you/.claude/projects
```

Turnlog picks a random free port each run, so the URL is different every time.
**If the browser doesn't open** — over SSH, on a headless box, or with no default
browser — copy that `UI:` line into a browser yourself. The `?token=…` is
generated fresh each launch and is required on every request, so open the whole
URL, not just `127.0.0.1:<port>`.

- `--port <n>` — pin the port instead of choosing a random one.
- `--no-open` — start the server without launching a browser (handy when
  port-forwarding from a remote machine: `ssh -L 52431:127.0.0.1:52431 …`).
- `Ctrl-C` stops the server.

## What it does

- **Search everything** — full-text FTS5 across your whole history, grouped by
  session, jump straight to the match. Identifiers and `snake_case` included.
  Subagent transcripts (the separate files newer Claude Code versions write per
  Task run) are indexed too.
- **Turn spine** — a 5,000-message session collapses to ten scannable turns,
  each with a mechanical summary (reads, edits, commands, errors).
- **Lenses & files** — collapse a session to just its diffs, commands, or
  errors; or pivot to a file and read every change it made, in order.
- **Spend tracker** — cost by day, model, or project — and, uniquely, cost
  filtered by a search query ("what did *this kind of work* cost me"). Usage is
  counted once per API response (the logs repeat it per line), priced from a
  shipped table, and always labeled an estimate.
- **Calendar** — your sessions placed in time: a week timeline (days as rows,
  sessions as blocks at their real hours) or a month heat-map.
- **Live** — the UI refreshes within about a second as Claude Code writes,
  over a local event stream. No reloads, no polling loops.
- **Export** — `turnlog export <id>` prints a session as markdown; a copy
  button does the same from the UI.

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
turnlog index               Incrementally index ~/.claude/projects and exit
turnlog index --rebuild     Drop the index and rebuild from scratch
turnlog export <id>         Print a session as markdown (id or unique prefix)
```

The index lives in `~/.config/turnlog/` (`%APPDATA%\turnlog` on Windows);
override with `TURNLOG_DATA_DIR`.

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

Claude Code's JSONL format is undocumented and changes without notice. The
parser's rule is *never crash, never drop*: unrecognized records are stored as
`kind='unknown'` with the raw line preserved. Adapter changes ship with corpus
fixtures and regenerated golden files (`npm run golden:update`). Architecture and
conventions are documented in `CLAUDE.md`.

---

*For Claude Code. Not affiliated with Anthropic.*
