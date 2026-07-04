# Turnlog

*Search and replay every Claude Code session you've ever run — locally.*

`npx turnlog` starts a localhost-only server that indexes `~/.claude/projects/` into SQLite + FTS5 and opens a web UI for full-text search and session replay. 100% local: no accounts, no telemetry, no outbound network.

**Status: pre-release.** Phase 1 (parser, incremental indexer, hardened localhost server, JSON API) is complete; the full viewer UI is in progress. See `docs/roadmap.md`.

## Development

```sh
npm install
npm test               # vitest suite incl. golden-file parser snapshots
npm run build          # tsc → dist/
node bin/turnlog.cjs   # start the server against ~/.claude/projects
node bin/turnlog.cjs index --rebuild   # rebuild the index from scratch
```

The index lives in `~/.config/turnlog/` (`%APPDATA%\turnlog` on Windows); override with `TURNLOG_DATA_DIR`. The server binds 127.0.0.1 only, on a random port, with Host/Origin validation and per-launch token auth — verify with `lsof -iTCP -sTCP:LISTEN | grep node`.

Claude Code's JSONL format is undocumented and changes without notice. The parser's rule is *never crash, never drop*: unrecognized records are stored as `kind='unknown'` with the raw line preserved. Adapter changes ship with corpus fixtures and regenerated golden files (`npm run golden:update`).
