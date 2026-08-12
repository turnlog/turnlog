# Turnlog Documentation Site — Content Source

This folder holds the **content** for Turnlog's public documentation site, set up for
[Mintlify](https://mintlify.com)'s GitHub sync — the same arrangement as Reikon's
`docs-site/`. Connect a Mintlify project to this repo, point it at this directory, and it
renders. What is left is account-side (see Status).

## Status

- **Platform:** Mintlify — `docs.json` is written and all 22 pages carry frontmatter. Not
  yet connected on Mintlify's side (an account/GitHub-App action, not something committed
  here).
- **Sync branch:** `main`. Docs should redeploy on releases, not on every commit to
  `development` — set this when connecting the GitHub App.
- **URL:** `turnlog.dev/docs`, a path under the main domain rather than a subdomain.
  Mintlify is normally subdomain-hosted, so this needs the same **standalone Cloudflare
  Worker** Reikon uses: a `/docs*` route in front of the site that proxies to the
  `*.mintlify.site` origin. It lives in the Cloudflare dashboard, **not** in
  `turnlog.landing` — that repo deploys as its own Worker via Workers Builds, and adding
  a `wrangler` config to it would disturb that pipeline. Route-level precedence composes
  the two.
- **Logo/favicon:** done. `logo/light.svg` and `logo/dark.svg` are named for the MODE
  they serve, matching `docs.json`'s `logo.light`/`logo.dark` keys — light mode gets the
  dark disc, dark mode the light one, the same inversion the app's `Brandmark` does.
  `favicon.svg` is the accent tile, copied from `web/public/`. All three mirror
  `Brandmark` in `web/src/icons.tsx`; keep them in step.
- **Links** are written without `.md` extensions and rooted at `/docs/…`, matching the
  served path. If you add a page, add it to `docs.json`'s `navigation` too — pages are
  not auto-discovered.

## Structure

Four sections, matching distinct reader intent (loosely the
[Diátaxis](https://diataxis.fr/) split):

```
docs/
  product/        What it is, getting started, privacy, and a tour of each screen.
                  Read once, orients. Not task-oriented.
  guides/         Task-oriented, followed with a terminal open. Search, annotation,
                  MCP setup per client, sharing, troubleshooting.
  reference/      Lookup-oriented. Operators, CLI, settings.json, MCP tools,
                  supported agents. The credibility layer.
  contributing/   Architecture written fresh for humans (not a redirect to CLAUDE.md,
                  which stays agent-facing), and how to add an agent adapter.
```

## Canonical pages

Edit these when the thing they describe changes — they are the source of truth, not a
summary of one:

- **`reference/search-operators.md`** — the query grammar. Kept in lockstep with
  `FILTER_OPS` in `src/server/api.ts` by `test/docs.test.ts` — a count here would
  only drift; the test is the number.
- **`reference/settings.md`** — the `settings.json` shape.
- **`reference/cli.md`** — commands and flags.

## Drift guards

`test/docs.test.ts` is what keeps the reference pages true. Every check is a **set
equality in both directions**, so it fails on a newly undocumented thing *and* on a
documented thing that no longer exists — a one-way "everything is documented" check rots
silently as things are removed. It covers:

- search operators ↔ `FILTER_OPS`
- CLI commands and flags ↔ `parseArgs`
- `settings.json` keys ↔ the `Settings` interface
- MCP tool names ↔ the `TOOLS` array
- nav ↔ files (both ways, no duplicates), dead internal links, frontmatter
- assets `docs.json` points at exist and are valid — including that no XML comment
  contains `--`, which parses as nothing and silently keeps the previous asset

Each guard was verified by reintroducing the drift it exists for and watching it fail.

## Known gaps

- **`reference/mcp-tools.md`'s parameters are still hand-kept.** The drift test checks
  tool *names*, not their argument schemas — a renamed parameter would pass. Read the
  `TOOLS` array when editing.
- **No screenshots.** Every page is text. The tour pages would carry their weight better
  with images once there is a stable place to host them.

## Deliberately excluded

- **A public roadmap page.** The roadmap stays in the private documentation repo.
- **Anything strategic.** This repo is public; positioning, plans and internal notes do
  not belong here.
