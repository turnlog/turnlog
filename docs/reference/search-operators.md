---
title: "Search operators"
description: "Every operator, whether it matches exactly or by fragment, and how they combine. Canonical — the UI, the CLI and the MCP server all parse the same grammar."
---

# Search operators

One grammar, three places: the search screen, `turnlog search`, and the MCP `search`
tool. Operators combine with each other and with free text, and any operator works alone.

Anything Turnlog does not recognise as an operator stays a search term, so `file.ts:12`
and `https://…` never break a query.

## Matching

| Operator | Matches | Example |
|---|---|---|
| `tool:` | exact, case-insensitive | `tool:Bash` |
| `kind:` | exact, case-insensitive | `kind:prompt` |
| `branch:` | exact, case-insensitive | `branch:feature/auth` |
| `agent:` | exact, plus the adapter's variants | `agent:cursor` |
| `tag:` | exact (tags are normalised) | `tag:billing` |
| `model:` | **fragment** | `model:opus` |
| `project:` | **fragment** | `project:turnlog` |
| `path:` | **fragment**, over files the session touched | `path:api.ts` |
| `cmd:` | **fragment**, over the commands tool calls ran | `cmd:"ffmpeg -i"` |
| `server:` | **fragment**, over the MCP server of `mcp__…` calls | `server:playwright` |
| `like:` | session id or unique prefix | `like:d987e733` |
| `is:` | `error`, `pinned` | `is:error` |
| `has:` | `note`, `bookmark` | `has:note` |
| `before:` / `after:` | date bound | `after:7d` |

Exact where a name is a literal, fragment where you would not want to type the whole
thing. `branch:main` never matches `main-experiment`; `project:turnlog` does match
`turnlog.landing`, which is usually what you want — narrow with the refine chip if not.

## Values with spaces

Quote them: `tag:"needs review"`. The quotes are syntax, not part of the value.

## Dates

`before:` and `after:` take either an ISO prefix or plain words:

```
after:2026            after:2026-08         after:2026-08-09
after:7d              after:today           after:yesterday
```

`after:` is inclusive, `before:` exclusive. A value that is not a date stays a search
term rather than silently matching everything.

## The two that are not filters

**`is:error`** also switches on the recurring-failure band above the results — the same
failure grouped across runs. Only error queries pay for that scan.

**`like:<session-id>`** builds its terms from the target session's own rarest words and
excludes that session's resume chain. Combine it with text to narrow:
`like:d987e733 auth`.

## Combining

Everything AND-s:

```
branch:main is:error after:7d
project:turnlog tool:Bash npm test
agent:codex kind:prompt after:2026-08
like:d987e733 is:error
```

## Deep search

With the opt-in trigram index built, the **inside words** toggle changes matching from
whole words to substrings — `eWebSock` finds `useWebSocket`. Terms shorter than three
characters cannot be served by a trigram index and are dropped; a query made only of them
returns nothing rather than silently searching for something else.
