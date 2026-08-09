---
title: "Search"
description: "Full-text search across every agent, what a match costs you, and the two things search does that a grep cannot."
---

# Search

Full-text search (SQLite FTS5) across every message of every session, grouped by session,
one click from the exact match. Identifiers and `snake_case` survive tokenization, so
`useWebSocket` and `MAX_RETRIES` are findable.

Everything is searched: prompts, replies, tool arguments, tool output, file contents an
agent read, and the files you edited by hand while it was running. Subagent transcripts
are indexed too.

Type words, or [operators](/docs/reference/search-operators), or both:

```
websocket reconnect
is:error tool:Bash after:7d
branch:main project:turnlog
like:d987e733 auth
```

## What this match cost

Above the results is the aggregate over the **full** match set, not the page you can see:
matched sessions, turns, tokens, and estimated spend. That is "what did this kind of work
cost me" — a question you cannot answer without a content index, which is why no cost
tracker offers it.

## Refine chips

Under the count, chips show what the current results actually contain — agents, branches,
tools, kinds, projects — each with its share. Clicking one appends the operator. A
dimension with only one value is not offered, because a chip that filters nothing away is
noise pretending to be a control.

## Timeline

Flip to the timeline and the full match set is placed on a time axis, one marker per
session, oldest first. This answers "when did this keep coming up?" — a topic that
appears in five sessions across three months looks very different from five in one
afternoon.

## Recurring failures

Search `is:error` and the results are preceded by the same failure grouped across runs,
ranked by how many **sessions** hit it, with the project count beside it: *"this happened
in 13 sessions across 3 projects."*

The grouping is mechanical and legible — paths, ids, numbers and quoted payloads are
replaced, then the first sentence becomes the key. No model is involved, so the rule is
one you can read and predict. Click a group to land on a real occurrence.

## Deep search

Ordinary search matches words. Deep search matches **inside** them: `eWebSock` finds
`useWebSocket`, half an error string finds the error, part of a UUID finds the session.

It is opt-in because it costs a few times your index's size. Build it from the health
card's Maintain row, then flip the **words | inside words** toggle. Drop it any time.

## From the terminal

```bash
turnlog search "websocket reconnect" --limit 5
turnlog search "is:error after:7d" --json
```

Same operators as the UI. Hits print with deep links into the running UI.
