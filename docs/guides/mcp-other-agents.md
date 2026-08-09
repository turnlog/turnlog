---
title: "Agent memory in any MCP client"
description: "Turnlog's MCP server is plain stdio JSON-RPC — Cursor, Codex, or anything else that speaks MCP can read the same index."
---

# Agent memory in any MCP client

`turnlog mcp` is a plain stdio MCP server. **Any** MCP-capable client can use it, not just
the agent that wrote the sessions — and it serves every indexed agent's history, so
pointing Cursor at it gives Cursor access to your Claude Code and Codex work too.

## The command

Every client needs the same thing: run `npx turnlog mcp`, talk to it over stdio.

```json
{
  "mcpServers": {
    "turnlog": {
      "command": "npx",
      "args": ["turnlog", "mcp"]
    }
  }
}
```

Where that JSON goes depends on the client — Cursor takes it in its MCP settings, and most
others use the same shape. If a client wants a single command line instead, it is
`npx turnlog mcp` with no arguments.

Installed globally? Use `turnlog` as the command and `["mcp"]` as the args, which avoids
the npx resolution step on every start.

## Notes that bite

**stdout is the protocol.** In MCP mode every diagnostic goes to stderr — nothing is
printed to stdout that is not JSON-RPC. If you wrap the command in a script, keep it that
way or the client will fail to parse the handshake.

**It reads the same index as the UI.** No separate configuration, no second copy. If the
UI can find your sessions, so can the agent.

**It is read-only**, permanently — see [Claude Code setup](/docs/guides/mcp-claude-code#what-it-cannot-do)
for why that is a design decision rather than a default.

## Checking it works

```bash
npx turnlog mcp
```

Run it in a terminal and it waits on stdin for JSON-RPC. That silence is success — it
means the server started and is listening on the protocol channel. Ctrl-C to exit.

For anything more, `turnlog doctor` reports what the index contains and whether it has
drifted from what is on disk.
