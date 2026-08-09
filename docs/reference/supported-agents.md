---
title: "Supported agents"
description: "Which agents Turnlog reads, where their logs live, and what each format does and does not carry."
---

# Supported agents

| Agent | Read from | Notes |
|---|---|---|
| **Claude Code** | `~/.claude/projects/**/*.jsonl` | Includes subagent transcripts under `<session>/subagents/` |
| **OpenAI Codex** | `~/.codex/sessions/**/*.jsonl` | Rollout files |
| **Cursor CLI** | `~/.cursor/projects/**` | `cursor-agent` transcripts, subagent runs included |
| **Cursor IDE** | the IDE's `state.vscdb` | Copied before reading; the original is never opened |

All read-only. Sources that are not present are simply skipped — there is nothing to
configure.

## One timeline per repo

Work on one repo with several agents is **one project**, because a project is the repo,
not the tool. `agent:claude`, `agent:codex` and `agent:cursor` narrow to one.

## What each format carries

Turnlog normalizes every agent to one record shape, so features work everywhere. But a
field can only be shown if the agent wrote it:

| | Claude Code | Codex | Cursor CLI | Cursor IDE |
|---|---|---|---|---|
| Prompts, replies, tool calls | ✅ | ✅ | ✅ | ✅ |
| Token usage | ✅ | ✅ | ✅ | — |
| Cost | estimated | estimated | estimated | as Cursor recorded it |
| Git branch | ✅ | ✅ | — | — |
| Context-window curve | ✅ | — | — | — |
| Subagent transcripts | ✅ | — | ✅ | — |

A gap here is the log's, not the adapter's: Turnlog reports null rather than inventing a
value. Older Claude Code builds did not stamp a branch either, so some historical
sessions have none.

## Adding an agent

An adapter is a pure function from that agent's raw record to the normalized shape. Every
feature — search, replay, spend, export, MCP — then works for it without changes, because
nothing is built against a vendor's file format. See
[Adapters](/docs/contributing/adapters).
