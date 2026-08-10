/**
 * The text `turnlog skill` prints: a skill file that teaches an agent WHEN to
 * reach for the MCP tools, which the tool list alone never does.
 *
 * Printed, never installed. Turnlog does not write into `~/.claude` — that
 * guarantee is worth more than saving the user a redirect — and stdout is the
 * one target that works for every agent's own convention, present and future.
 *
 * The operator list here is drift-tested against FILTER_OPS (test/docs.test.ts):
 * an operator the skill does not know is one the agent will never use.
 */
export const SKILL_MD = `---
name: turnlog
description: >-
  Search your own past agent sessions before solving something from scratch.
  Use when the user refers to earlier work ("we did this before", "last time",
  "what was that command", "didn't we fix this"), when an error looks like one
  you have seen, when starting on an unfamiliar repo that has history, or when
  you are about to re-derive a decision rather than recall it. Also use to find
  which sessions touched a file, and what a past session actually cost.
---

# Turnlog — your history, searchable

Turnlog indexes every coding-agent session on this machine (Claude Code, Codex,
Cursor) and serves them over MCP, read-only. It is memory you already earned:
the questions below are answerable from it and from nothing else.

## Reach for it when

- The user says **"we did this before"**, "last time", "what was that command",
  "didn't we already fix this", "how did I set that up" — search first, answer
  second. Guessing when the answer is indexed is the failure mode this exists
  to prevent.
- **An error repeats.** Search its text: if a past session hit it, the fix is
  in that session, and \`is:error\` narrows to failures.
- **You are about to change an unfamiliar file.** \`file_history\` shows every
  session that touched it and what each one did — the reasoning behind the
  current shape is in those sessions, not in the diff.
- **A decision looks arbitrary.** It usually is not; it was argued somewhere.
- **Starting on a repo with history.** \`list_sessions\` with a project
  fragment shows what has been done here and how recently.

Do NOT search for things the repo answers directly — the current code, the
file tree, git log. Turnlog is for what was *said and tried*, not what is.

## Tools

| Tool | Question |
|---|---|
| \`search\` | which session, and where in it |
| \`list_sessions\` | what happened here / recently |
| \`get_session\` | a session's turn spine — skim before reading messages |
| \`get_messages\` | the actual conversation, paged, optionally one lens |
| \`get_context\` | how full the window got, and whether it was compacted |
| \`file_history\` | every session that touched this file |

Read \`get_session\` before \`get_messages\`: the spine is a mechanical summary
per turn, so you can find the right turn without paging a 3,000-message replay.

## Query grammar

Operators compose with each other and with free text; unknown ones stay text,
so \`file.ts:12\` is safe to search.

\`\`\`
tool:Bash  kind:prompt  is:error  is:pinned  has:note  has:bookmark
project:api  model:opus  agent:codex  tag:billing  path:api.ts
branch:main  like:<session-id>  before:2026-07  after:7d
\`\`\`

Values with spaces take quotes: \`tag:"needs review"\`. Dates accept \`7d\`,
\`today\`, \`yesterday\`, or an ISO prefix. \`like:<session-id>\` finds sessions
about the same subject as that one — the "have I solved this before" query.

Useful shapes:

\`\`\`
websocket reconnect after:30d          what did we try, recently
is:error tool:Bash project:api         failing commands in one project
path:auth.ts branch:main               work on that file, on main
like:d987e733 is:error                 same subject, sessions that hit errors
\`\`\`

## Reporting what you find

**Cite the session id** for anything you assert from history — it is how the
user opens the replay and checks you. Say when the work happened; a decision
from six months ago may have been superseded by the code in front of you.

Prefer a quoted line from the session over your paraphrase of it. Do not
present a past attempt as a current fact: "in session d987e733 this was tried
and reverted" is useful; "this doesn't work" is not.

## What it cannot do

Turnlog is **strictly read-only** — no tool writes anything, ever, and it never
touches the agents' own log files. To remember something for next time, write
it to your own memory and cite the Turnlog session id you learned it from.
`;
