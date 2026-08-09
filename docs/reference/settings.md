---
title: "settings.json"
description: "Every setting Turnlog reads, and what each one changes. Canonical — if the settings shape changes, edit this page."
---

# settings.json

Optional. There is no settings UI on purpose — create the file only if you want one of
these.

```
~/.config/turnlog/settings.json          macOS, Linux (XDG)
%APPDATA%\turnlog\settings.json          Windows
```

```jsonc
{
  // Correct the shipped price table for your rates — Bedrock, Vertex,
  // enterprise agreements, or plain disagreement. USD per million tokens;
  // any field you omit keeps the shipped value. Matched by model id.
  "modelPricing": {
    "claude-sonnet-4-5-20250929": { "input": 2.4, "output": 12 }
  },

  // Open-in-editor buttons in the web UI. Unset, they don't render.
  // `{path}` is replaced with the file's absolute path; never run through
  // a shell. Try "code -g {path}" or "webstorm {path}".
  "editorCommand": "code -g {path}",

  // Skip the npm version check on startup
  // (same as TURNLOG_NO_UPDATE_CHECK=1).
  "checkUpdates": false,

  // Drop the "Exported with Turnlog" footer from markdown exports.
  "exportFooter": false
}
```

## `modelPricing`

Per-model overrides on top of the shipped table. The five fields are `input`, `output`,
`cacheRead`, `cacheWrite5m` and `cacheWrite1h`, all **USD per million tokens**. Omit any
and the shipped value stands.

Costs are baked in at index time, so existing rows reprice on the next scan. They remain
labelled estimates.

## `editorCommand`

Turns on the open-in-editor buttons in the replay's diffs lens and on the Files screen.
The endpoint that backs them **only exists when this setting is present**, it can open
only paths that appear in the session's own file list, and the template is split on
whitespace and spawned directly — never through a shell.

## `checkUpdates`

`false` disables the one optional network call Turnlog makes. `TURNLOG_NO_UPDATE_CHECK=1`
does the same thing per-run.

## `exportFooter`

`false` removes the attribution footer from markdown exports. `--no-footer` does the same
per-export.
