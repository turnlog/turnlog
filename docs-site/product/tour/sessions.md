---
title: "Sessions"
description: "The sidebar, the home screen, and how a resumed conversation reads as one thing instead of five."
---

# Sessions

## The sidebar

Every session, newest activity first. Each row carries the project, which agent wrote it,
the model, your tags, and one figure — **whichever figure the list is sorted by**. Sort by
cost and you read costs; sort by tokens and you read tokens. Sorting by a number you
cannot see makes an order look arbitrary. The rest of the figures are one hover away on
the row's info button.

Filter by name in the always-visible field. Project, tag, sort, direction and
"hide empty" live behind the tuning button, with a dot on it when a hidden filter is
narrowing the list — a filtered sidebar is never a silent mystery.

Collapse it and it becomes a rail of session tiles, in the same order, with the same
filters applied. A pinned session keeps its mark; the one you are reading keeps its bar;
anything touched in the last five minutes keeps its live dot.

## Resumed conversations read as one

When you resume a session, your agent copies the entire history into a new file. Naively
indexed, that gives you five sessions that are really one conversation, and it counts the
cost five times.

Turnlog links them by the first message's id, collapses the chain to its tip in lists,
and shows a chain badge with the number of files. Spend is counted **once** per chain.

## Live sessions

A session your agent is writing right now updates in the UI within about a second, over a
local event stream — no reloads, no polling. The home screen shows a card for whatever is
running, with the last thing you asked and the cost so far. Two agents working at once
show side by side.

## Your own marks

Sessions take a **pin** (to the top of the list), a **name** of your own, a free-text
**note**, and **tags** — free-form labels that also narrow searches as `tag:billing`.
Individual moments take a **bookmark** with a caption.

All of it lives in tables that a re-index does not touch, and travels with
`turnlog annotations export`. Re-indexing never costs you your organisation.
