---
title: "Adding an agent"
description: "What it takes to teach Turnlog a new agent's logs — and why every feature works the moment the adapter lands."
---

# Adding an agent

Every feature in Turnlog is built on the **normalized layer**, never on a vendor's file
format. Search, replay, spend, lenses, export and MCP all read one record shape. So an
adapter is the whole job: land it and the rest works.

## The shape

An adapter is a pure function:

```
(raw record, raw line, fallback id) → NormalizedRecord
```

`NormalizedRecord` carries what every agent has in common — identity and threading
(`uuid`, `parentUuid`), `kind`, `role`, timestamp, tool name and pairing id, error flag,
model, token counts, cwd, git branch, files touched, searchable `text`, and the original
line verbatim.

Anything the agent does not record is `null`. Reporting a gap honestly is correct;
inventing a value is not.

## The rules

**Never crash, never drop.** An unrecognized record becomes `kind: 'unknown'` with its raw
JSON kept. A malformed line must not lose the rest of the file.

**Pure and synchronous.** No I/O, no clock, no randomness — that is what makes golden
snapshots meaningful.

**Stream, never slurp.** Files are read line by line with byte offsets so indexing can
resume mid-file.

**Text is for search.** Put in what a person would search for. Leave out what would
drown the index — a giant instructions blob belongs in `raw`, not in `text`.

## The checklist

1. **Corpus fixtures** — real-shaped sample files, added to `fixtures/`.
2. **The adapter** — a pure function in `src/parser/adapters/`.
3. **Discovery** — where the agent's logs live, skipped silently when absent.
4. **Goldens** — `npm run golden:update`, then *read the diff*. That is what it is for.
5. **A version constant** — per agent, so bumping one does not reindex the others. Bump it whenever normalization output changes; it forces a re-index that backfills the change.
6. **Identity** — one `--agent-*` colour token, one brand mark, one registry entry.

## What not to do

Do not add a column, a screen or a code path "for this agent". If a feature needs
per-agent handling, the normalized layer is missing a field — add it there, where every
other agent gets it too.

Do not write into the agent's data directory. Ever. If a format cannot be read without
opening something risky, copy it first, as the Cursor IDE extractor does.
