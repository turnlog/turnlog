# Security Policy

Turnlog is a **100% local** tool: it binds to `127.0.0.1` only, makes no
outbound connections (save one opt-out-able npm version check), stores no
credentials, and has no accounts or cloud component. Its threat model is
therefore narrow — the main surface is *another local process or a web page in
your browser reaching the localhost server* — and defending it is v1 scope, not
an afterthought.

## Reporting a vulnerability

Please report security issues **privately**, not as a public GitHub issue.

- Email **movsisyan.gor@gmail.com** with the subject line `turnlog security`, or
- Open a [GitHub private security advisory](https://github.com/turnlog/turnlog/security/advisories/new).

Include the version (`turnlog --version`), your OS, and a minimal reproduction.
I aim to acknowledge within **72 hours** and to ship a fix (or a mitigation +
timeline) for confirmed issues in the next patch release. There is no bug-bounty
program, but credit is given in the release notes unless you prefer otherwise.

## Supported versions

Turnlog is distributed only through npm, which is also the update channel. Only
the **latest published version** is supported; fixes ship as a new release
rather than being backported. Run `npm i -g turnlog@latest` (or just `npx
turnlog`, which always fetches the newest) to stay current.

## In scope

The hardening below is load-bearing and covered by tests
(`test/server.test.ts`) — regressions here are treated as vulnerabilities:

- **Loopback-only bind** on a random high port.
- **`Host` / `Origin` header validation** against localhost (DNS-rebinding
  defense) — foreign or wrong-port hosts get a 403.
- **Per-launch session token**, required on every `/api` request (query param
  or `Bearer` header); no token ⇒ 401.
- **No CORS headers** — the API is same-origin only.
- **No outbound network** from the app beyond the documented, opt-out-able npm
  update check (`TURNLOG_NO_UPDATE_CHECK=1` / `"checkUpdates": false`).
- **Parser safety:** untrusted session logs are never `eval`'d or rendered as
  raw HTML; unrecognized records degrade to a collapsed row, never crash the
  process (the parser's "never crash, never drop" rule).

## Out of scope

- A local user who already has read access to `~/.claude/projects` and can run
  processes as you: Turnlog only reads files you already own, and the index sits
  in your own config dir. Protecting data from yourself is not a goal.
- Denial of service from deliberately malformed multi-hundred-MB JSONL you feed
  it — the parser aims to stay up, but pathological local input is not a
  security boundary.
- The optional npm registry version check leaking that *a* machine is running
  Turnlog to the registry (standard for any npm install); disable it if that
  matters to you.
