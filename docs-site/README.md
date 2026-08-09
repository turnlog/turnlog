# Turnlog Documentation Site — Content Source

This folder holds the **content** for Turnlog's public documentation site, set up for
[Mintlify](https://mintlify.com)'s GitHub sync — the same arrangement as Reikon's
`docs-site/`. Connect a Mintlify project to this repo, point it at this directory, and it
renders. What is left is account-side (see Status).

## Status

- **Platform:** Mintlify — `docs.json` is written and all 21 pages carry frontmatter. Not
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
- **Logo/favicon:** not set in `docs.json`. The mark now exists as
  `web/public/favicon.svg` (accent tile) and as `Brandmark` in `web/src/icons.tsx`; add
  `docs-site/logo/{light,dark}.svg` and wire up `logo`/`favicon` before going live.
- **Links** are written without `.md` extensions and rooted at `/docs/…`, matching the
  served path. If you add a page, add it to `docs.json`'s `navigation` too — pages are
  not auto-discovered.

## Structure

Four sections, matching distinct reader intent (loosely the
[Diátaxis](https://diataxis.fr/) split):

```
docs-site/
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

- **`reference/search-operators.md`** — the query grammar. Verified against
  `FILTER_OPS` in `src/server/api.ts` when written; all 13 operators are documented.
- **`reference/settings.md`** — the `settings.json` shape.
- **`reference/cli.md`** — commands and flags.

## Known gaps

- **`reference/mcp-tools.md` is a hand-kept snapshot** of `src/mcp/mcp.ts`'s `TOOLS`
  array, not generated. Parameters were read off the source when written; if a tool's
  schema changes, edit this page in the same commit. Reikon guards the equivalent with a
  drift test — worth copying.
- **No screenshots.** Every page is text. The tour pages would carry their weight better
  with images once there is a stable place to host them.
- **No drift test.** Nothing fails if the CLI grows a flag this folder does not mention.

## Deliberately excluded

- **A public roadmap page.** The roadmap stays in the private documentation repo.
- **Anything strategic.** This repo is public; positioning, plans and internal notes do
  not belong here.
