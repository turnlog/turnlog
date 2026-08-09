---
title: "Architecture"
description: "How a line of undocumented JSONL becomes a searchable, replayable session — and the invariants that keep it honest."
---

# Architecture

Written for humans reading the codebase for the first time. It is not a redirect to
`CLAUDE.md`, which is terse on purpose and aimed at agents.

```
JSONL on disk  →  parser  →  indexer (SQLite + FTS5)  →  local HTTP API  →  React UI
                                                      ↘  MCP server (stdio)
```

One npm package, one process, one SQLite file. No services, no daemons.

## Parser

`RawLine → VersionSniffer → AdapterVN → NormalizedRecord`

Adapters are **pure functions** in one directory — raw record in, normalized record out —
so they are snapshot-tested against a corpus with golden files. Files are stream-parsed
by line with byte offsets, never `JSON.parse`d whole: sessions run to hundreds of
megabytes.

**The cardinal rule is never crash, never drop.** These formats are undocumented and
change without notice. An unrecognized record is stored with `kind='unknown'` and its raw
JSON, and rendered as a collapsed row. Format churn must be a cosmetic bug, never data
loss.

## Indexer

Runs in a worker thread, so parsing and SQLite writes never block the API. Incremental by
per-file byte offset; a chokidar watcher keeps live sessions current.

SQLite in WAL mode, single writer. FTS5 with `unicode61 tokenchars '_$.'` so identifiers
survive tokenization, plus an optional trigram twin for deep search.

Two invariants worth knowing, both learned from real data:

- **Usage counts once per API response, not per line.** Agents write one line per content block, each repeating the same `message.id` and the same usage object. Per-line summing inflates cost ~2.7×.
- **Spend dedupes across a resume chain.** Resuming copies the whole history into a new file; counting per file bills one conversation many times.

## Server

Bare `node:http` — chosen over a framework to keep runtime dependencies at
better-sqlite3 and chokidar. Binds loopback only, on a random port, with a per-launch
token required on every request and `Host`/`Origin` validated against localhost.

Everything is `GET` except a short allowlist for your own annotations. The typed API
contract lives in one file that the web UI imports type-only, so the two cannot drift.

## Web UI

React + Vite, shipped prebuilt inside the npm package. Nothing loads from the network,
ever — fonts are bundled, icons are vendored path data. Long lists are virtualized;
syntax highlighting runs in a web worker behind a language whitelist and a size cap.

Threading is rebuilt client-side from the `parentUuid` chain: tool calls fold with their
results, subagent runs nest under the call that spawned them, and abandoned branches fold
away. That last rule is implemented on both sides — server and client — and the two must
stay in step.

## MCP server

The same query functions the HTTP API uses, over hand-rolled newline-delimited JSON-RPC
2.0 on stdio. Tools-only, read-only, permanently. In MCP mode stdout is the protocol
channel, so every diagnostic goes to stderr.

## Testing

Golden files snapshot the whole corpus, so any adapter change shows up as a reviewable
diff — that is the point of them. The server-hardening tests are load-bearing and are
never weakened. `npm run preflight` is typecheck + lint + build + tests with strict exit
codes.
