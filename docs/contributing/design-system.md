---
title: "Design system"
description: "The visual language of the Turnlog viewer — the tokens, the ladders, and the rules behind them, so a change looks like it belongs."
---

# Design system

The visual language of the viewer UI (`web/`). Read this before writing UI: the system
is small and opinionated, and imitating whatever component happens to be nearby is the
reliable way to break it.

Every value lives as a CSS custom property in `web/src/theme.css` — this document
explains the *intent* behind them. Change tokens there; keep this file in sync when the
**rules** change.

**The live specimen sheet is `#/design-system`** in the running app (internal and
unlinked — type the URL). It renders the real primitives and reads token values off the
DOM at runtime, so it cannot drift. This document explains *why*; it can drift, and it
has. **If the two disagree, the page is right.**

---

## 1. Principles

1. **Full-bleed.** The background is the app surface, edge to edge. No floating
   app frame, no outer canvas. Whitespace lives *between* cards, never around
   the app.
2. **Separation by tone, not shadow.** Cards are flat white on light gray
   (`--card` on `--bg0`); insets are gray-on-white (`--bg1`/`--bg2` inside
   cards). `box-shadow` is reserved for true overlays — dropdown menus and the
   floating match bar. Nothing else casts a shadow.
3. **One hot accent.** Vermilion is the colour allowed to shout: primary CTAs
   and the live-indexing pulse. *(The user speaker rail is
   now the accent too, so a replay shows it once per user turn. The rule still
   holds for chrome and for every screen outside the replay — two vermilion
   **actions** on one surface is still a mistake.)*
4. **Color carries meaning or stays out.** Blue (search), the two category
   hues and the speaker rails are data accents in small doses. The state
   ramps — success, warning, danger — also draw every diff, and syntax
   highlighting is semantic; none of it is ever stripped. Everything else is
   ink and gray.
5. **Emphasis is black.** The near-black surface (`--contrast-solid`) marks
   "current/important": the stat card, active toggle segments, active turn
   numbers, command badges, the match pill. In dark mode it inverts to white —
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
| `--line` / `--line-soft` | `#e1e4ea` / `#eef0f4` | `#343a46` / `#262b34` | structural hairlines (panel/card heads), softer variant — **not** between list rows |
| `--tx0` / `--tx1` / `--tx2` | `#16181d` / `#5f6572` / `#9aa0ab` | `#eceef2` / `#9aa1ad` / `#626977` | ink / secondary / faint |
| `--accent` (+`-hi`, `-dim`, `-on`) | `#e8542f` | `#f0663f` | the hot accent: CTAs, errors |
| `--accent-on-dim` / `--accent-on-line` | white-75% / white-22% | *(same — the accent surface is theme-invariant)* | secondary ink and fills **on** the accent card, mirroring `--contrast-*` |
| `--blue` (+`-dim`) | `#3e6df5` | `#6b93f7` | search marks — a match is neither good nor bad, so it takes a hue no state owns |
| `--c-diff` / `--c-command` (+`-tx`) | `#12909e` / `#8a76e8` | `#4fd6d6` / `#b6a7f5` | activity categories. Diffs are teal because green now means success; prompts borrow `--c-user` and errors `--danger`, so only these two need a hue |
| `--c-on` | white | `#14161b` | the glyph on a **category fill**. Flips with the theme because the category hues do — light's are saturated, dark's are pastel |
| `--success` / `--warning` / `--danger` (+`-tx`, `-dim`, `-fill`) | see the page | see the page | the three state ramps: it worked, it worked with caveats, it failed. Success and danger also draw every diff — there is no separate `--diff-*` set |
| `--warning-on` | `#4a3d10` | *(same)* | ink on the warning fill — the one fill that inverts, and the pair always travels together |
| `--tile-on` | white | *(same)* | the glyph on any theme-invariant fill |
| `--contrast-solid` / `--contrast-on` / `--contrast-dim` | black / white / white-55% | white / black / black-55% | emphasis surfaces (inverts across themes) |
| `--mark` | blue @ 20% | blue @ 28% | FTS match highlight |
| `--key-bg` / `--key-edge` / `--key-tx` | | | keycaps. Their own tokens even though the values match `--bg2`/`--bg3`/`--tx1`: a key is a raised object, not a control surface, and nothing else has a pressed edge |
| `--scrim` | black @ 30% | *(same)* | backdrop behind centered overlays — a scrim darkens, it isn't a surface |
| `--c-user` / `--c-assistant` | `var(--accent)` / `#5b6cae` | `var(--accent)` / `#8091c4` | speaker rails. **The user speaks in the accent** — aliased, not copied, so the rail and the CTA cannot drift apart *(Decided )*. Two consequences: principle 3 ("one hot accent") no longer holds inside a replay, where every user turn carries it; and the prompts lens, which borrows this token, now sits beside the errors lens in `--danger` — two reds in one legend. The agent is a desaturated slate that clears the search blue by chroma rather than hue |

*(`--mint`, `--purple` and the `--badge-*` palette were retired.
Green now means success and nothing else; the two hues that were doing
category work became `--c-diff` and `--c-command`.)*

Nothing outside `theme.css` may name a color. The live token sheet — every
value, resolved, in whichever theme you're looking at — is `#/design-system`.

Role rails (replay): user and agent are peers and separate by hue
(`--c-user`, `--c-assistant`); tool is faint gray, meta is `--c-dim`, a
failed turn takes `--danger`. A subagent keeps `--c-assistant` and separates
by texture, not by hue.

## 3. Typography

- **UI:** Plus Jakarta Sans — variable, 200–800, latin woff2, bundled;
  nothing loads from the network, ever (brand promise; applies to all
  assets).
- **Content:** Space Mono — latin woff2, **static, 400 and 700 only**,
  bundled likewise.

> **The mono has no 500.** CSS weight matching looks *down* from a requested
> 500 before it looks up, so every mono element asking for the emphasis
> weight renders at 400: the identity pills, mono labels, the display
> figures. Sans emphasis is real; mono emphasis is not. Either live with it
> (mono carries emphasis by being mono, arguably enough), or pick a mono with
> a 500 — JetBrains Mono and Roboto Mono are variable, IBM Plex Mono ships a
> static 500.

### Which family — one question

> **Mono is for what a machine named or measured. Sans is for what a person
> named or wrote.**

*(The old wording — "anything the agent produced or that
identifies data" — left thirteen dates, costs, counts, and model names in
sans, including two cases where the same datum changed family depending on
which component it landed in: `.side-item-model` vs `.badge-model`, and
`.turn-n` vs `.outline-n`.)*

| | |
|---|---|
| **mono** | session ids, model names, adapter names, file paths, code, diffs, tool output, keycaps |
| **mono** | every figure: costs, counts, token totals, byte sizes, timestamps, date ranges, turn numbers — **including the display figures** at 32–40px, which are instrument readouts, not headlines |
| **sans** | project names, session names, tile initials, headings, labels, buttons, release notes, and all prose |

Two tiebreakers:

- **A sentence is sans, whatever digits are in it.** "across 3 files" and
  "3 unrecognized events — kept raw" are prose; `$0.41 · 38 turns · Jul 29`
  is a data strip.
- **A mixed metadata line goes fully mono, not token by token.** The word
  "turns" inside a figure strip rides along; wrapping each number in its own
  span would be precise and unreadable.

`--sans` is set once on `body`, so it is only ever *declared* to recover an
element that escaped it — form controls (a `<textarea>` falls back to the
browser's mono) and `pre.sans` (a `<pre>` rendering prose). Everything else
inherits. `code`, `pre`, and `kbd` are mono at the element level.

Mono is **wider** than sans at the same size — converting a line inside a
fixed-width container (the 356px sidebar) can start it ellipsizing. Check
before assuming.
### The type ladder

Every font-size in the app is a `--fs-*` token, there are **eight**, and every
one is in use. **No reserve steps** — an unused token is an invitation to reach
for it, and adding a size should be a deliberate act. If you need 20px, add
20px and say why.

The token set is also the whitelist: there is no `--fs-13`, so an off-scale
value can't resolve, where a bare `13px` used to work silently.

| Token | Role |
|---|---|
| `--fs-10` | micro — badges, axis ticks, keycaps, dense mono |
| `--fs-12` | metadata — timestamps, counts, ids, costs, code, badges, sub-lines, compact controls, section labels |
| `--fs-14` | body — message text, list-row titles, buttons, inputs, forms |
| `--fs-16` | prominent — session title, search group title, sheet titles |
| `--fs-18` | card titles, the wordmark, stat values, tile initials |
| `--fs-24` | screen titles — every `h1`, full-screen states included |
| `--fs-32` | display numbers — indexed history, spend total, disk total |
| `--fs-40` | the two headline figures — the home hero and the accent card |

*(Built from 17 ad-hoc sizes — nine of them between 10.5 and 15,
half-pixel values throughout. Trimmed the same day from fourteen steps to
eight: 8/20/22/28/48 were never used, and 36 held the hero alone one notch
under the accent figure it had no reason to differ from.)*

- Weights are **400 and 500**. Nothing else. *(Collapsed from 400/500/600
  with the font change — 600 went to 500 everywhere.)*
- **Uppercase text is one of exactly two tiers**, one ladder step apart,
  both tracked at 0.07em, both weight 500 — the ladder above allows no other:
  *section* (`--fs-12` — names a block: `.block-label`, `.pop-label`,
  `.stat-label`, `.outline-title`) and *badge* (`--fs-10` — the text inside a
  small filled pill: `.wn-current-badge`, `.update-banner-copy`). The identity pills are **not** in this
  system: an adapter is a proper noun and a model id is a literal, so both
  are written as they are. The type is set once in a shared block near the top of
  `app.css`; each site contributes only color and layout. *(Consolidated
  — this idiom had drifted to five tracking values across five
  sizes.)*
- Display figures carry **no negative tracking**: they're mono now, and
  tightening a fixed advance width works against the reason for choosing it.
- Inline `<code>` in chrome is one chip everywhere: `--bg2`, 6px radius,
  `1px 6px`, 12px — the same 6px it shares with `<kbd>`, both being
  glyph-scale marks set into a line of text. Fenced code is `.code-block`
  and is a different thing.
- Secondary lines under headings are `--tx2`, regular weight — the two-tone
  heading (ink line + gray line) is a recurring signature.

## 4. Shape & spacing

- **The radius ladder** — five steps, all tokens, plus 999 for pills and
  circles. Every rounded **control or surface** lands on one of them; nothing
  in between. `--radius-xs` 9 (tile-xs, inline code) · `--radius-sm` 12 (list
  rows, controls, inset fields, tile-sm) · `--radius` 14 (tiles, code blocks,
  diffs, sidechain runs) · `--radius-md` 16 (panels, popovers, menus, stat
  tiles) · `--radius-lg` 24 (cards). *(`--radius` had
  been defined but never used, and 12px — the commonest radius in the app —
  had no token at all.)*
- **Data marks are not controls**, and they have their own step:
  `--radius-mark` 4 — spend bars, calendar blocks, timeline columns. A chart
  bar rounded to 9px stops reading as a measurement. *(The
  spend bar capped at 4 and the timeline column at 6, so two marks of the
  same kind rounded differently, and the ladder claimed neither existed.)*
- Three glyph-scale artifacts sit outside **both** ladders and say so where
  they are declared: the keycap at 6 (a raised object with its own `--key-*`
  tokens), `<mark>` at 3 (it wraps running text), the note-dot fold at 2 (an
  11px paper square). Nothing else may.
- Circular buttons: 44 (`Primary`) · 34 (`IconButton`) · 26 (its ghost).
  Tiles: 44/36/28.
- Gutter **14px** (`--gutter`) — the screen's horizontal/bottom padding, the
  sidebar card's inset, and any full-width band under the header all read
  from it. Bento gap 20px; card padding 20–32px.
- List rows are rounded hover pills (r12–14): separation comes from spacing
  and the hover/active wash, never from hairline rules between rows.
  *(Revised — per-row hairlines read as a table grid on wide
  viewports and boxed the hover wash in; the sidebar, home lists, spend
  splits, search hits, files, disk, file-history rows, and the spine's
  turn rows all follow the pill pattern now.)* Hairlines remain for
  **structural dividers only**: card/panel headers (palette input row,
  file-history path bar). Never nested cards.
- Content goes **full width** — no centered max-width columns. The home
  bento, search screen, spine, log blocks, and file-history all fill the
  window; "full-bleed" applies to content, not just the background.
  *(Revised — the old 880–1220px centered measures are gone.)*
- The sessions sidebar is a **floating card**: `--card` on the `--bg0` canvas,
  rounded on all four sides (`--radius-lg`), inset `--gutter` from the edges,
  its width animating between the two states. The card *is* the rail — surface,
  radius and inset live there, and the list inside keeps its full width so
  nothing reflows mid-slide.
- **It never closes to nothing.** Collapsed it keeps a `--rail-w` (68px) rail
  holding the brand — which *is* the way back: the mark cross-fades to the
  panel glyph under the pointer, and the button is focusable at all times, so
  the affordance never depends on a hover that touch and keyboard cannot
  perform. Below it, the **same list** as the open state, one tile per
  session, in the same order, scrolling: a collapsed sidebar showing a
  different set would be a different list wearing the same column. Tiles carry
  the two row states that survive at 36px — **active** as a `--contrast-solid`
  bar on the card ground beside the tile (a ring *on* the tile is white on
  white, since tiles invert to a light block in the dark theme), and
  **pinned** as a `--c-note` dot at the corner.
  The open/close handoff is staged: the zone fades out over 160ms while the
  rail fades in after a 150ms delay, so the two are never both on screen.
  Both controls live in this column in both states — the toggle does not
  move to the header and back.
  *(Reverted to the original "zone, not a card" treatment, which
  the floating card had superseded. The card spent 28px of a 356px
  column on margins and rounded away four corners of a list that runs the full
  height of the screen; the tone contrast was doing the separating either way.
  This bullet has now been wrong in both directions — check the code.)*

## 5. Components

**The primitives are React components with co-located CSS**:
`web/src/components/<Name>.tsx` + `<Name>.css`, imported by the component.
`app.css` keeps screen layout and *contextual overrides only* (e.g.
`.calendar-head .view-toggle { background: var(--card) }`); base looks live
with their component. Components emit the long-standing class names, so
context rules keep targeting them. Never restyle a primitive in `app.css` —
change its own CSS file.

- **`IconButton`** (`IconButton.tsx/css`) — every round icon-only button.
  The `action` variant is a **badge**: a gradient fill lit from the top-left,
  set by two custom properties (`--badge-hue`, `--badge-glyph`) so a new
  colored action is one line at the call site. A button that stands for a
  colored dimension wears it — the four lenses. Everything else (find, reveal,
  share, stats, resume, the name/note editor) stays neutral, because color
  carries meaning or it stays out.
  **Note-yellow is a state, not a tool.** It marks a thing that HAS been
  marked — the note dot, the bookmark rail, the unseen-release ring — so the
  pin button wears `--c-note` only while the session is pinned, and is a plain
  neutral badge otherwise. It uses that instead of the generic pressed look
  for the same reason: "pinned" already has a color on the button itself.
  *(The pinned sidebar **row** dropped its yellow wash for a
  neutral `--bg1` ground. Yellow says "there is a note here", and a pinned
  session usually has no note; the filled pin in the row is what says it is
  pinned, and the row only needs a ground quiet enough to group the block.)* The
  name/note editor is just a panel toggle, like find and stats, and takes the
  contrast-pressed look. **Pressed is the
  contrast surface in every case, flat**: the hue says what the button *is*,
  black says which one is *on*, and one color can't say both — inverting to
  hue-on-contrast puts a light pastel on a near-white surface in the dark
  theme. **A lens wears its category as the fill**, with the glyph reversed
  out of it via `--c-on` — the hue is the button, not a tint on the icon.
  *(Badges added .)*
  **One size, 34px, and four fills** — `quiet` (`--bg2`, the default, on a
  card), `card` (`--card`, on the bare app background where `--bg2` all but
  disappears in the light theme), `inset` (`--bg1`, one surface down, for
  controls already standing on `--bg2`), and `ghost` — transparent until
  hover, and the single exception to the size at **26px**, because it rides
  inside list rows and floating nav pills where a 34 crowds the row. Row and
  floating-pill secondary controls are ghosts: pin, reveal, dismiss ✕,
  match/error rail chevrons.
  *(This was four variants at three sizes — 34, 34 and 32 —
  separated by nothing but their rest colour. The colour was the real
  difference, so it became the fill and the sizes collapsed. The 44px
  `header` variant left entirely; those are `Primary` now.)*
  `label` (aria) is required; `tooltip`/`shortcut` wire the standard hover
  pill; `active` is **the contrast fill** and the only way to say "pressed"
  *(It used to be `--bg3`, which is also the hover colour, so a toggle that
  was on looked like a toggle you happened to be pointing at)*. Two result
  states, not toggles: `ok` states itself as `--success-fill` with a white
  glyph, `disabled` drops to 35% so the shape stays readable as a control.
  Glyph size is **pinned in the CSS** (16px, 14 on a ghost) so no call site
  can drift.
  **Fills beat nothing; states beat fills.** A fill and a state are the same
  specificity, so the state rules are declared *after* the fills — a pressed
  button is pressed whatever it is sitting on.
  **Load-order rule:** component CSS bundles after `app.css`, so a context
  override must out-specify the base (add an ancestor class) — never rely on
  file order.
- **`Primary`** (`Primary.tsx/css`) — **the app frame's button**, and the one
  type behind every instance of it: the header's nav pills and round icon
  buttons, the sidebar toggle, the hero call to action, the stop button.
  One height (44), one padding (0 18), `--fs-14`, a 16px glyph pinned in the
  CSS, radius 999 — **a circle is this button with no visible label**, so the
  pill simply closes up to its own height and the name lives in `aria-label`.
  Only the fill varies, and each one means something: `card` (the rest fill,
  on the background) · `quiet` (`--bg2`, one surface up — the dismissive half
  of a pair, and any frame button standing on a card) · `contrast` ("you are
  here") · `accent` (the call to action, at most one per screen) · `danger`
  (the armed half of an arm-then-confirm). `active` sets the contrast fill
  **and** `aria-current` together — a route-active button that forgets one of
  the two is the bug the prop exists to prevent. Half the family are links,
  so `href` renders an `<a>`.
  *(Added, replacing six implementations across four files:
  `.circle`, `.circle.active`, `.header-pill`, `.btn-accent`,
  `.stop-btn.armed` and the status circle's hand-rolled anchor.)*
- **`Segmented`** (`Segmented.tsx/css`) — the `.view-toggle` pill track,
  radiogroup semantics, `''` value = nothing selected (lens took over). Takes
  the same `card`/`quiet` fill as every other type, picked by its ground. It
  is a **tab group, not a button** — the track, not the segment, owns the
  ground, which is why it has its own section on the design-system page.
- **`Badge`** (`Badge.tsx/css`) — every small rounded label. `kind`:
  default · cmd (**`--c-command`** — the same token the commands lens, the
  `cat-cmd` tool dot and the `m-cmds` spine count use; it was black, which is
  the emphasis fill and said nothing about what it is) · summary (blue) · failed
  (error fill) · model (mono) · tool (brand-filled agent badge —
  `AgentBadge` wraps it with the registry color and mark). Interactive badges
  (Stats' compaction jump) reuse the classes on a `<button>`. A `kind` must
  earn its keep: there was an `attach` variant that restated the base
  exactly, and attachment markers now use the default badge. An `open` kind
  went the same way — declared and styled for "this one is
  current", rendered nowhere.
  **There is one badge size.** A kind changes the wash, the family, and the
  casing — never the metrics. *(`app.css` had been overriding the
  sidebar model badge's size, color, background and padding plus two row-state
  rules, so the same component rendered four ways and no longer matched the
  agent badge beside it. A brief `sm` prop replaced those overrides and was
  then dropped too — one size is the rule.)* The only thing a screen may say
  about a badge is its **ground**: `.side-item.active .badge` steps to the card
  tone because a `--bg2` badge would vanish into the active row's wash. The
  agent badge deliberately does not carry the `.badge` base class — it replaces
  the fill outright, and standing apart keeps ground rules from overwriting a
  brand color.
  **An icon inside a badge is `1em`**, never a `size` prop: it derives from
  `--fs-*` and cannot drift out of step.
- **`SearchField`** (`SearchField.tsx/css`) — every search/filter input;
  wrapper carries surface + focus ring. `sm` = inset bg1 row (sidebar
  filter, in-session find bar, spend filter — the last takes the card tone
  by context on the bare header), `lg` = card-surface query box (search
  screen, home hero via context height override). Optional magnifier `icon`
  and `clearable` ×. Form fields (annotate panel) and the palette input are
  NOT SearchFields.
- **`Button`** (`Button.tsx/css`) — **one shape**: the gray inset `.pill`,
  the quiet screen-level action (CSV/JSON exports, "This week",
  maintenance). Takes the same `card`/`quiet` fill as the rest.
  *(The compact pair that lived here — `.btn` and
  `.btn.primary` for popover actions — turned out to be `Primary` wearing
  smaller metrics, so the share panel's copy/download became Primary fills
  and both variants were deleted.)*
- **`TextArea`** (`TextArea.tsx/css`) — the multi-line field, and the inset
  sibling of the `sm` search field: same ground, radius and focus ring, so a
  form mixing the two reads as one set. Vertical resize only — a text field
  is not a layout control. *(Added ; the session-note field was a
  bare `<textarea>` styled from `app.css`.)*
- **`Facts`** (`Facts.tsx/css`) — label/value pairs, stacked: the one way a
  set of measurements is presented, in tooltips (calendar blocks, spend bars,
  the sidebar info button) and on cards alike. Ink comes from `currentColor`,
  so the same component reads on a contrast pill and on a card. Run-together
  fact lines (`10:37–16:02 · 2,355 turns · 504k tok`) are the thing it
  replaced — added when the sidebar's stacked layout won.
- **`TagEditor`** (`TagEditor.tsx/css`) — badges + the field that adds them.
  Every control is a system primitive: the badge is a `Badge` at its one size,
  the × and + are ghost `IconButton`s shrunk by ancestor-scoped overrides,
  the input is a real `sm` `SearchField`. *(Its first version hand-rolled all
  three and was rebuilt the same day — the cautionary tale for "closest
  markup at hand" over checking `#/design-system` first.)*
- **`NowCard`** (`NowCard.tsx/css`) — the home "what is running now" card;
  renders only while something is, labelled mono figures on the right.
- **`Tooltip`/`Dropdown`/`Overlay`/`NoteDot`** own their CSS files too
  (`NoteDot.css` includes the `.tooltip.note-tip` sticky variant it requests).
  `Overlay` is the shared scrim behind the command palette and the shortcuts
  sheet, and it owns backdrop-click and Escape dismissal for both.

Screen-level pieces still in `app.css`:

- **`.card`** — white, r24, flat. Variants: `.dark-card` (contrast surface,
  colored data dots), `.accent-card` (vermilion, `--accent-on*` ink, one big
  number, an `.icon-btn.onaccent` link circle), `.list-card` (title + rows).
- *(`.btn-accent` was the vermilion CTA pill; it is `Primary fill="accent"`
 .)*
- **`.tile`** — rounded-square project mark with initial; a white glyph on one
  of **8 categorical hues** (`--tile-0…7`) chosen by project-key hash
  (`tileClass` in `format.ts`), so a project keeps its color everywhere. The
  eight are validated as a categorical set (all-pairs CVD ΔE 11.8, white-text
  ≥ 3.49:1) and theme-invariant; the hash follows the key, never list position,
  and the initial + name are the secondary encoding past 8 projects.
- **`.dot`** — 8px data dots labeling numbers and legend entries.
- **Lens legend** — the four session dimensions own fixed colors everywhere
  they appear (pills, spine summary counts, tool dots): **diffs = `--c-diff`
  teal**, **commands = `--c-command`**, **errors = `--danger`**, **prompts =
  `--c-user`**. Only two need a hue of their own: a prompt *is* the user and
  an error *is* a failure, so those borrow. Text-safe variants
  (`--c-diff-tx`, `--c-command-tx`) exist for small type on light grounds.
- **`Skeleton.tsx`** (`.skel`, `SkeletonLines`, `SkeletonRows`) — shimmer
  placeholders replace all "loading…" text: spine turn bodies, log initial
  load, sidebar list, home numbers (`.skel-onaccent` / dark-card variants),
  search results. Honors `prefers-reduced-motion`.
- **`.match-bar`** — floating contrast pill (popovers/menus and it share the
  allowed overlay shadow).
- **`.find-bar`** — in-session find (Cmd/Ctrl-F), inset pill input in the
  replay header; drives the shared `?q=` state.
- **`.error-nav`** — floating bottom-right pill (white, error-tinted border,
  vermilion count) cycling failing results; `.you-are-here` — floating
  current-turn breadcrumb pill atop the log view.
- **`.turn-n`** — spine turn number in a 30px circle: gray idle → contrast
  when the turn is open. Errors mark the outline number vermilion.
- **`.status-dot`** — `--success` idle, vermilion pulsing while indexing,
  inside a Primary circle. Unseen release notes ring that circle in the note
  yellow — a state of the status button alone, which is why it lives in
  `app.css` and not in the component.

## 6. Screen anatomy

- **Header** (on the bg, not a bar): sidebar-toggle circle · black brand
  circle + two-tone wordmark · right: **Files** and **Spend** route pills,
  then the search, theme, status, and stop circles. With the sidebar open,
  toggle + brand live inside the sidebar card instead.
  Directional marks are Solar alt-arrow chevrons (vendored like the rest of
  the icon set) — never text arrows.
- **Micro-motion voice — five durations, each with a job, nothing between
  them:** 70ms press-down scale · 140ms soft overlay entrances (tooltip and
  the lifted note, fade-slide 4px from the anchor side) · **150ms ease, the
  default** for every hover (color, background, opacity, filter) · 200ms
  soft for a control's own transform (the sort-direction flip) and the
  sidebar's opacity · 260ms soft for the sidebar slide. "Soft" is
  `cubic-bezier(0.25, 0.8, 0.3, 1)`. *(Consolidated from eleven
  values.)*
- **Home**: hero (two-tone headline + search input + the accent Primary) → bento
  grid: black "Indexed history" card (three dotted numbers) · vermilion
  "Est. spend" card · "Recent sessions" list card (tiles, badges, ↗ circles) ·
  "Projects" list card · the full-width index-health band.
- **Sidebar**: one controls row — quick-filter `SearchField` + a tuning
  `IconButton` + count. Project/sort/direction/empty live in a filter popover
  under that button (full sidebar width, `pop-row`/`pop-label` chrome — the
  same vocabulary the share panel uses; it had a duplicate `share-row`/
  `share-label` spelling); an accent dot on the button + a
  reset link flag active hidden filters. Below: the session list (tile, name,
  cost, sub-line, agent + model badges).
- **Replay**: white header card (back circle, title, badges, `spine|log|files`
  toggle, lens pills with legend dots, stats pill) → spine (outline card +
  turn list card), log (single virtualized card), or files (touched-file
  list card + cumulative per-file diffs card). Match bar floats
  bottom-center; error-nav pill bottom-right.
- **Search**: pill input (vermilion focus ring), meta line with the cost-of-
  this-work aggregate, white group cards with rounded hit rows, blue `--mark`
  highlights.
- **Spend** (`#/spend`): headline total, single-series ink bar chart (hover in
  accent, contrast tooltip, daily|weekly granularity toggle in the card head),
  split list cards, prompt-caching dark card.
- **Calendar** (Spend view): week timeline of `--bg1` day **rows** (time runs
  across; sessions are horizontal project-tile-colored blocks at real times,
  stacking into lanes when they overlap), and a month grid with per-day
  cost-heat cells + project dots; black today-circle; `Tooltip` on both.
- **`Tooltip`** (`components/Tooltip.tsx`) — portal contrast pill, clones its
  single child to attach hover/focus; replaces native `title`. Used for rich
  content (calendar blocks/cells, spend bars) and for labelling **icon-only
  buttons** (header sidebar/theme/status circles, replay back/download, error
  & match nav arrows, calendar prev/next, sidebar sort direction). Text
  buttons carry their own label — no tooltip.

## 7. Rules of thumb

- Never introduce a new color for a new feature; find the meaning it carries
  and reuse the token that owns that meaning. Two sanctioned identity
  palettes exist beside the semantic tokens: the 8 project tile hues, and the
  **agent palette** (`--agent-*`, one per adapter — Anthropic clay `#de7356`,
  OpenAI green `#10a37f`, registry in `web/src/agents.ts`). These are each
  adapter's **true brand hue, not a darkened derivative** — a colour that
  identifies something stops identifying it once you adjust it. Both sit
  under the 3.5:1 white-text bar as a result, so the badge label carries the
  load, the way a project tile's letter does. Each adapter also carries its
  **brand mark**,
  vendored as path data in `icons.tsx` and drawn in `currentColor` — so an
  agent badge always shows two encodings, the mark for recognition and the
  word for certainty. A new adapter is one `--agent-*` token, one mark, and
  one registry entry. (The marks are third-party trademarks used
  nominatively — credited in `web/public/CREDITS.txt`, not MIT, not
  endorsements.) They fill the uppercase agent badges, and in the
  calendar the color-by toggle decides: the chosen dimension (project or
  agent) fills each block and the other becomes its 3px edge stripe — both
  encodings always present.
- Dark mode is a token swap, not a redesign — if a component needs
  theme-specific CSS beyond tokens, the tokens are wrong.
- Focus rings: accent-tinted outline (`:focus-visible`), never removed without
  a visible replacement (`.hero-search` uses `:focus-within` on the wrapper).
- **Before adding a value, look for the one that already exists.** Every
  drift this document has had to correct started as one reasonable local
  choice: a 0.04em label, an 11px `<code>`, a 130ms hover. The specimen page
  (`#/design-system`) exists so the existing answer is one keystroke away.
- Screenshots for review: `?theme=light|dark` forces a theme (used by
  headless Chrome verification).

## 8. Where the system lives

| | |
|---|---|
| Tokens | `web/src/theme.css` — the only file allowed to name a color |
| Primitives | `web/src/components/<Name>.tsx` + `<Name>.css` |
| Screen layout & context overrides | `web/src/app.css` |
| The live specimen sheet | `#/design-system` (internal, unlinked) |
| Every type's fill vocabulary | chosen by the **ground**, not by importance |
| The intent behind it all | this file |

The specimen page renders the real primitives and reads token values off the
DOM at runtime — the overlays even open for real, since an overlay is fixed
to the viewport and cannot be shown in place — so it cannot drift. This
document explains *why*; it can drift, and it has: if the two disagree, the
page is right.

**One rule runs through every type.** `Primary`, `IconButton`, `Button` and
`Segmented` all pick their rest fill from the **ground they stand on** rather
than from how important they are: `card` on the bare app background, `quiet`
(`--bg2`) on a card, `inset` (`--bg1`) one surface further down. That is why
`app.css` no longer carries `.spend-head .view-toggle`, `.calendar-head
.pill`, `.search-view`, `.sidebar-brand .circle` or `.annotate-save` — a
control now says where it stands where it is written.
