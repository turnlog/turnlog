# turnlog.dev — landing page

Single static page, zero build step. Deploy the `site/` folder to any static host.
**Requirements + design tokens (colors, fonts, spacing): `docs/landing-prd.md`.**

**Cloudflare Pages** (the planned host — free tier, cookieless Web Analytics):
- Connect the repo, set the build output directory to `site/`, no build command.
- Or drag-drop the folder into a Pages project.

**Purpose right now:** a live product page for the Paddle seller application
(product description, pricing, privacy statement). The "Get Turnlog" button is a
placeholder until the Paddle checkout is wired in Phase 3 — replace the `href="#"`
with the Paddle overlay snippet once the seller account is approved.

Locked copy (from `docs/turnlog-deep-dive.md`): "for Claude Code" only in marketing,
never in the product name; lead with *search and replay*; price $19 (launch $15),
team pack 5 seats $79; 14-day refund; MoR is Paddle.

`/privacy` and `/terms` in the footer are placeholders — add those pages before
launch (Paddle wants a reachable privacy policy).
