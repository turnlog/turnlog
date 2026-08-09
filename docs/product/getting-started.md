---
title: "Getting started"
description: "Install nothing, run one command, and read your first session — plus what the first index actually does."
---

# Getting started

## Run it

```bash
npx turnlog
```

That is the whole install. Turnlog starts a server on `127.0.0.1`, prints a URL, and
opens your browser:

```
turnlog <version>
  UI:          http://127.0.0.1:<port>/?token=a1b2c3…
  Claude Code: /Users/you/.claude/projects (read-only)
  Codex:       /Users/you/.codex/sessions (read-only)
  Cursor:      /Users/you/.cursor/projects (read-only)
  Index:       /Users/you/.config/turnlog/index.sqlite
```

The Codex and Cursor lines appear only if those histories exist. There is nothing to
configure either way — Turnlog finds what is there.

<Note>
The port is random on every run and the `?token=` is generated fresh each launch, so
copy the whole `UI:` line if the browser does not open by itself. Both are deliberate:
see [Privacy](/docs/product/privacy).
</Note>

Prefer a global install? `npm i -g turnlog`, then `turnlog`. Node 22 or newer.

## The first run

The first index is a one-time pass over every session file you have. It streams each
file rather than loading it — sessions run to hundreds of megabytes — and sessions appear
in the UI as they are parsed, so you can start reading before it finishes.

After that, indexing is incremental: Turnlog remembers each file's byte offset and reads
only what is new. A file watcher keeps the UI live while an agent is still writing, so a
session you are running right now updates within about a second.

## Where things live

| | |
|---|---|
| Index | `~/.config/turnlog/` (`%APPDATA%\turnlog` on Windows) |
| Settings | `~/.config/turnlog/settings.json` — optional, see [Settings](/docs/reference/settings) |
| Your logs | `~/.claude/projects`, `~/.codex/sessions`, `~/.cursor/projects` — read-only, never modified |

Override the index location with `TURNLOG_DATA_DIR`. Deleting the index costs you
nothing but a re-index — your annotations (pins, names, notes, tags, bookmarks, saved
searches) survive a rebuild, because they live in tables the rebuild does not touch.

## Try it without your own history

```bash
npx turnlog demo
```

Runs the real UI against bundled sample sessions in a scratch index. Your own history is
not read and not touched, and the banner says so for as long as it is running.

## Next

- [Search your history](/docs/guides/search-your-history) — the operators, and the ones worth learning first
- [Give your agent a memory](/docs/guides/mcp-claude-code) — one command
- [A tour of the screens](/docs/product/tour/sessions)
