---
title: "Agent memory in Claude Code"
description: "One command to give Claude Code searchable memory of every session you have ever run — read-only, local, across every agent."
---

# Agent memory in Claude Code

Turnlog's index is the thing your agent is missing: a searchable record of every session
you have ever run, including the ones written by *other* agents.

## Register it

```bash
claude mcp add turnlog -- npx turnlog mcp
```

That is the whole setup. No port, no URL, no account — MCP runs over stdio, so Claude
Code starts the process itself.

Check it took:

```bash
claude mcp list
```

## What it can do

Six read-only tools: `search`, `list_sessions`, `get_session`, `get_messages`,
`get_context`, `file_history`. See [MCP tools](/docs/reference/mcp-tools) for parameters.

Ask in plain language — the agent picks the tool:

> How did we fix the WebSocket reconnect loop last month?

> What did I try before the current auth approach, and why did it get abandoned?

> Has this error appeared before? Search my history for it.

Because it is the same search grammar, operators work through the agent too:
`is:error tool:Bash after:7d`, `branch:main`, `like:<session-id>`.

## What it cannot do

**It cannot write.** There are no write tools and no flag that adds them. An agent that
wants to remember something writes to its own memory and cites the session id.

This is deliberate: "it cannot write anything" is a guarantee a stranger can verify from
the tool list, and that stops being true the moment an opt-in exists. The annotation
tables are a human curation surface — `is:pinned` has to keep meaning *"I flagged this."*

## Teach it when to look

Registering the server gives Claude the tools. It does not give it the habit — tools are
consulted when something makes them seem relevant, so in practice the agent waits until
you ask. `turnlog skill` prints a skill file that closes the gap: the triggers (you
referred to past work, an error looks familiar, an unfamiliar file is about to change),
the query grammar, and the rule to cite the session id so you can check any claim.

```bash
mkdir -p ~/.claude/skills/turnlog
npx turnlog skill > ~/.claude/skills/turnlog/SKILL.md
```

It prints instead of installing itself. Turnlog does not write into `~/.claude` — the
read-only guarantee is worth more than saving you a redirect — and other agents keep
their instructions elsewhere, so stdout is the one target that serves all of them. See
[the CLI reference](/docs/reference/cli) for the same command.

## Worth telling your agent

`get_context` reports how full a past session's context window was and where it was
compacted. Late answers in a heavily-compacted session were produced after the early
context had been summarised away — worth checking before trusting them.

Agents that do not log a running window total (Codex) return honest nulls rather than a
fabricated curve.
