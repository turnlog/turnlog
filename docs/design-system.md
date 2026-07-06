# Turnlog — Design System

*The visual language of the viewer UI (`web/`). Settled 2026-07-05 after three
iterations; references: bento fintech dashboards (full-bleed light-gray canvas,
flat white cards, one black stat card, one saturated accent). All values live as
CSS custom properties in `web/src/theme.css` — this document explains the intent
behind them. Change tokens there; keep this file in sync when the *rules* change.*

---

## 1. Principles

1. **Full-bleed.** The background is the app surface, edge to edge. No floating
   app frame, no outer canvas. Whitespace lives *between* cards, never around
   the app.
2. **Separation by tone, not shadow.** Cards are flat white on light gray
   (`--card` on `--bg0`); insets are gray-on-white (`--bg1`/`--bg2` inside
   cards). `box-shadow` is reserved for true overlays — dropdown menus and the
   floating match bar. Nothing else casts a shadow.
3. **One hot accent.** Vermilion is the only color allowed to shout: primary
   CTAs, errors, the trial state, live-indexing pulse. If two vermilion things
   are visible at once, one of them is probably wrong.
4. **Color carries meaning or stays out.** Blue/mint/purple are data accents
   (dots, marks, rails) in small doses. Diff green/red and syntax highlighting
   are semantic and never stripped. Everything else is ink and gray.
5. **Emphasis is black.** The near-black surface (`--contrast-solid`) marks
   "current/important": the stat card, active toggle segments, active turn
   numbers, command chips, the match pill. In dark mode it inverts to white —
   same trick, mirrored.
6. **Round is the default.** Pills and circles for interactive elements,
   radius-24 for cards, radius 12–16 for insets. Sharp corners don't exist.

## 2. Color tokens

Both themes define the same token names; components never hardcode colors.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg0` | `#edeff3` | `#0f1115` | app background (full-bleed) |
| `--card` | `#ffffff` | `#181b21` | cards, sidebar zone, inputs |
| `--bg1` / `--bg2` / `--bg3` | `#f4f5f8` / `#e9ebf0` / `#dee1e8` | `#1e222a` / `#262b34` / `#313743` | inset surfaces, hover, pressed |
| `--line` / `--line-soft` | `#e1e4ea` / `#eef0f4` | `#343a46` / `#262b34` | hairlines (lists), softer hairlines |
| `--tx0` / `--tx1` / `--tx2` | `#16181d` / `#5f6572` / `#9aa0ab` | `#eceef2` / `#9aa1ad` / `#626977` | ink / secondary / faint |
| `--accent` (+`-hi`, `-dim`, `-on`) | `#e8542f` | `#f0663f` | the hot accent: CTAs, errors, trial |
| `--blue` (+`-dim`) | `#3e6df5` | `#6b93f7` | search marks, assistant/sidechain rails |
| `--mint` / `--purple` | `#4cba74` / `#8a76e8` | `#8fe0a8` / `#b6a7f5` | data dots, ok-status |
| `--contrast-solid` / `--contrast-on` / `--contrast-dim` | black / white / white-55% | white / black / black-55% | emphasis surfaces (inverts across themes) |
| `--mark` | blue @ 20% | blue @ 28% | FTS match highlight |
| `--diff-add-*` / `--diff-del-*` | green / red families | toned lighter | diffs only (semantic) |

Role rails (replay): user = ink, assistant = blue, tool = faint gray,
sidechain = deep blue, error = vermilion, meta = `--c-dim`. Hierarchy by
weight, blue only where the agent speaks.

## 3. Typography

- **UI:** Instrument Sans (400/500/600/700), bundled woff2 latin subsets —
  nothing loads from the network, ever (brand promise; applies to all assets).
- **Content:** Fira Code (400/500) for anything the agent produced or that
  identifies data: message text, code, timestamps, costs, counts, ids.
  Ligatures stay on (it's the point of Fira Code).
- Scale: hero 38/600/-0.02em; card titles 17–19/600/-0.01em; big numbers
  34–40/600/-0.02em; body 13.5–15; list titles 13.5–15/600; metadata (mono)
  10–12; labels 11/uppercase only inside replay blocks.
- Secondary lines under headings are `--tx2`, regular weight — the two-tone
  heading (ink line + gray line) is a recurring signature.

## 4. Shape & spacing

- Radius scale: cards **24** (`--radius-lg`) · insets/code/diff **12–16** ·
  tiles **14** (sm 12, xs 9) · pills/circles **999**.
- Circular icon buttons: 44px (header), 34–38px (inline). Tiles: 44/36/28.
- Page padding 28px; bento gap 20px; card padding 20–32px.
- Lists inside cards separate with `--line-soft` hairlines, never nested cards.
- The sessions sidebar is a **zone**, not a card: white, square edges (one
  rounded corner where it meets content), hairline-free against the gray bg.

## 5. Components (`web/src/app.css`)

- **`.card`** — white, r24, flat. Variants: `.dark-card` (contrast surface,
  colored data dots), `.accent-card` (vermilion, white text, big number,
  `.btn-onaccent` white pill), `.list-card` (title + hairline rows).
- **`.btn-accent`** — vermilion pill, the primary CTA. One per screen, max.
- **`.pill`** — gray inset pill (filters, quiet actions). `.chip` — small pill
  for metadata (model names, kinds); `.chip-cmd`/`.chip-open` are contrast
  (black) chips; `.chip-summary` blue-tinted.
- **`.circle`** — white circular icon button; `.circle-sm` gray inset;
  `.circle-active` pressed state (`--bg3`); `.circle-onaccent` translucent
  white on vermilion.
- **`.tile`** — rounded-square project mark with initial; color rotates
  vermilion/black/blue by project-key hash (`tileClass` in `format.ts`).
- **`.dot`** — 8px data dots labeling numbers and legend entries.
- **Lens legend** — the four session dimensions own fixed colors everywhere
  they appear (pills, spine summary counts, tool dots): **diffs = mint**,
  **commands = purple**, **errors = vermilion**, **prompts = ink**.
  Text-safe variants (`--mint-tx`, `--purple-tx`) exist for small type on
  light backgrounds.
- **`Skeleton.tsx`** (`.skel`, `SkeletonLines`, `SkeletonRows`) — shimmer
  placeholders replace all "loading…" text: spine turn bodies, log initial
  load, sidebar list, home numbers (`.skel-onaccent` / dark-card variants),
  search results. Honors `prefers-reduced-motion`.
- **`.dd-*`** — custom listbox dropdown: gray pill trigger, white r16 menu
  (one of the two allowed shadows).
- **`.view-toggle`** — segmented pill, active segment contrast-black.
- **`.match-bar`** — floating contrast pill (the other allowed shadow).
- **`.find-bar`** — in-session find (Cmd/Ctrl-F), inset pill input in the
  replay header; drives the shared `?q=` state.
- **`.error-nav`** — floating bottom-right pill (white, error-tinted border,
  vermilion count) cycling failing results; `.you-are-here` — floating
  current-turn breadcrumb pill atop the log view.
- **`.turn-n`** — spine turn number in a 30px circle: gray idle → contrast
  when the turn is open. Errors mark the outline number vermilion.
- **`.status-dot`** — mint idle, vermilion pulsing while indexing, inside a
  header circle.

## 6. Screen anatomy

- **Header** (on the bg, not a bar): sidebar-toggle circle · black brand
  circle + two-tone wordmark · right: search pill, theme circle, status circle.
- **Home**: hero (two-tone headline + search input + `.btn-accent`) → bento
  grid: black "Indexed history" card (three dotted numbers) · vermilion
  "Est. spend" card (becomes "Unlock full history" in trial) · "Recent
  sessions" list card (tiles, chips, ↗ circles) · "Projects" list card.
- **Sidebar**: controls (project + sort dropdowns, direction circle, trial
  pill) over a hairline session list (tile, name, cost, sub-line, model chip).
- **Replay**: white header card (back circle, title, chips, `spine|log|files`
  toggle, lens pills with legend dots, stats pill) → spine (outline card +
  turn list card), log (single virtualized card), or files (touched-file
  list card + cumulative per-file diffs card). Match bar floats
  bottom-center; error-nav pill bottom-right.
- **Search**: pill input (vermilion focus ring), meta line with the cost-of-
  this-work aggregate, white group cards with hairline hits, blue `--mark`
  highlights.
- **Spend** (`#/spend`): headline total, single-series ink bar chart (hover in
  accent, contrast tooltip), split list cards, prompt-caching dark card.
- **Calendar** (`#/calendar`): week grid of `--bg1` day columns, sessions as
  project-tile-colored blocks at real times, black today-circle.

## 7. Rules of thumb

- Trial/locked UI uses the accent (it's a call to action by definition), but
  locked rows themselves just dim — the lock glyph carries the message.
- Never introduce a new color for a new feature; find the meaning it carries
  and reuse the token that owns that meaning.
- Dark mode is a token swap, not a redesign — if a component needs
  theme-specific CSS beyond tokens, the tokens are wrong.
- Focus rings: accent-tinted outline (`:focus-visible`), never removed without
  a visible replacement (`.hero-search` uses `:focus-within` on the wrapper).
- Screenshots for review: `TURNLOG_UNLICENSED=1` previews trial surfaces,
  `?theme=light|dark` forces a theme (used by headless Chrome verification).
