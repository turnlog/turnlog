---
title: "Projects & files"
description: "One page per repo across every agent, and the history of a single file across every session that touched it."
---

# Projects & files

## Projects

A project is a **repo**, not a tool. Work you did on it with Claude Code, Codex and
Cursor is one timeline.

The Projects screen lists every repo you have pointed an agent at — the agents that
worked on each, its sessions, spend and last activity — filterable, sortable by recency,
sessions or spend.

Each repo has its own page: every agent's sessions interleaved newest-first, who worked
there and how much, what it cost, the files it touched most, its tags, and a live row
when something is running in it right now. Reach it from ⌘K, from the project name in a
session header, or from a row on Spend.

If the folder has since moved or been deleted, the page says so plainly. The history is
unaffected — agent logs never lived in the repo.

<Note>
Project identity is derived from the path today, so **moving or renaming a repo starts a
second project**. Nothing is lost; the history is split across two pages until they are
merged. This is a known limitation.
</Note>

## Files

Pick a file and read every change made to it, in order, across every session and every
agent — cumulative per-file diffs, with the sessions that produced them.

`path:api.ts` narrows any search to sessions that touched a matching file, and the
file-history screen is one click from any diff via **history across sessions**.

If you set [`editorCommand`](/docs/reference/settings), a button opens the real file in
your editor. It can only open paths that appear in that session's own file list.
