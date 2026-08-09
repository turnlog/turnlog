---
title: "What is Turnlog"
description: "Search and replay every coding-agent session you've ever run — locally, across every agent, with nothing leaving your machine."
---

# What is Turnlog

Your coding agents write a transcript of everything they do. Claude Code, Codex and
Cursor all keep one, on your disk, in your home directory. Between them they hold every
prompt you wrote, every command that ran, every file that changed and every error that
came back — and none of them give you a way to look through it.

Turnlog is that way. One command, no account:

```bash
npx turnlog
```

It indexes what is already on your disk into SQLite, opens a local web UI, and lets you
search and replay the lot.

## What it is for

**Finding the thing you already solved.** You fixed this a month ago, in a session you
cannot name, in a repo you have since renamed. Full-text search across every agent, then
[`like:`](/docs/reference/search-operators) to find the other times it came up.

**Reading a run back.** A 5,000-message session collapses to a spine of prompts, each
with a mechanical summary of what happened under it. Lenses cut it down to just the
diffs, just the commands, or just the errors.

**Knowing what it cost.** Cost by day, model, or project — and, uniquely, cost filtered
by a search query, because "what did *this kind of work* cost me" is not a question a
dashboard can answer without a content index.

**Giving your agent a memory.** `turnlog mcp` serves the same index to any MCP-capable
agent, read-only, so it can search its own past work mid-task.

## What it is not

It is not a cost dashboard with a log viewer bolted on, and it is not a hosted service.
There is no account, no seat, no cloud, and no upsell — it is MIT-licensed and free, and
every version stays installable from npm forever.

It also never writes to your agents' data. `~/.claude`, `~/.codex` and `~/.cursor` are
opened read-only and never modified; Cursor's IDE database is *copied* before it is read,
so the original is never even opened. See [Privacy](/docs/product/privacy).

## Every agent, one history

Turnlog reads Claude Code, OpenAI Codex, and Cursor — both the `cursor-agent` CLI and the
IDE's own chats. Work you did on one repo with three different agents reads as **one
timeline**, because a project is the repo, not the tool. Which agent wrote a session is
always visible, and `agent:codex` narrows to one.

New agents are added at the [normalized layer](/docs/contributing/adapters), so every
feature — search, replay, spend, export, MCP — works for a new agent the day its adapter
lands. Nothing is built against one vendor's file format.
