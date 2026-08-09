---
title: "Replay"
description: "A 5,000-message session as ten scannable turns — the spine, the lenses, and the things a naive log viewer gets wrong."
---

# Replay

## The turn spine

A long session is unreadable as a flat log. The spine collapses it to your prompts —
each one a turn, with a mechanical summary of what happened underneath: reads, edits,
commands, errors, tokens.

That is the default because it matches how you remember a session ("the turn where I
asked it to fix the reconnect"), not how the file is written. `j`/`k`/`enter` walk it.
Switch to the log view for every record in order.

## Lenses

Collapse the session to one dimension: **diffs**, **commands**, **errors**, or
**prompts**. Each owns a colour everywhere it appears, so the count in a turn summary and
the pill in the header are the same thing.

The diffs lens pivots to a per-file view: every change to one file, in order, across the
whole session. Diffs read unified or side-by-side, and the choice is remembered.

## What it gets right

**Threading, not a flat array.** Records form a `parentUuid` chain with real branches.
Most multi-child nodes are not branches — one API response is many lines chained under
each other. A real branch is nearly always a prompt you interrupted and retyped, and
Turnlog folds the abandoned attempt away rather than showing it twice.

**Subagent runs nest.** Task subagents write their own transcripts; they appear as
collapsible threads under the call that spawned them, and their usage rolls into the
parent's totals.

**Tool calls pair with results**, and results collapse by default because they can be
enormous.

**Every agent replays richly.** Codex `exec` renders as highlighted code, Cursor's tools
show their real arguments, and Codex reasoning folds like thinking. The replay recognises
each agent from the record's own shape; an unfamiliar shape degrades to plain text
instead of breaking.

**Screenshots render.** Images you pasted, and images tools handed back, appear as
thumbnails you can click to enlarge — decoded locally from the record.

## Context window

The stats panel draws how full the context was at every response, with compaction points
marked on the curve and flagged on the turn where they happened. Worth checking before
trusting a session's late answers: after a compaction, the early context was summarised
away.

## Related sessions

A quiet **related** row: the other sessions that talk about what this one talks about,
each link landing on the message where they say it. Built from the session's own rarest
words — no model involved. It is also the [`like:`](/docs/reference/search-operators)
operator, so it composes with everything else.

## Unrecognized records are kept

Agent log formats are undocumented and change without notice. Anything Turnlog does not
recognise is stored whole and rendered as a collapsed "unrecognized event" row. Format
churn is a cosmetic bug here, never data loss.
