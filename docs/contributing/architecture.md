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
loss. Records an adapter *does* recognise as harness-internal — request snapshots, cache
latches, file-history deltas — are `kind='bookkeeping'`: stored the same way, carrying no
search text, and not counted as drift, so `unknown` keeps meaning "a shape nobody has
seen yet".

## Indexer

Runs in a worker thread, so parsing and SQLite writes never block the API. Incremental by
per-file byte offset; a chokidar watcher keeps live sessions current.

SQLite in WAL mode, single writer. FTS5 with `unicode61 tokenchars '_$.'` so identifiers
survive tokenization, plus an optional trigram twin for deep search.

Two invariants worth knowing, both learned from real data:

- **Usage counts once per API response, not per line.** Agents write one line per content block, each repeating the same `message.id` and the same usage object. Per-line summing inflates cost ~2.7×.
- **Spend dedupes across a resume chain.** Resuming copies the whole history into a new file; counting per file bills one conversation many times.

## Server

Bare `node:http` — chosen over a framework to keep chokidar the only runtime
dependency; the index lives in Node's built-in SQLite (`node:sqlite`), so
installing Turnlog compiles, downloads and approves nothing. Binds loopback only, on a random port, with a per-launch
token required on every request and `Host`/`Origin` validated against localhost.

Everything is `GET` except a short allowlist for your own annotations. The typed API
contract lives in one file that the web UI imports type-only, so the two cannot drift.

One route reads outside the index: the media route, which serves an image or video a
session names by path (a file the agent sent you, a recording dragged into a prompt).
It answers only when the path appears verbatim in the named message's own record, the
extension is an image or video, and the file's leading bytes agree — SVG is refused, the
response is sandboxed, and byte ranges are honoured so video can seek. The app shell is
served with a Content-Security-Policy that allows only its own origin, which is what
keeps an image URL inside a log from ever becoming a request.

## Web UI

React + Vite, shipped prebuilt inside the npm package. Nothing loads from the network,
ever — fonts are bundled, icons are vendored path data. Long lists are virtualized;
syntax highlighting runs in a web worker behind a language whitelist and a size cap.

Threading is rebuilt client-side from the `parentUuid` chain: tool calls fold with their
results, subagent runs nest under the call that spawned them, and abandoned branches fold
away. That last rule is implemented on both sides — server and client — and the two must
stay in step. Consecutive harness records (bookkeeping, injected context, a title or mode
repeated unchanged, turn timings) fold into one quiet row, so the log reads as the
conversation; every one of them is still there to open.

## MCP server

The same query functions the HTTP API uses, over hand-rolled newline-delimited JSON-RPC
2.0 on stdio. Tools-only, read-only, permanently — and every tool says so in the
protocol's own annotations (`readOnlyHint`), so a client can verify it from the tool list.
In MCP mode stdout is the protocol channel, so every diagnostic goes to stderr.

## Testing

Golden files snapshot the whole corpus, so any adapter change shows up as a reviewable
diff — that is the point of them. The server-hardening tests are load-bearing and are
never weakened. `npm run preflight` is typecheck + lint + build + tests with strict exit
codes.
