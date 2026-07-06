# Turnlog — Landing Page PRD (`turnlog.dev`)

*Requirements + design tokens for the marketing site. Companion to
`docs/design-system.md` (the app's system) and `docs/turnlog-deep-dive.md`
(strategy, §7 sales, §0.2 name rules). The reference implementation is
`site/index.html`. This doc is the source of truth for the site's tokens and
structure — change tokens here and in the site's `<style>` together.*

---

## 1. Purpose & goals

The landing page has three jobs, in priority order:

1. **Drive `npx turnlog` trials.** The install command *is* the funnel — one line,
   no download, running in fifteen seconds. Everything above the fold serves this.
2. **Be the Paddle-approvable product page** (product description, pricing, reachable
   privacy + terms). Gates the whole business.
3. **Rank and convert on SEO intent** — "where does Claude Code store history,"
   "search Claude Code sessions," "Claude Code cost per session" (deep-dive §7.3).

**Success is edge-measured — never in-app telemetry:** npm download counts,
landing→checkout rate (Cloudflare Web Analytics, cookieless), Paddle conversion.
Kill criterion math (<2% trial→paid) is computable from these.

## 2. Audience & voice

- Heavy Claude Code users; ICs and eng leads who've lost a session or been asked
  "what is this costing us." They have Node by definition.
- **Lead every surface with *search and replay*, never "logs"** (the `-log` suffix
  reads as a logging library — correct it instantly).
- **"for Claude Code" appears in copy only; "Claude" never in the product or package
  name.** (Anthropic constraint, §0.2.)
- HN values are the positioning, stated plainly not smugly: local-first, no
  telemetry, one-time price, `npx` try-it-now. Honest, including the free/manual way.

---

## 3. Design tokens

**The site commits to one look: dark.** A landing page is bolder committing to a
single treatment than theming; dark suits the archival-instrument brand and makes the
vermilion accent and mint/blue data hues pop. (The *app* is dual-theme; the *site* is
not.) Tokens below mirror the app's dark theme (`web/src/theme.css`) so the two never
drift — use these exact values.

### 3.1 Color

| Token | Hex / value | Use |
|---|---|---|
| `--bg0` | `#0f1115` | page background (full-bleed) |
| `--card` | `#181b21` | cards, nav pills, install pill, preview frame |
| `--bg1` | `#1e222a` | deeper inset (code wells, mock body) |
| `--bg2` | `#262b34` | chips, icon tiles, hover fills |
| `--bg3` | `#313743` | pressed / strongest inset |
| `--line` | `#343a46` | hairlines, card borders |
| `--line-soft` | `#262b34` | softer separators |
| `--tx0` | `#eceef2` | primary ink (headings, key copy) |
| `--tx1` | `#9aa1ad` | secondary (body, subheads) |
| `--tx2` | `#626977` | muted (captions, footnotes, `$` prompt) |
| `--accent` | `#f0663f` | **the hot accent** — CTAs, links on hover, eyebrow, price |
| `--accent-hi` | `#ff7d55` | accent hover |
| `--accent-dim` | `rgba(240,102,63,0.14)` | eyebrow pill bg, tinted fills |
| `--accent-on` | `#ffffff` | text/icon on an accent surface |
| `--blue` | `#6b93f7` | data accent (search-mark, mock highlight) |
| `--mint` | `#8fe0a8` | success/ok (`✓ passing`, `lsof` proof, checkmarks) |
| `--purple` | `#b6a7f5` | third data accent (charts, dots) if needed |
| `--mark` | `rgba(107,147,247,0.28)` | `<mark>` search-hit highlight |
| `--contrast-solid` | `#eceef2` | near-white emphasis surface (use sparingly) |
| `--contrast-on` | `#14161b` | text on the near-white surface |

**Rules (inherited from the app system):** one hot accent — vermilion is the only
color allowed to shout (CTAs, price, links). Blue/mint/purple carry meaning in small
doses only. Mint is reserved for "safe/verified/success" (it's what sells the privacy
proof). Never introduce a new hue for a new section — reuse the token that owns the
meaning.

### 3.2 Typography

Self-host, don't CDN. **A privacy-first product must not pull Google Fonts on its own
marketing site** — ship the same bundled woff2 latin subsets the app uses
(`web/public/fonts/`, SIL OFL), `font-display: swap`. (The reference `site/index.html`
currently falls back to `system-ui` — closing that with self-hosted `@font-face` is a
launch requirement, not optional.)

| Token | Family | Weights | Use |
|---|---|---|---|
| `--sans` | **Instrument Sans**, `system-ui`, sans-serif | 400 / 500 / 600 / 700 | all UI text |
| `--mono` | **Fira Code**, `ui-monospace`, `'SF Mono'`, Menlo | 400 / 500 | install command, code, chips, data |

Scale (fluid where marked):

| Role | Size | Weight | Tracking |
|---|---|---|---|
| Hero `h1` | `clamp(34px, 6vw, 58px)` | 600 | `-0.025em` |
| Section `h2` | `clamp(26px, 4vw, 34px)` | 600 | `-0.02em` |
| Card `h3` | 18px | 600 | — |
| Body | 16px / 1.55 | 400 | — |
| Sub / lede | `clamp(16px, 2.4vw, 20px)` (`--tx1`) | 400 | — |
| Install command (mono) | 16px | 400 | — |
| Eyebrow / labels / chips (mono) | 13px (`--accent` or `--tx2`) | 400 | — |
| Code wells / snippets (mono) | 13–14px | 400 | — |

Mono carries anything that *is* data or a command (install line, code, chips, the
`lsof` line, prices in-context). Sans carries prose. The two-tone headline (ink line +
`--tx2` continuation) is the recurring signature — reuse it.

### 3.3 Shape, spacing, motion

- Radii: cards `--radius-lg` **24px** · smaller `--radius` **14px** · pills/buttons
  **999px**. Sharp corners don't exist.
- Container: `max-width: 1080px`, side padding **24px**.
- Section rhythm: **72px** vertical padding; bento gap **16px**, tracks
  `repeat(auto-fit, minmax(260px, 1fr))`.
- Motion: `scroll-behavior: smooth`; hover transitions on color/background only; at
  most one staggered hero reveal on load. Honor `prefers-reduced-motion`.

---

## 4. Page structure (in order)

1. **Nav** — brand mark (vermilion square + "TURNLOG") · Features / Pricing / FAQ ·
   GitHub pill. Sticky is optional.
2. **Hero** — eyebrow "for Claude Code"; two-tone `h1`; one-sentence lede; the
   **`npx turnlog` install pill with a copy button as the primary CTA** (ahead of any
   "buy"); a one-line reassurance ("no download, no unzip… fifteen seconds").
3. **Product preview** — a styled browser-frame mock of a search result (no real user
   data). Real annotated screenshots/GIF replace this before launch (§7.2 demo GIF).
4. **Features bento** — 6 cards: Search everything · Turn spine · Lenses & files ·
   Spend tracker · Calendar · 100% local. Icon tile + `h3` + one sentence each.
5. **Privacy band** — the differentiator, full-width card: "verify it yourself" +
   the `lsof -iTCP -sTCP:LISTEN | grep node` line in mint. This is load-bearing copy.
6. **Pricing** — single card: `$19` struck → **`$15`** launch, "one-time," feature
   checklist, **Get Turnlog** (accent, full-width), foot: "Paddle · Team pack $79 ·
   try free with `npx turnlog`."
7. **FAQ** — `<details>` accordion: is it free / does data leave / vs ccusage / which
   CC versions / requirements.
8. **Footer** — contact (`hello@turnlog.dev`), **Privacy**, **Terms**, GitHub.

**Required sub-pages (Paddle gate):** `/privacy` and `/terms` must be reachable and
real. Privacy is easy and on-message (there is no data collection to disclose); terms
is a standard one-time-license agreement. Same tokens, minimal single-column layout.

---

## 5. Content & pricing (locked)

- Price **$19** one-time; **launch week $15**, time-boxed and public. Team pack 5
  seats **$79**. PPP discounts later, not launch. (deep-dive §4.3.)
- One-time license, "personal, up to 2 machines" (honor-system term). 14-day
  no-questions refund (a conversion asset, cheaper than chargebacks).
- The last v1 release stays installable forever (`npm i turnlog@1`) — say so.
- Merchant of record: **Paddle** (overlay checkout embedded on the page — Phase 3;
  the current "Get Turnlog" button is a placeholder no-op).

---

## 6. Technical requirements

- **Static, zero build.** Single self-contained `index.html` (inline CSS/JS) + the
  self-hosted font files. Deploy `site/` to **Cloudflare Pages** (no build command).
- **No third-party requests, ever** — no CDN scripts, no Google Fonts, no trackers.
  It's the privacy brand's own front door; a network tab full of third parties
  contradicts the pitch. (Cloudflare Web Analytics is the one allowed exception —
  it's cookieless and first-party-ish; add its single beacon only.)
- **Responsive** down to ~360px; bento and hero reflow; no horizontal scroll.
- **Performance:** ideally one HTML request + a handful of font files; inline the
  critical CSS (already inline). Target sub-1s first paint.
- **SEO/OG:** descriptive `<title>`/`<meta description>`, Open Graph tags, semantic
  headings, an OG image before launch.
- **A11y:** semantic landmarks, focus-visible states, `alt`/`aria-hidden` on the
  decorative mock, AA contrast (the dark tokens pass), keyboard-operable FAQ.
- **Favicon:** the vermilion brand mark (inline SVG data-URI, already set).

## 7. Out of scope (later)

Blog / "State of Claude Code spend" content; the SEO long-tail pages (§7.3) as
separate routes; PPP; i18n; a pricing table with multiple tiers (one product, one
price at launch). Team/multi-seat *dashboard* is a different product entirely, never
part of this site.
