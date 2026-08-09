---
title: "MCP tools"
description: "The six read-only tools turnlog mcp exposes, with parameters — a hand-kept snapshot of the server's TOOLS array."
---

# MCP tools

`turnlog mcp` is a stdio MCP server exposing the local index as **six read-only tools**.
There are no write tools and no flag that adds them — see
[why](/docs/guides/mcp-claude-code#what-it-cannot-do).

Setup: [Claude Code](/docs/guides/mcp-claude-code) · [any other client](/docs/guides/mcp-other-agents).

## `search`

Full-text search across every indexed session, every agent. The main one.

| Parameter | Type | |
|---|---|---|
| `query` | string | **required.** Terms and/or [operators](/docs/reference/search-operators) |
| `limit` | number | max hits, default 20, max 100 |

Returns hits grouped by session, with `totalHits` and cost aggregates. Use a hit's
`sessionId` + `idx` with `get_messages` to read around it.

## `list_sessions`

Recent sessions, most recently active first, every agent. For orienting before searching.

| Parameter | Type | |
|---|---|---|
| `project` | string | only sessions whose project path contains this fragment |
| `limit` | number | default 20, max 100 |

Empty sessions are hidden. Each row says which agent wrote it, plus model, branch, tags,
cost and event count.

## `get_session`

One session's metadata plus its **turn spine** — every prompt with mechanical counts of
what happened under it (reads, edits, commands, subagents, errors).

| Parameter | Type | |
|---|---|---|
| `session` | string | **required.** Session id or unique prefix |

Call this after `search` to understand a session's shape before reading messages.

## `get_messages`

A window of messages from one session, in order.

| Parameter | Type | |
|---|---|---|
| `session` | string | **required.** Session id or unique prefix |
| `after_idx` | number | return messages with idx greater than this (default −1 = start) |
| `limit` | number | default 20, max 100 |
| `lens` | string | narrow to `diffs`, `commands`, `errors` or `prompts` |

To read around a search hit, pass `after_idx = hit.idx - 1`, or a few earlier for lead-in.
Long bodies are truncated.

## `get_context`

How full the context window was across a session, and where it was compacted.

| Parameter | Type | |
|---|---|---|
| `sessionId` | string | **required.** Session id |

Call it before trusting a session's late answers: work after a compaction happened with
the early context summarised away. Agents that do not log a running window total (Codex)
return honest nulls rather than a fabricated curve.

## `file_history`

Every session that touched a file, and what changed.

| Parameter | Type | |
|---|---|---|
| `path` | string | **required.** Exact path, or a fragment to discover matching files first |

<Note>
This page is a hand-kept snapshot of the server's `TOOLS` array rather than a generated
one. If a tool's parameters change, edit this page in the same commit.
</Note>
