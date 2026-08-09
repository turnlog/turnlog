---
title: "Share a session"
description: "Markdown, a self-contained web page, or JSON — with redaction and turn ranges, so you share the fix and not the whole afternoon."
---

# Share a session

Exports are the one way session content leaves Turnlog, and only when you ask.

## From the UI

The share button in the replay header gathers every option into one panel: format,
redaction, and whether to send the whole session or a range of turns.

## From the terminal

```bash
turnlog export d987e733                      # markdown to stdout
turnlog export d987e733 --format html > s.html
turnlog export d987e733 --format json | jq '.messages[0]'
turnlog export d987e733 --redact --from 12 --to 30
```

The id can be a unique prefix. `--from`/`--to` are message indexes, and the output is
marked an excerpt so nobody mistakes it for the whole run.

## The three formats

**Markdown** — for a PR description, an issue, or a message to a colleague. Diffs render
as minimal ±line changes.

**HTML** — one self-contained styled page. Everything is inline, so it works from a file,
an attachment, or a static host, with no network access at all. Each prompt is a folding
turn with its tool and error counts, so a 300-turn session arrives as 300 scannable lines.
Native `<details>`, no script — it still folds with JavaScript off.

**JSON** — the normalized message stream, for piping into `jq` or your own tooling.

## Redaction

`--redact` scrubs token shapes, email addresses and home directory paths before anything
is written. It is opt-in on every format.

It is a regex scrub, so treat it as a strong first pass rather than a guarantee — read
what you are about to publish. Session content is your own text and your own code, and
Turnlog cannot know which parts you consider secret.

## A note on HTML safety

Logs are untrusted input, so exported HTML escapes all content, and the API serves it as
a download rather than rendering it. A session that contains markup can never execute on
Turnlog's own origin.
