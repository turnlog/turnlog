---
title: "CLI"
description: "Every command and flag. Canonical — if the CLI's surface changes, edit this page."
---

# CLI

```bash
npx turnlog [command] [options]
```

No command starts the server and opens the UI. Node 22 or newer.

## Commands

| Command | Does |
|---|---|
| `turnlog` | Start the local server and open the UI |
| `turnlog index` | Incrementally index and exit |
| `turnlog index --rebuild` | Drop the derived index and rebuild from scratch |
| `turnlog export <id>` | Print a session — see [Export](#export) |
| `turnlog search <query>` | Search from the terminal |
| `turnlog annotations export` | Print pins, names, notes, tags, bookmarks and saved searches as one JSON document |
| `turnlog annotations import <file>` | Merge a previous export back in |
| `turnlog doctor` | Diagnostic report for a bug thread |
| `turnlog demo` | Run against bundled sample sessions in a scratch index |
| `turnlog mcp` | Serve the index over MCP (stdio, read-only) |
| `turnlog skill` | Print a skill file that tells your agent when to search your history |

`<id>` accepts a full session id or a unique prefix.

### `turnlog skill`

Registering the MCP server gives your agent the tools; it does not tell it
*when* to use them, so it tends to wait until you ask. The skill file supplies
the trigger — past work referenced, an error that looks familiar, an unfamiliar
file about to change — plus the query grammar and the rule to cite session ids.

It prints to stdout rather than installing itself: Turnlog does not write into
an agent's own directory, and every agent keeps its instructions somewhere
different. Save it where yours reads them.

```bash
mkdir -p ~/.claude/skills/turnlog
npx turnlog skill > ~/.claude/skills/turnlog/SKILL.md
```

Pair it with [MCP setup](/docs/guides/mcp-claude-code) — the skill is only
useful once the tools it names are registered.

## Options

| Flag | Does |
|---|---|
| `--port <n>` | Fixed port instead of a random one |
| `--projects <dir>` | Claude Code projects dir (default `~/.claude/projects`) |
| `--no-open` | Start the server without launching a browser |
| `--no-footer` | Omit the attribution footer from an export |
| `-V`, `--version` | Print the version |
| `-h`, `--help` | Show help |

## Export

```bash
turnlog export <id> [--format markdown|html|json] [--redact] [--from n] [--to n]
```

`--format` defaults to markdown. `--from`/`--to` are message indexes and mark the output
an excerpt. `--redact` scrubs token shapes, emails and home paths. `--html` is a
long-standing alias for `--format html`.

## Search

```bash
turnlog search <query> [--limit n] [--json]
```

Same operators as the UI — see [Search operators](/docs/reference/search-operators). Hits
print with deep links into the running UI.

## Environment

| Variable | Does |
|---|---|
| `TURNLOG_DATA_DIR` | Where the index lives (default `~/.config/turnlog`) |
| `TURNLOG_NO_UPDATE_CHECK` | Set to `1` to skip the npm version check |

## Exit codes

`turnlog doctor` exits non-zero when SQLite's integrity check fails, so it can gate a
script. Everything else exits zero on success.
