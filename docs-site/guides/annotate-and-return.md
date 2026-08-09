---
title: "Annotate, so you can come back"
description: "Pins, names, notes, tags and captioned bookmarks — the marks that make a 3,000-message session findable in six weeks."
---

# Annotate, so you can come back

Search finds what you can describe. Annotation is for what you cannot — the session that
mattered for a reason no keyword captures.

All of it survives re-indexing and rebuilds, and travels with
`turnlog annotations export`.

## Sessions

**Pin** — sticks it to the top of the sidebar. For the two or three you are living in.

**Name** — your own words over the agent's generated title. `customName` wins over the
agent's own title, which wins over the project name.

**Note** — free text on the session. A dot on the row shows one exists; hovering lifts it.

**Tags** — free-form labels, several per session, normalised so `Refactor` and `refactor`
are one tag. They filter the sidebar, and narrow any search:

```
tag:billing is:error
```

## Moments

A **bookmark** marks one message. Hover the left gutter of any block and click the marker.

Give it a **caption**. Thirty unlabelled bookmarks are thirty message prefixes to re-read;
*"the fix that finally worked"* is not. The bookmarks page collects every marked moment
across every session, newest first, and clicking one lands exactly where it was.

## Getting them out

```bash
turnlog annotations export > my-annotations.json
turnlog annotations import my-annotations.json
```

One JSON document with pins, names, notes, tags, bookmarks and saved searches. Import is
additive and the file wins on conflict — so it moves cleanly to another machine.
