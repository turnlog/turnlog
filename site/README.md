# turnlog.dev — landing page

Single static page, zero build step. Deploy the `site/` folder to any static host.
**Requirements + design tokens (colors, fonts, spacing)** live in the separate
documentation repo: `../documentation/turnlog/landing-prd.md`.

**Cloudflare Pages** (the planned host — free tier, cookieless Web Analytics):
- Connect the repo, set the build output directory to `site/`, no build command.
- Or drag-drop the folder into a Pages project.

**Purpose:** a live product page for a free, MIT-licensed, local tool. The primary
CTA is the `npx turnlog` install command (copy button); the secondary CTA is
GitHub. There is no checkout — Turnlog is free and open source.

Locked copy: "for Claude Code" only in marketing, never in the product name; lead
with *search and replay*, never "logs." No pricing, no Paddle, no "Buy" — the old
paid framing was dropped when Turnlog went free/MIT.

An optional `/privacy` page is nice-to-have (there is no data collection to
disclose); a `/terms` sale agreement is no longer needed — the repo's MIT `LICENSE`
is the only license text.
