---
title: "Privacy & safety"
description: "100% local, read-only, no telemetry — and the specific mechanics that make those claims checkable rather than promises."
---

# Privacy & safety

Turnlog's whole value is that it reads the most sensitive text on your machine. So the
promises are narrow, and each one has a mechanism you can check.

## Nothing leaves your machine

There is no account, no cloud, no telemetry, and no analytics — not disabled by default,
**absent**. The web UI never loads anything from the network: fonts are bundled woff2,
icons are vendored path data, and images in your sessions are decoded from the record you
already have rather than fetched.

The single optional network touch is a version check against the npm registry on startup,
which surfaces as an "update available" notice. The browser never contacts npm — the Node
process does, and the answer rides along on the local status API. Turn it off with
`TURNLOG_NO_UPDATE_CHECK=1` or `"checkUpdates": false`.

## Your agents' logs are read-only

Turnlog never writes into `~/.claude`, `~/.codex` or `~/.cursor`. It opens them to read
and nothing else. The only thing it writes is its own index, in its own directory.

Cursor's IDE history is the one source that is not a plain file, and it gets the strictest
handling: the IDE's `state.vscdb` is **copied first**, and only the copy is opened. The
original is never touched, even for reading.

## The server is locked to your machine

The local server is not "probably fine because it's localhost" — it is hardened on the
assumption that something else on your machine is hostile:

- **Loopback only.** It binds `127.0.0.1`. Verify with `lsof -iTCP -sTCP:LISTEN | grep node`.
- **A random high port**, new on every run.
- **A session token**, generated fresh each launch and required on every API request. The URL carries it; a request without it is refused.
- **`Host` and `Origin` are validated** against localhost, which is what stops a website you happen to be visiting from reaching the server through DNS rebinding.
- **No CORS headers**, so no other origin can read a response.
- **Almost everything is `GET`.** Writes are a short allowlist of endpoints for your own annotations. Anything else is a 405.

## The agent-memory server cannot write

`turnlog mcp` exposes six read-only tools and no write tools. This is a deliberate,
permanent design decision rather than a default: an agent that wants to remember
something writes to its own memory and cites the session id. "It cannot write anything"
is a guarantee a stranger can verify from the tool list — which is only true if there is
no opt-in flag that changes it.

## Opening files in your editor

The open-in-editor buttons exist only if you set `editorCommand` yourself, and the
endpoint that backs them only exists when that setting is present. It can open only paths
that appear in the session's own `files_touched`, and the command is never run through a
shell.

## Sharing on purpose

Exports are the one way session content leaves Turnlog, and they only happen when you ask.
`--redact` scrubs token shapes, emails and home paths. HTML exports are served as a
download rather than rendered in the app, because a log is untrusted input and should
never execute on the app's own origin.
