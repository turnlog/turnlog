---
title: "Search your history"
description: "Find the session you cannot name — the four operators worth learning first, and what to reach for when plain words fail."
---

# Search your history

## Start with words

Type what you remember. Search covers prompts, replies, tool arguments, tool output, file
contents an agent read, and files you edited by hand mid-run.

```
websocket reconnect backoff
```

If you get too much, narrow it. If you get nothing, see [When words fail](#when-words-fail).

## The four worth learning first

**`is:error`** — every failure, and above the results the same failure grouped across
runs. The fastest way from "this keeps breaking" to "it broke here, 13 times."

```
is:error after:7d
```

**`project:`** — scope to one repo. Matches a fragment, so `project:turnlog` is enough.

**`after:` / `before:`** — plain-word dates. `after:7d`, `after:today`, `after:yesterday`,
or an ISO prefix like `after:2026-06`.

**`like:<session-id>`** — "have I solved this before?" The other sessions that talk about
what that one talks about, its own resume chain excluded.

```
like:d987e733 auth
```

## Narrowing without knowing the grammar

Run a search, then click the **refine chips** under the result count. They show what your
current results actually contain — agents, branches, tools, kinds, projects — and clicking
one appends the right operator. A dimension with a single value is not offered.

## When words fail

**You remember a fragment, not a word.** Build the opt-in deep-search index (health card
→ Maintain), then flip **words | inside words**. `eWebSock` finds `useWebSocket`.

**You remember the file, not the phrase.** `path:useWebSocket.ts` finds every session that
touched it; the Files screen then reads every change to it in order.

**You remember roughly when.** Flip to the timeline — the full match set on a time axis,
one marker per session.

**You remember the branch.** `branch:feature/auth` — every agent's work on that branch.
Exact match, so `branch:main` never drags in `main-experiment`.

## Save the ones you repeat

Any query can be saved and reappears in ⌘K. Turnlog seeds a few starters, like recent
failures.

## From the terminal

```bash
turnlog search "is:error tool:Bash after:7d"
turnlog search "branch:main" --json --limit 50
```

Hits print with deep links into the running UI. Full grammar:
[Search operators](/docs/reference/search-operators).
