# web/ — the Turnlog viewer

An npm workspace: Vite + React, shipped prebuilt inside the npm package.

**Visual language: a full-bleed bento system.** The background is the app
surface, and structure comes from rounded card surfaces and spacing — never
borders or shadows. Tokens live in `src/theme.css`; dark and light are driven
by `data-theme`. `#/design-system` is the specimen sheet — internal, unlinked,
and every specimen on it is the real component, so it cannot go stale.

**Buttons are four types, and a fill picks the ground.** `Primary` is the app
frame's button (44px, five fills, a circle is one with no visible label);
`IconButton` is every round icon-only button inside the app (34px, plus a
26px ghost); `Button` is the quiet screen-level pill; `Segmented` is a tab
group, not a button. All of them choose their rest fill from the surface they
stand on — `card` on the bare background, `quiet` on a card, `inset` one
further down — so a control says where it stands where it is written, rather
than through a context override in `app.css`.

**Screens:** home (hero + bento), the session sidebar zone, replay, search.
Replay defaults to the turn spine (the alternative is the log view); lenses are
selected via `?l=` — the diffs lens renders as the per-file pivot in
`src/replay/Files.tsx` — views via `?v=`, and in-session find via `?q=`.

**Threading.** `src/replay/thread.ts` builds display blocks: it folds
`tool_use`/`tool_result` pairs, nests sidechain runs under their Task calls, and
folds abandoned branches away. The abandoned-branch rule is implemented twice —
`findAbandoned` here and `findAbandonedIdxs` in `src/server/api.ts` — and the
two must stay in step.

**Tolerant re-parsing.** `src/replay/raw.ts` re-parses `raw` JSONL leniently.
This is the UI half of the parser cardinal rule: degrade, never throw.

**Highlighting.** Shiki runs in a web worker, behind a language whitelist and a
size cap.

**Nothing loads from the network, ever.** Fonts are bundled woff2 in
`public/fonts/`; Solar outline icons are vendored as path data in
`src/icons.tsx` (CC BY 4.0 — credits in `public/CREDITS.txt`).
