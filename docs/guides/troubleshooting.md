---
title: "Troubleshooting"
description: "One command that prints everything a bug report needs — plus the handful of things that actually go wrong."
---

# Troubleshooting

## Start here

```bash
turnlog doctor
```

Prints versions, resolved paths, your settings, index facts per agent, SQLite's own
integrity verdict, and whether the index has drifted from what is on disk. It is strictly
read-only — it will not create, migrate or touch an index, so it is safe to run against a
broken one. It exits non-zero if the integrity check fails.

Paste its output into any bug report; it is built for exactly that.

## The browser did not open

Copy the whole `UI:` line from the terminal. The `?token=` is required on every request,
so `127.0.0.1:<port>` alone will not authenticate.

Over SSH, forward a fixed port:

```bash
turnlog --port 52431 --no-open
ssh -L 52431:127.0.0.1:52431 you@host
```

## Sessions are missing

**Check the source lines** the CLI printed at startup — the Codex and Cursor lines only
appear when those directories exist.

**Empty sessions are hidden** in the sidebar by default. Turn off "hide empty" in the
filter popover.

**Deleted logs** are reported honestly: the health card counts them and disk usage marks
them "file gone". Pruning is the one way to forget them.

## Counts or costs look wrong

Costs are estimates from a shipped price table — see
[Spend](/docs/product/tour/spend#always-an-estimate) for the two ways naive counting
inflates them, and [`modelPricing`](/docs/reference/settings) to correct the rates.

If the index looks stale, `turnlog index` runs an incremental pass; `turnlog index
--rebuild` drops the derived tables and starts over. **Your annotations survive a
rebuild** — pins, names, notes, tags, bookmarks and saved searches live in tables the
rebuild does not touch.

## After an update, something looks odd

Some releases bump an adapter version, which forces a full re-index of that agent's files
on the next scan. That is expected and self-healing — it is how a parser fix reaches
sessions that were indexed before it existed.

## Windows: a leftover `.turnlog-<random>` directory

npm cannot delete the native module while a running Turnlog — or an agent's MCP process —
has it loaded, so an update can leave the old install behind and warn `EPERM`. The update
itself succeeded. Turnlog sweeps the leftovers on its next start, when nothing holds them,
and `doctor` reports any it finds without deleting them.

## Nothing works and you want a clean slate

The index is disposable:

```bash
rm -rf ~/.config/turnlog        # %APPDATA%\turnlog on Windows
npx turnlog
```

Your agents' logs are untouched by this — Turnlog never wrote to them. You lose your
annotations unless you exported them first:

```bash
turnlog annotations export > my-annotations.json
```
