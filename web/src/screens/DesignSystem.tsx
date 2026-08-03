import { useState, type ReactNode } from 'react';
import { useTheme } from '../theme';
import AgentBadge from '../components/AgentBadge';
import CodeBlock from '../code/CodeBlock';
import { Skel, SkeletonLines, SkeletonRows } from '../components/Skeleton';
import Badge from '../components/Badge';
import Button from '../components/Button';
import IconButton from '../components/IconButton';
import Segmented from '../components/Segmented';
import SearchField from '../components/SearchField';
import Dropdown from '../components/Dropdown';
import NoteDot from '../components/NoteDot';
import Primary from '../components/Primary';
import TextArea from '../components/TextArea';
import Overlay from '../components/Overlay';
import * as Icons from '../icons';
import {
  BookmarkFilledIcon,
  BookmarkIcon,
  Brandmark,
  ChartIcon,
  ChatIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  CloseIcon,
  CmdLensIcon,
  CopyIcon,
  DiffLensIcon,
  DownloadIcon,
  ErrorLensIcon,
  FolderIcon,
  MagniferIcon,
  MoonIcon,
  PinFilledIcon,
  PlayCircleIcon,
  PowerIcon,
  ShareIcon,
  SidebarIcon,
  SortVerticalIcon,
  TuningIcon,
  WalletIcon,
} from '../icons';
import Tooltip from '../components/Tooltip';
import { SYNTAX_DARK, SYNTAX_LIGHT, SYNTAX_USE } from '../code/syntax';
import { APP_EVENT, emitAppEvent } from '../events';
import { Group, Section, Swatch, useScopedTokenValues, type TokenSpec } from './dsKit';
import './DesignSystem.css';

/**
 * The living design-system reference (`#/design-system`).
 *
 * Internal only — nothing links here: no header button, no palette entry, no
 * mention in What's New. It exists so the visual language can be reviewed in
 * one place, in both themes, without hunting through screens.
 *
 * The rule that keeps it honest: **every specimen is the real thing.** Colors
 * are read back off the DOM at runtime rather than transcribed, and every
 * component demo imports the actual primitive — the overlays open for real,
 * because an overlay is fixed to the viewport and cannot be shown in place.
 * Nothing here is a drawing of a component, so it cannot quietly go stale
 * when a token or a primitive changes.
 *
 * Written reference for the *intent* behind these values lives in the
 * design-system doc; this page is the specimen sheet. If the two disagree,
 * this page is right.
 */

/* ── data ───────────────────────────────────────────────────────────── */

interface PaletteGroup {
  title: string;
  note?: string;
  /** `ink` draws the sample as type rather than as a fill. */
  mode?: 'fill' | 'ink';
  tokens: TokenSpec[];
}

const PALETTE: PaletteGroup[] = [
  {
    title: 'Surfaces',
    note: 'The background is the app surface; cards separate by tone, never by shadow.',
    tokens: [
      { token: '--bg0', use: 'app background (full-bleed)' },
      { token: '--card', use: 'cards, sidebar, inputs' },
      { token: '--bg1', use: 'inset inside a card' },
      { token: '--bg2', use: 'controls, hover' },
      { token: '--bg3', use: 'pressed / stronger inset' },
      { token: '--line', use: 'structural hairline' },
      { token: '--line-soft', use: 'softer hairline' },
    ],
  },
  {
    title: 'Ink',
    mode: 'ink',
    tokens: [
      { token: '--tx0', use: 'primary text' },
      { token: '--tx1', use: 'secondary text' },
      { token: '--tx2', use: 'faint text, labels' },
    ],
  },
  {
    title: 'Emphasis & overlay',
    note: 'The one surface that inverts against its theme — near-white on dark, near-black on light. It carries the project tiles and the current turn. The scrim is not a surface at all, which is why it does not invert.',
    tokens: [
      { token: '--contrast-solid', use: 'the emphasis surface' },
      { token: '--contrast-on', use: 'text on it' },
      { token: '--contrast-dim', use: 'secondary text on it' },
      { token: '--contrast-line', use: 'hairline on it' },
      {
        token: '--scrim',
        use: 'backdrop behind centred overlays — one value, both themes',
      },
    ],
  },
  {
    title: 'Keycaps',
    note: 'Keyboard shortcuts, in the sheet, the palette and tooltips. Their own tokens even though the values match --bg2/--bg3/--tx1 — a key is a raised object rather than a control surface, and nothing else in the system has a pressed edge.',
    tokens: [
      { token: '--key-bg', use: 'cap face' },
      { token: '--key-edge', use: 'pressed bottom edge' },
      { token: '--key-tx', use: 'legend' },
    ],
  },
];

const STATE: PaletteGroup[] = [
  {
    title: 'Success',
    note: 'Ok status, live rows, added lines. Four rungs — hue, text-safe, wash, fill.',
    tokens: [
      { token: '--success', use: 'the hue: dots, rails' },
      { token: '--success-tx', use: 'text-safe' },
      { token: '--success-dim', use: 'added-line ground' },
      { token: '--success-fill', use: 'fill, white glyph · invariant' },
    ],
  },
  {
    title: 'Warning',
    note: 'Degraded, not failed — a health state that still answers, files the indexer skipped, a tool call whose result never arrived. Deliberately the note yellow: one yellow in the system, so a warning and an annotation read as the same kind of mark rather than two competing ones. The fill is the sticky-note pairing, paper under ink.',
    tokens: [
      { token: '--warning', use: 'the hue: dots, text' },
      { token: '--warning-tx', use: 'text-safe' },
      { token: '--warning-dim', use: 'wash' },
      { token: '--warning-fill', use: 'fill — sticky-note paper · invariant' },
      { token: '--warning-on', use: 'ink on the fill' },
    ],
  },
  {
    title: 'Danger',
    note: 'Failures and removals. No longer the accent — a failure and a call to action used to be the same hex.',
    tokens: [
      { token: '--danger', use: 'the hue: dots, rails' },
      { token: '--danger-tx', use: 'text-safe' },
      { token: '--danger-dim', use: 'removed-line ground' },
      { token: '--danger-fill', use: 'fill, white glyph · invariant' },
    ],
  },
];

const SEARCH_TOKENS: PaletteGroup[] = [
  {
    title: 'Search',
    note: 'Kept as-is. Blue is right precisely because it is not a state — a match is neither good nor bad, and a state colour would imply a verdict the search does not have.',
    tokens: [
      { token: '--mark', use: 'wash on every hit' },
      { token: '--blue', use: 'outline on the current hit' },
      { token: '--blue-dim', use: 'blue wash — summary badge, charts' },
    ],
  },
];

const SPEAKER_TOKENS: PaletteGroup[] = [
  {
    title: 'Speakers',
    note: 'Peers, so they separate by hue. The agent is a desaturated slate — the blue region is full, so it clears the search blue by chroma rather than hue. No subagent hue: it separates by texture.',
    tokens: [
      { token: '--c-user', use: 'user turns — magenta' },
      { token: '--c-assistant', use: 'agent turns and subagent runs — slate' },
      { token: '--c-tool', use: 'tool calls' },
      { token: '--c-dim', use: 'meta / bookkeeping' },
    ],
  },
];

const IDENTITY_TOKENS: PaletteGroup[] = [
  {
    title: 'Agents',
    note: "Each adapter's true brand hue, not a darkened derivative — a colour that identifies something stops identifying it once you adjust it. Both sit under the 3.5:1 white-text bar as a result, so the badge label carries the load, the way a project tile's letter does.",
    tokens: [
      { token: '--agent-claude', use: 'Anthropic clay' },
      { token: '--agent-codex', use: 'OpenAI slate' },
    ],
  },
];
const CATEGORY_TOKENS: PaletteGroup[] = [
  {
    title: 'Categories',
    note: 'All four, in lens order. Prompts and errors borrow rather than own — a prompt IS the user and an error IS a failure, so only diffs and commands need a hue of their own.',
    tokens: [
      { token: '--c-user', use: 'prompts — borrowed from the user rail' },
      {
        token: '--c-diff',
        use: 'diffs — teal, because green now means success',
      },
      { token: '--c-diff-tx', use: 'diffs, text-safe' },
      { token: '--c-command', use: 'commands' },
      { token: '--c-command-tx', use: 'commands, text-safe' },
      { token: '--c-command-fill', use: 'commands as a fill · invariant' },
      { token: '--danger', use: 'errors — borrowed from the danger ramp' },
    ],
  },
  {
    title: 'Notes & bookmarks',
    note: 'Reviewed and kept. The sticky-note pairing is load-bearing — --note-paper under --note-ink — and it is why yellow is spoken for when warning comes back.',
    tokens: [
      { token: '--c-note', use: 'the note marker' },
      { token: '--note-dim', use: 'pinned-row wash' },
      { token: '--note-paper', use: 'sticky-note ground' },
      { token: '--note-ink', use: 'sticky-note ink' },
    ],
  },
];

const ACCENT: PaletteGroup[] = [
  {
    title: 'Accent — vermilion',
    note: 'Kept. The only colour allowed to shout — CTAs and emphasis, nothing else. It is the one set with an -on family of its own, because the accent surface is vermilion in both themes and its text never inverts.',
    tokens: [
      { token: '--accent', use: 'CTAs, emphasis' },
      { token: '--accent-hi', use: 'hover' },
      { token: '--accent-dim', use: 'wash' },
      { token: '--accent-on', use: 'text on accent' },
      { token: '--accent-on-dim', use: 'secondary text on accent' },
      { token: '--accent-on-line', use: 'hairline on accent' },
    ],
  },
];

const COLORS: PaletteGroup[] = [
  ...PALETTE,
  ...STATE,
  ...SEARCH_TOKENS,
  ...SPEAKER_TOKENS,
  ...IDENTITY_TOKENS,
  ...CATEGORY_TOKENS,
  ...ACCENT,
];

const PALETTE_TOKENS: string[] = COLORS.flatMap((g) => g.tokens).map((t) => t.token);

interface Collision {
  hue: string;
  swatch: string;
  jobs: string[];
  /** Jobs already moved off this hue, and where they went. */
  resolved?: string;
}

const COLLISIONS: Collision[] = [
  {
    hue: 'Vermilion',
    swatch: '--accent',
    jobs: ['brand accent / CTA', 'the user speaker rail'],
    resolved:
      'errors, diff deletions and the errors lens → --danger; “fixed” in What’s New → a section heading',
  },
  {
    hue: 'Blue',
    swatch: '--blue',
    jobs: ['search match + current-hit outline', 'summary badge', 'chart + meter fill'],
    resolved:
      'the assistant speaker → --c-assistant; “improved” in What’s New → a section heading, no colour at all',
  },
];

const SYNTAX = (Object.keys(SYNTAX_USE) as (keyof typeof SYNTAX_USE)[]).map((k) => ({
  scope: k,
  dark: SYNTAX_DARK[k],
  light: SYNTAX_LIGHT[k],
  note: SYNTAX_USE[k],
}));

const LADDER: { token: string; px: string; role: string }[] = [
  {
    token: '--fs-10',
    px: '10',
    role: 'badges, axis ticks, keycaps, dense mono',
  },
  {
    token: '--fs-12',
    px: '12',
    role: 'timestamps, counts, ids, costs, code, badges, uppercase labels',
  },
  {
    token: '--fs-14',
    px: '14',
    role: 'body — message text, list rows, buttons, inputs',
  },
  {
    token: '--fs-16',
    px: '16',
    role: 'session title, search group title, sheet titles',
  },
  {
    token: '--fs-18',
    px: '18',
    role: 'card titles, the wordmark, stat values, tile initials',
  },
  { token: '--fs-24', px: '24', role: 'screen titles — every h1' },
  {
    token: '--fs-32',
    px: '32',
    role: 'display numbers — indexed history, spend, disk',
  },
  {
    token: '--fs-40',
    px: '40',
    role: 'the two headline figures — home hero, accent card',
  },
];

const FACES: { token: string; name: string; note: string; weights: string }[] = [
  {
    token: '--sans',
    name: 'Plus Jakarta Sans',
    note: 'Chrome — everything the app says in its own voice.',
    weights: 'variable 200–800; 400 and 500 are both real weights',
  },
  {
    token: '--mono',
    name: 'Space Mono',
    note: 'Content — anything quoted from the log: code, ids, paths, costs, keycaps.',
    weights: 'ships 400 and 700 only, so mono asking for 500 renders at 400',
  },
];

type IconComp = React.ComponentType<{ size?: number; className?: string }>;
const MARK_NAMES = ['ClaudeMark', 'OpenAIMark', 'Brandmark'];
const ALL_ICONS = Object.entries(Icons as Record<string, IconComp>);
const ICONS = ALL_ICONS.filter(([n]) => !MARK_NAMES.includes(n));
const MARKS = ALL_ICONS.filter(([n]) => MARK_NAMES.includes(n));

/** What "unified" actually means — the numbers every Primary now shares. */
const PRIMARY_METRICS: { prop: string; value: string; role: string }[] = [
  {
    prop: 'height',
    value: '44px',
    role: 'pill and circle alike — the circle is 44 wide too',
  },
  {
    prop: 'padding',
    value: '0 18px',
    role: 'labelled only; a circle has none',
  },
  { prop: 'radius', value: '999px', role: 'fully round at every width' },
  {
    prop: 'font-size',
    value: '--fs-14',
    role: 'weight 500, the frame’s voice',
  },
  {
    prop: 'icon',
    value: '16px',
    role: 'pinned in Primary.css so no call site can drift',
  },
  { prop: 'gap', value: '8px', role: 'icon to label' },
];

/** The hero CTA's mark: the one arrow that means "go", not "open". */
function ArrowRight() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path
        d="M4 12h14M13 6l6 6-6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const MOTION: { d: string; role: string }[] = [
  {
    d: '150ms ease',
    role: 'the default — every hover: colour, background, opacity, filter',
  },
  { d: '70ms', role: 'press-down scale — 0.92 on circles, 0.96 on pills' },
  {
    d: '140ms soft',
    role: 'overlay entrances — tooltip and the lifted note, fade-slide 4px',
  },
  {
    d: '200ms soft',
    role: "a control's own transform — the sort-direction flip",
  },
  { d: '260ms soft', role: 'the sidebar slide — the one structural motion' },
];

const RADII: { token: string; px: string; role: string }[] = [
  { token: '--radius-xs', px: '9', role: 'tile-xs' },
  {
    token: '--radius-sm',
    px: '12',
    role: 'list rows, controls, inset fields, tile-sm',
  },
  {
    token: '--radius',
    px: '14',
    role: 'tiles, code blocks, diffs, sidechain runs',
  },
  {
    token: '--radius-md',
    px: '16',
    role: 'panels, popovers, stat tiles, menus',
  },
  { token: '--radius-lg', px: '24', role: 'cards' },
  { token: '999px', px: '999', role: 'pills, circles, keycap rows' },
];

const SPACES: { label: string; px: number }[] = [
  { label: 'bento gap', px: 20 },
  { label: 'card padding (min–max 20–32)', px: 26 },
  { label: 'screen gutter (.screen)', px: 14 },
  { label: 'popover padding', px: 14 },
  { label: 'control gap', px: 10 },
  { label: 'tight gap', px: 6 },
];

const METRICS: { token: string; value: string; role: string }[] = [
  {
    token: '--gutter',
    value: '14px',
    role: 'shared by the screen, the sidebar and any full-width band',
  },
  {
    token: '--rail-w',
    value: '3px',
    role: 'speaker rails; content rails (blockquotes, thinking) are 2px',
  },
  { token: '--sidebar-w', value: '356px', role: 'the session list rail' },
];

const SECTIONS = [
  { id: 'dsn-colors', label: 'Colors' },
  { id: 'dsn-syntax', label: 'Syntax' },
  { id: 'dsn-type', label: 'Typography' },
  { id: 'dsn-icons', label: 'Icons' },
  { id: 'dsn-badges', label: 'Badges' },
  { id: 'dsn-shapes', label: 'Shapes & spaces' },
  { id: 'dsn-buttons', label: 'Buttons' },
  { id: 'dsn-tabs', label: 'Tabs' },
  { id: 'dsn-layout', label: 'Layout' },
  { id: 'dsn-fields', label: 'Fields' },
  { id: 'dsn-markers', label: 'Markers' },
  { id: 'dsn-avatars', label: 'Avatars' },
  { id: 'dsn-skel', label: 'Skeletons' },
  { id: 'dsn-dots', label: 'Dots' },
  { id: 'dsn-code', label: 'Code' },
  { id: 'dsn-keys', label: 'Keycaps' },
  { id: 'dsn-tooltip', label: 'Tooltip' },
  { id: 'dsn-motion', label: 'Motion' },
  { id: 'dsn-collisions', label: 'Collisions' },
];

/** Flat, stable list for the one getComputedStyle pass. */
const ALL_TOKENS: string[] = [...new Set(COLLISIONS.map((c) => c.swatch))];

/* ── specimens ──────────────────────────────────────────────────────── */

/* The pane owns the theme class, so tokens resolve as they would on a real
   screen in that theme and the hex is read back off this element. */
function PalettePane({ theme, groups }: { theme: 'dark' | 'light'; groups: PaletteGroup[] }) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const values = useScopedTokenValues(el, PALETTE_TOKENS);
  return (
    <div className={`dsn-pane theme-${theme}`} ref={setEl}>
      <span className="dsn-pane-label">{theme}</span>
      {groups.map((g) => (
        <div key={g.title} className="dsn-pane-group">
          <h4>{g.title}</h4>
          {g.note && <p>{g.note}</p>}
          <div className="ds-swatches">
            {g.tokens.map((spec) => (
              <Swatch key={spec.token} spec={spec} value={values[spec.token]} mode={g.mode} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Any colour set, shown in both themes at once. */
function ThemePanes({ groups }: { groups: PaletteGroup[] }) {
  return (
    <div className="dsn-palette">
      <PalettePane theme="dark" groups={groups} />
      <PalettePane theme="light" groups={groups} />
    </div>
  );
}

/**
 * One component and everything about it, boxed. A section can hold several,
 * and without the box their groups run together into one long list.
 */
function Family({
  title,
  file,
  note,
  children,
}: {
  title: string;
  file: string;
  note: string;
  children: ReactNode;
}) {
  return (
    <section className="dsn-family">
      <header className="dsn-family-head">
        <h3>{title}</h3>
        <code>{file}</code>
        <p>{note}</p>
      </header>
      {children}
    </section>
  );
}

/* ── the page ───────────────────────────────────────────────────────── */

export default function DesignSystem() {
  const theme = useTheme();
  // Read against the page root rather than :root, so a theme-scoped subtree
  // (the two palette panes) resolves the same way a real screen would.
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const [seg, setSeg] = useState<'spine' | 'log' | 'files'>('spine');
  const [filter, setFilter] = useState('');
  const [query, setQuery] = useState('indexer worker');
  const [note, setNote] = useState('');
  const [demoOverlay, setDemoOverlay] = useState(false);
  const [sort, setSort] = useState('recent');
  const values = useScopedTokenValues(root, ALL_TOKENS);

  return (
    <div className="ds" ref={setRoot}>
      <div className="ds-inner">
        <header className="ds-head">
          <h1>Design system</h1>
          <span className="ds-head-note">
            #/design-system · internal · rendering the {theme} theme
          </span>
        </header>

        <p className="dsn-lede">
          <strong>Every specimen here is the real thing.</strong> Colours are read off the DOM at
          runtime rather than transcribed, and each component demo imports the actual primitive — so
          this page cannot quietly go stale when a token or a component changes. Tokens live in{' '}
          <code>theme.css</code>, primitives in <code>components/</code>, and screen context in{' '}
          <code>app.css</code>. Before adding a value, look for the one that already exists: every
          drift this system has had to correct started as one reasonable local choice.
        </p>

        <nav className="ds-toc" aria-label="Sections">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() =>
                document
                  .getElementById(s.id)
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }
            >
              {s.label}
            </button>
          ))}
        </nav>

        <Section
          id="dsn-colors"
          title="Colors"
          note="Every token, both themes, read live off the DOM rather than transcribed."
        >
          <ThemePanes groups={COLORS} />
        </Section>

        <Section
          id="dsn-syntax"
          title="Syntax"
          note="A second palette, in web/src/code/syntax.ts — a textmate theme inside a worker, which has no document to read CSS variables from. Every scope mirrors a token."
        >
          <table className="dsn-syntax">
            <thead>
              <tr>
                <th>Scope</th>
                <th>Dark</th>
                <th>Light</th>
                <th>Token</th>
              </tr>
            </thead>
            <tbody>
              {SYNTAX.map((r) => (
                <tr key={r.scope}>
                  <td>{r.scope}</td>
                  <td>
                    <span className="dsn-syntax-badge" style={{ background: r.dark }} aria-hidden />
                    {r.dark}
                  </td>
                  <td>
                    <span
                      className="dsn-syntax-badge"
                      style={{ background: r.light }}
                      aria-hidden
                    />
                    {r.light}
                  </td>
                  <td>{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section
          id="dsn-type"
          title="Typography"
          note="Two faces, eight sizes. Both bundled — nothing loads from the network, ever."
        >
          <Group title="Faces" note="Chrome speaks in sans; anything quoted from the log is mono.">
            <div className="dsn-faces">
              {FACES.map((f) => (
                <div key={f.token} className="dsn-face">
                  <p className="dsn-face-sample" style={{ fontFamily: `var(${f.token})` }}>
                    Indexed 1,284 sessions
                  </p>
                  <span className="dsn-face-name">{f.name}</span>
                  <span className="dsn-rail-note">{f.note}</span>
                  <span className="dsn-face-weights">
                    {f.token} · {f.weights}
                  </span>
                </div>
              ))}
            </div>
          </Group>

          <Group
            title="The ladder"
            note="Every font-size in the app is one of these eight, and every one is in use. There are no reserve steps — adding a size should be a deliberate act."
          >
            <div className="dsn-ladder">
              {LADDER.map((l) => (
                <div key={l.token} className="dsn-step">
                  <span className="dsn-step-sample" style={{ fontSize: `var(${l.token})` }}>
                    Search and replay
                  </span>
                  <span className="dsn-step-token">{l.token}</span>
                  <span className="dsn-step-role">{l.role}</span>
                </div>
              ))}
            </div>
          </Group>

          <Group
            title="Weights"
            note="Two in practice: 400 for running text, 500 for anything that titles or labels. 200 appears once, on the wordmark; 700 once, in mono."
          >
            <div className="dsn-weights">
              {[400, 500].map((w) => (
                <span key={w} className="dsn-weight" style={{ fontWeight: w }}>
                  {w} — Search and replay
                </span>
              ))}
            </div>
          </Group>
        </Section>

        <Section
          id="dsn-icons"
          title="Icons"
          note="Solar outline set, vendored as path data in web/src/icons.tsx — nothing loads from the network. Drawn in currentColor, so an icon takes the colour of whatever contains it."
        >
          <Group
            title="Interface"
            note="Default 18px. Inside a badge they size to 1em instead, so they track the type."
          >
            <div className="dsn-icons">
              {ICONS.map(([name, Icon]) => (
                <div key={name} className="dsn-icon">
                  <Icon size={20} />
                  <span>{name}</span>
                </div>
              ))}
            </div>
          </Group>

          <Group title="Marks" note="Brand marks — the agent registry and the wordmark.">
            <div className="dsn-icons">
              {MARKS.map(([name, Icon]) => (
                <div key={name} className="dsn-icon">
                  <Icon size={20} />
                  <span>{name}</span>
                </div>
              ))}
            </div>
          </Group>
        </Section>

        <Section
          id="dsn-badges"
          title="Badges"
          note="Every small rounded label. One size — kinds change the wash, the family and the casing, never the metrics."
        >
          <Group
            title="Badges"
            note="components/Badge.tsx. Metadata tags, status badges, slash-command pills, and the brand-filled agent badge."
          >
            <div className="dsn-badges">
              <Badge>attachment</Badge>
              <Badge kind="cmd">/compact</Badge>
              <Badge kind="summary">summary</Badge>
              <Badge kind="failed">failed</Badge>
              <Badge kind="model">claude-opus-4-6</Badge>
            </div>
          </Group>

          <Group
            title="Agent providers"
            note="Each adapter's own brand hue and mark, from the registry in web/src/agents.ts. Two encodings always: the mark for recognition, the word for certainty. An unregistered tool degrades to the neutral badge carrying its raw id — a new adapter must never break the UI."
          >
            <div className="dsn-agents">
              {[
                { tool: 'claude-code', token: '--agent-claude' },
                { tool: 'codex', token: '--agent-codex' },
                { tool: 'future-adapter', token: '— neutral fallback' },
              ].map((a) => (
                <div key={a.tool} className="dsn-agent">
                  <AgentBadge tool={a.tool} />
                  <span className="dsn-agent-token">{a.token}</span>
                </div>
              ))}
            </div>
          </Group>
        </Section>

        <Section
          id="dsn-shapes"
          title="Shapes & spaces"
          note="Every rounded thing lands on one of five steps or on 999px — nothing in between. Sub-9px radii exist only inside glyph-scale marks: keycaps, <mark>, the note-dot fold."
        >
          <Group title="Radius" note="Drawn at their real value, not to scale.">
            <div className="dsn-radii">
              {RADII.map((r) => (
                <div key={r.token} className="dsn-radius">
                  <span
                    className="dsn-radius-box"
                    style={{
                      borderRadius: r.px === '999' ? '999px' : `var(${r.token})`,
                    }}
                  />
                  <span className="dsn-radius-token">{r.token}</span>
                  <span className="dsn-radius-role">{r.role}</span>
                </div>
              ))}
            </div>
          </Group>

          <Group
            title="Metrics"
            note="The three layout constants that are tokens rather than literals."
          >
            <div className="dsn-metrics">
              {METRICS.map((m) => (
                <div key={m.token} className="dsn-metric">
                  <span className="dsn-metric-token">{m.token}</span>
                  <span className="dsn-metric-value">{m.value}</span>
                  <span className="dsn-metric-role">{m.role}</span>
                </div>
              ))}
            </div>
          </Group>
        </Section>

        <Section
          id="dsn-buttons"
          title="Buttons"
          note="Three types, boxed separately below. Each box is one component and everything it can do."
        >
          <Family
            title="Primary"
            file="components/Primary.tsx"
            note="The app frame's button, and the one type behind every instance of it: the header's nav pills and round icon buttons, the sidebar toggle, the hero call to action, the stop button. Six implementations across four files before; one now. Only the fill changes — the metrics never do."
          >
            <Group title="Metrics" note="What “unified” means: every Primary shares these.">
              <div className="dsn-metrics">
                {PRIMARY_METRICS.map((m) => (
                  <div key={m.prop} className="dsn-metric">
                    <span className="dsn-metric-token">{m.prop}</span>
                    <span className="dsn-metric-value">{m.value}</span>
                    <span className="dsn-metric-role">{m.role}</span>
                  </div>
                ))}
              </div>
            </Group>

            <Group
              title="Fills · on the background"
              note="Four of the five belong on the bare app surface, and each means something: card is the rest fill; contrast is “you are here”; accent is the call to action, at most one per screen; danger is the armed half of an arm-then-confirm."
            >
              <div className="dsn-primary-stage">
                <Primary label="Card" icon={<MagniferIcon />} />
                <Primary icon={<FolderIcon />}>Card</Primary>
                <Primary fill="contrast" label="Contrast" icon={<WalletIcon />} />
                <Primary fill="contrast" icon={<WalletIcon />}>
                  Contrast
                </Primary>
                <Primary fill="accent" label="Accent" icon={<MagniferIcon />} />
                <Primary fill="accent" trailing={<ArrowRight />}>
                  Accent
                </Primary>
                <Primary fill="danger" label="Danger" icon={<PowerIcon />} />
                <Primary fill="danger" icon={<PowerIcon />}>
                  Danger
                </Primary>
              </div>
            </Group>

            <Group
              title="Fills · on a card"
              note="Quiet is the fifth, and it is the mirror of card: --card vanishes on a card, --bg2 vanishes on the background. So quiet is only ever correct here — the dismissive half of a pair, and any frame button standing on a card. Shown on --card, which is the only ground it is allowed on."
            >
              <div className="dsn-primary-card">
                <Primary fill="quiet" label="Quiet" icon={<SidebarIcon />} />
                <Primary fill="quiet">Cancel</Primary>
                <Primary fill="quiet">Save</Primary>
              </div>
            </Group>

            <Group
              title="Pairs"
              note="Quiet beside accent is the standard two-button row — the dismissive option keeps its weight down without turning into a link. Same metrics on both, so the row has one height. It lives on a card, which is what makes quiet legible."
            >
              <div className="dsn-primary-card">
                <Primary fill="quiet">Cancel</Primary>
                <Primary fill="accent">Save</Primary>
              </div>
            </Group>

            <Group
              title="Shapes"
              note="One type, four arrangements. A leading icon says what the button is; a trailing one says it moves you forward. With no visible label the pill closes to a circle and the name lives in aria-label — which is why label is mandatory there and optional everywhere else."
            >
              <div className="dsn-primary-stage">
                <Primary icon={<FolderIcon />}>Leading icon</Primary>
                <Primary trailing={<ArrowRight />}>Trailing icon</Primary>
                <Primary>Label only</Primary>
                <Primary label="Icon only, named by aria-label" tooltip="Icon only" />
              </div>
            </Group>

            <Group
              title="States"
              note="Hover and press are live on every specimen above — 1px lift, then 0.96 down (0.92 for a circle, which can take it without looking squeezed). These two are specific: the stop button's armed half, and the status circle's unseen-release ring, which is the status button's alone and lives in app.css rather than the component."
            >
              <div className="dsn-primary-stage">
                <Primary label="Stop Turnlog" tooltip="Stop Turnlog" icon={<PowerIcon />} />
                <Primary
                  fill="danger"
                  label="Confirm: stop Turnlog"
                  tooltip="Press again to stop"
                  icon={<PowerIcon />}
                />
                <Primary
                  label="Index status"
                  tooltip="Index up to date"
                  icon={<span className="status-dot idle" />}
                />
                <Primary
                  className="news"
                  label="Index status — unseen release notes"
                  tooltip="See what’s new"
                  icon={<span className="status-dot idle" />}
                />
                <Primary disabled label="Disabled" icon={<MagniferIcon />} />
              </div>
            </Group>

            <Group
              title="On a card"
              note='The sidebar toggle is the same button as the header&apos;s, one fill up: on the sidebar card a --card fill would vanish into the ground. It used to be an app.css override on .sidebar-brand; it is now just fill="quiet", said where the button is written. The brandmark beside it is 44px to match.'
            >
              <div className="dsn-primary-card">
                <Primary
                  fill="quiet"
                  label="Hide sessions"
                  tooltip="Hide sessions"
                  icon={<SidebarIcon />}
                />
                <Brandmark />
              </div>
            </Group>
          </Family>

          <Family
            title="Icon"
            file="components/IconButton.tsx"
            note="Every round icon-only button smaller than the frame's 44 — the 44s left for Primary. One size, 34, with four fills chosen by the ground underneath; the 26px ghost is the single exception, and it earns it. `label` is mandatory: an icon-only button without an accessible name is a defect, not an option."
          >
            <Group
              title="Fills · on a card"
              note="One size — 34 — and the fill is picked by the ground, exactly as it is on Primary. Quiet is the default here. There used to be three sizes (34, 34, 32) separated by nothing but their rest colour; the colour was the real difference, so it became the fill and the sizes collapsed."
            >
              <div className="dsn-icon-stage">
                <span className="dsn-icon-spec">
                  <IconButton label="Show sessions" tooltip="--bg2 · 34px">
                    <SidebarIcon />
                  </IconButton>
                  <em>quiet</em>
                </span>
                <span className="dsn-icon-spec">
                  <IconButton label="Sort direction" tooltip="--bg1 · 34px" fill="inset">
                    <SortVerticalIcon />
                  </IconButton>
                  <em>inset</em>
                </span>
                <span className="dsn-icon-spec">
                  <IconButton label="Close" tooltip="transparent · 26px" fill="ghost">
                    <CloseIcon />
                  </IconButton>
                  <em>ghost</em>
                </span>
              </div>
            </Group>

            <Group
              title="Fills · on the background"
              note="The card fill, and the only reason it exists: --bg2 all but disappears on --bg0 in the light theme. Primary makes the same pairing in the other direction — card on the background, quiet on a card. Shown on --bg0, next to the quiet fill it replaces. (The pill and the view toggles still need a per-site override in app.css for this; they have no fill prop yet.)"
            >
              <div className="dsn-primary-stage">
                <span className="dsn-icon-spec">
                  <IconButton fill="card" label="Previous week" tooltip="--card on --bg0">
                    <ChevronLeftIcon />
                  </IconButton>
                  <em>card</em>
                </span>
                <span className="dsn-icon-spec">
                  <IconButton label="Previous week" tooltip="--bg2 on --bg0 — the wrong one">
                    <ChevronLeftIcon />
                  </IconButton>
                  <em>quiet</em>
                </span>
              </div>
            </Group>

            <Group
              title="States"
              note="Four, and they are the only four. Active is the contrast fill — the same statement Primary makes; it used to be --bg3, which is also the hover colour, so a toggle that was on looked like a toggle you happened to be pointing at. Ok and disabled are results rather than toggles: ok states itself as a fill, disabled drops to 35% so the shape stays readable as a control. Shown on one fill, because the state is the same on all of them."
            >
              <div className="dsn-icon-stage">
                <span className="dsn-icon-spec">
                  <IconButton label="Filters" tooltip="rest">
                    <TuningIcon />
                  </IconButton>
                  <em>rest</em>
                </span>
                <span className="dsn-icon-spec">
                  <IconButton label="Filters, on" tooltip="active" active>
                    <TuningIcon />
                  </IconButton>
                  <em>active</em>
                </span>
                <span className="dsn-icon-spec">
                  <IconButton label="Copied" tooltip="ok" className="ok">
                    <CheckIcon />
                  </IconButton>
                  <em>ok</em>
                </span>
                <span className="dsn-icon-spec">
                  <IconButton label="Next" tooltip="disabled" disabled>
                    <ChevronRightIcon />
                  </IconButton>
                  <em>disabled</em>
                </span>
              </div>
            </Group>

            <Group
              title="Lens actions"
              note="Not a button of their own — an IconButton wearing .lens-action plus its category class. The category is the fill and the glyph reverses out of it, so the hue is the button rather than a tint on the icon; --c-on carries the reversal and flips with the theme because the category hues do. Active takes the contrast surface, the same as every other IconButton — the colour yields to legibility while pressed."
            >
              <div className="dsn-icon-stage">
                <div className="lens-actions">
                  <IconButton label="diffs lens" tooltip="diffs" className="lens-action lens-diffs">
                    <DiffLensIcon size={15} />
                  </IconButton>
                  <IconButton
                    label="commands lens"
                    tooltip="commands"
                    className="lens-action lens-commands"
                  >
                    <CmdLensIcon size={15} />
                  </IconButton>
                  <IconButton
                    label="errors lens"
                    tooltip="errors"
                    className="lens-action lens-errors"
                  >
                    <ErrorLensIcon size={15} />
                  </IconButton>
                  <IconButton
                    label="prompts lens"
                    tooltip="prompts"
                    className="lens-action lens-prompts"
                  >
                    <ChatIcon size={15} />
                  </IconButton>
                  <IconButton
                    label="diffs lens, active"
                    tooltip="diffs"
                    className="lens-action lens-diffs"
                    active
                  >
                    <DiffLensIcon size={15} />
                  </IconButton>
                </div>
              </div>
            </Group>

            <Group
              title="In context"
              note="Not states — compositions. A button carrying a count dot, and the two nav rails, which are containers holding a count and a pair of ghost buttons. Each is the markup from its own screen."
            >
              <div className="dsn-buttons">
                <IconButton
                  fill="inset"
                  label="Session filters and sort"
                  tooltip="Filters & sort — 2 active"
                  className="filter-btn"
                >
                  <TuningIcon size={16} />
                  <span className="filter-dot" />
                </IconButton>
              </div>

              <div className="dsn-buttons dsn-buttons-rails">
                <div className="error-nav bookmark-nav">
                  <BookmarkFilledIcon size={13} className="bookmark-nav-ico" />
                  <span className="error-nav-count bookmark-nav-count">2</span>
                  <IconButton fill="ghost" label="Previous bookmark" tooltip="Previous bookmark">
                    <ChevronUpIcon size={16} />
                  </IconButton>
                  <IconButton fill="ghost" label="Next bookmark" tooltip="Next bookmark">
                    <ChevronDownIcon size={16} />
                  </IconButton>
                </div>
                <div className="error-nav">
                  <span className="dot dot-error" />
                  <span className="error-nav-count">3</span>
                  <IconButton fill="ghost" label="Previous error" tooltip="Previous error">
                    <ChevronUpIcon size={16} />
                  </IconButton>
                  <IconButton fill="ghost" label="Next error" tooltip="Next error">
                    <ChevronDownIcon size={16} />
                  </IconButton>
                </div>
              </div>
            </Group>
          </Family>

          <Family
            title="Text"
            file="components/Button.tsx"
            note="Text actions inside cards and popovers — a different component from Primary and a different job. Compact metrics on purpose: these sit on a card, where the frame&#39;s 44px would shout."
          >
            <Group
              title="The pill"
              note="One shape, and it is all this component has. The compact pair that used to live here — a gray .btn and a contrast .btn.primary for popover actions — turned out to be Primary wearing smaller metrics, so the share panel's copy/download are Primary fills now and the two variants are gone. What is left is the action that wants to be available without asking for attention."
            >
              <div className="dsn-icon-stage">
                <Button>This week</Button>
                <Button disabled>This week</Button>
              </div>
            </Group>

            <Group
              title="Fills"
              note="The same card/quiet pair every other type has, chosen by the ground: quiet on a card, card on the bare app background. Both shown on the ground they belong to."
            >
              <div className="dsn-icon-stage">
                <Button>quiet · on a card</Button>
              </div>
              <div className="dsn-primary-stage dsn-stage-stacked">
                <Button fill="card">card · on the background</Button>
              </div>
            </Group>

            <Group
              title="Text-only"
              note="Two buttons with no ground of their own — both only make sense inside the container they belong to, so they are shown in it."
            >
              <div className="dsn-buttons">
                <div className="dsn-pop-demo">
                  <span className="pop-label">sort</span>
                  <button className="filter-reset">reset filters</button>
                </div>
                <div className="dsn-codebar-demo">
                  <div className="code-block">
                    <pre>
                      <code>{'// 42,118 characters — past the highlight cap'}</code>
                    </pre>
                    <button className="code-highlight-anyway">Highlight anyway</button>
                  </div>
                </div>
              </div>
            </Group>
          </Family>
        </Section>

        <Section
          id="dsn-tabs"
          title="Tabs"
          note="Not buttons: a track that holds a set of mutually exclusive choices, where the track owns the ground and one segment is pressed."
        >
          <Group
            title="Segmented"
            note="components/Segmented.tsx — view toggles, share-panel rows, the sidebar's empty-sessions switch. Single-select; clicking the pressed segment is a no-op, and a choice with nothing behind it is disabled rather than hidden. The track takes the same card/quiet fill as every other type, picked by its ground."
          >
            <div className="dsn-icon-stage">
              <Segmented
                ariaLabel="View"
                value={seg}
                options={[
                  { value: 'spine', label: 'Spine' },
                  { value: 'log', label: 'Log' },
                  { value: 'files', label: 'Files', disabled: true, title: 'No diffs' },
                ]}
                onChange={setSeg}
              />
            </div>
            <div className="dsn-primary-stage dsn-stage-stacked">
              <Segmented
                fill="card"
                ariaLabel="View, on the background"
                value={seg}
                options={[
                  { value: 'spine', label: 'Spine' },
                  { value: 'log', label: 'Log' },
                  { value: 'files', label: 'Files', disabled: true, title: 'No diffs' },
                ]}
                onChange={setSeg}
              />
            </div>
          </Group>
        </Section>

        <Section
          id="dsn-layout"
          title="Layout & containers"
          note="Structure comes from surfaces and spacing, never from borders or shadows. Shadow is reserved for true overlays."
        >
          <Group title="Cards" note="Flat, radius-lg, no shadow — --card sitting on --bg0.">
            <div className="dsn-cards">
              <div className="card dsn-card-demo">
                <strong>.card</strong>
                <span>the base surface</span>
              </div>
              <div className="card dsn-card-demo">
                <strong>.card</strong>
                <span className="dsn-inset">an inset — --bg1 inside a card</span>
              </div>
            </div>
          </Group>

          <Group
            title="Overlays"
            note="The only place a shadow appears, over a --scrim backdrop. Three of them, and each button below opens the real one rather than a picture of it — an overlay is fixed to the viewport, so it cannot be shown in place. Escape or a backdrop click dismisses all three, because components/Overlay.tsx owns that for every one."
          >
            <div className="dsn-primary-stage">
              <Primary fill="quiet" onClick={() => setDemoOverlay(true)}>
                Overlay
              </Primary>
              <Primary fill="quiet" onClick={() => emitAppEvent(APP_EVENT.palette)}>
                Command palette
              </Primary>
              <Primary fill="quiet" onClick={() => emitAppEvent(APP_EVENT.shortcuts)}>
                Shortcuts sheet
              </Primary>
            </div>
            {demoOverlay && (
              <Overlay onClose={() => setDemoOverlay(false)}>
                <div className="dsn-overlay-panel" role="dialog" aria-label="Overlay specimen">
                  <strong>Overlay</strong>
                  <span>
                    The scrim and the dismissal, nothing else — the surface on top styles itself.
                    --radius-md · --shadow · on --scrim.
                  </span>
                  <Primary fill="contrast" onClick={() => setDemoOverlay(false)}>
                    Close
                  </Primary>
                </div>
              </Overlay>
            )}
          </Group>

          <Group
            title="Role rails"
            note="3px for speakers; content rails — blockquotes, thinking — are 2px and take --line, because they quote rather than speak."
          >
            <div className="dsn-rails">
              <div className="block block-user">
                <span className="dsn-rail-name">user</span>
              </div>
              <div className="block block-assistant">
                <span className="dsn-rail-name">agent</span>
              </div>
              <div className="block block-tool">
                <span className="dsn-rail-name">tool</span>
              </div>
              <div className="sidechain">
                <div className="sidechain-head">
                  <span className="sidechain-label">subagent — hatched band</span>
                </div>
              </div>
            </div>
          </Group>
        </Section>

        <Section
          id="dsn-fields"
          title="Fields & controls"
          note="Every input in the app. A native select can't match the card language, so single-select is a component."
        >
          <Group
            title="Search field"
            note="Two sizes: sm is the inset row (sidebar filter, find bar); lg is a screen's primary query box."
          >
            <div className="dsn-fields">
              <SearchField
                value={filter}
                onChange={setFilter}
                ariaLabel="Filter sessions"
                placeholder="Filter sessions…"
                icon
                clearable
              />
              <SearchField
                size="lg"
                value={query}
                onChange={setQuery}
                ariaLabel="Search everything"
                placeholder="Search everything…"
                icon
                clearable
              />
            </div>
          </Group>

          <Group
            title="Text area"
            note="components/TextArea.tsx — the multi-line field, and the inset sibling of the sm search field: same ground, radius and focus ring, so a form mixing the two reads as one set. Vertical resize only; a text field is not a layout control."
          >
            <div className="dsn-fields">
              <TextArea
                value={note}
                onChange={setNote}
                ariaLabel="Session note"
                placeholder="Anything future-you should know about this session…"
              />
            </div>
          </Group>

          <Group
            title="Dropdown"
            note="Custom single-select — the native control can't take the card language."
          >
            <div className="dsn-fields dsn-fields-narrow">
              <Dropdown
                value={sort}
                options={[
                  { value: 'recent', label: 'Most recent' },
                  { value: 'cost', label: 'Most expensive' },
                  { value: 'turns', label: 'Most turns' },
                ]}
                onChange={setSort}
                ariaLabel="Sort order"
              />
            </div>
          </Group>

          <Group
            title="Text input"
            note="The bare element — pill-shaped, card ground, accent focus ring."
          >
            <div className="dsn-fields dsn-fields-narrow">
              <input placeholder="Session name…" aria-label="Session name" />
            </div>
          </Group>
        </Section>

        <Section
          id="dsn-markers"
          title="Markers"
          note="Things attached to content rather than to chrome — a saved note, a flagged moment, a search hit."
        >
          <Group
            title="Note"
            note="A saved note as a tiny tilted sticky; hover lifts the note itself as a popover."
          >
            <div className="dsn-markers">
              <NoteDot note="Check the resume flow before shipping." />
            </div>
          </Group>

          <Group
            title="Bookmark"
            note="Mark this moment — appears in the gutter on hover, stays when set."
          >
            <div className="dsn-markers">
              <button className="block-bookmark" aria-label="Bookmark">
                <BookmarkIcon size={14} />
              </button>
              <button className="block-bookmark on" aria-label="Bookmarked">
                <BookmarkFilledIcon size={14} />
              </button>
            </div>
          </Group>

          <Group
            title="Search hit"
            note="The FTS wash, and the outline on the match you are standing on."
          >
            <div className="dsn-markers">
              <p className="snippet dsn-snippet">
                the <mark>indexer</mark> writes per-file byte offsets, so the <mark>indexer</mark>{' '}
                never re-reads a file
              </p>
            </div>
          </Group>
        </Section>

        <Section
          id="dsn-avatars"
          title="Avatars"
          note="A project's mark. The letter and the name identify it — the fill is one colour for every project, because a hashed hue said nothing beside a name that already says it."
        >
          <Group
            title="Tiles"
            note="Three sizes, one fill: --contrast-solid, which inverts with the theme — a light block on dark, a dark block on light."
          >
            <div className="dsn-avatars">
              <span className="tile">T</span>
              <span className="tile tile-sm">R</span>
              <span className="tile tile-xs">D</span>
            </div>
          </Group>

          <Group
            title="Marks"
            note="The same identity at dot scale — month cells in the calendar and hits on the search timeline."
          >
            <div className="dsn-avatars">
              <span className="tile-dot" />
              <span className="tl-dot" />
              <span className="tl-dot big" />
            </div>
          </Group>
        </Section>

        <Section
          id="dsn-skel"
          title="Skeletons"
          note="Shimmer placeholders — used wherever content is on its way. A gradient sweeping --bg2 through --bg1, so they read as surface rather than as content."
        >
          <Group
            title="Bar"
            note="The primitive. Width, height and radius are props; width defaults to 100%."
          >
            <div className="dsn-skels">
              <Skel w={120} />
              <Skel w={64} h={10} />
              <Skel w={36} h={36} r={12} />
            </div>
          </Group>

          <Group
            title="Lines"
            note="Text placeholder — widths cycle so a block never looks like a grid."
          >
            <div className="dsn-skels-block">
              <SkeletonLines n={4} />
            </div>
          </Group>

          <Group title="Rows" note="List placeholder — tile plus two bars, matching a session row.">
            <div className="dsn-skels-block">
              <SkeletonRows n={3} />
            </div>
          </Group>
        </Section>

        <Section
          id="dsn-dots"
          title="Dots"
          note="Three sizes, three jobs. A dot never carries meaning alone — there is always a label, a count or a row beside it."
        >
          <Group title="Legend · 8px" note="Activity categories, on the home lens legend.">
            <div className="dsn-dots-row">
              {[
                ['dot-diff', 'diffs'],
                ['dot-cmd', 'commands'],
                ['dot-error', 'errors'],
                ['dot-ok', 'ok'],
              ].map(([c, label]) => (
                <span key={c} className="dsn-dot-item">
                  <span className={`dot ${c}`} />
                  {label}
                </span>
              ))}
            </div>
          </Group>

          <Group title="Status · 8px" note="The header circle. Busy pulses; the others are static.">
            <div className="dsn-dots-row">
              {[
                ['idle', 'idle'],
                ['busy', 'busy'],
                ['err', 'unreachable'],
              ].map(([c, label]) => (
                <span key={c} className="dsn-dot-item">
                  <span className={`status-dot ${c}`} />
                  {label}
                </span>
              ))}
            </div>
          </Group>

          <Group title="Tool · 6px" note="On a tool-call row in the replay — the smallest mark.">
            <div className="dsn-dots-row">
              {[
                ['', 'default'],
                ['cat-diff', 'edit'],
                ['cat-cmd', 'command'],
                ['failed', 'failed'],
              ].map(([c, label]) => (
                <span key={label} className="dsn-dot-item">
                  <span className={`tool-dot ${c}`} />
                  {label}
                </span>
              ))}
            </div>
          </Group>
        </Section>

        <Section
          id="dsn-code"
          title="Code"
          note="Shiki in a web worker, behind a language whitelist and a 30k size cap — past it, highlighting waits for a click. An unknown language falls back to a plain pre, so it degrades rather than fails."
        >
          <Group
            title="Highlighted"
            note="Shown once, in the page's theme: CodeBlock reads useTheme() directly, so a two-pane split would paint one theme's colours on the other theme's ground. Toggle the page theme to see the other."
          >
            <div className="dsn-code">
              <CodeBlock
                code={
                  "export function tileClass(key: string | null): string {\n  let h = 0;\n  for (const ch of key ?? '') h = (h * 31 + ch.charCodeAt(0)) | 0;\n  return `tile-${Math.abs(h) % 8}`;\n}"
                }
                langHint="ts"
              />
            </div>
          </Group>

          <Group
            title="Inline"
            note="One badge everywhere it appears in chrome, sharing the keycap's 6px radius — both are glyph-scale marks set into a text line. Fenced code is .code-block and is untouched by it."
          >
            <p className="dsn-inline-code md">
              run <code>npx turnlog</code> or <code>tool:Bash</code>
            </p>
          </Group>

          <Group title="Unhighlighted" note="No language hint — plain mono, same block.">
            <div className="dsn-code">
              <CodeBlock code={'turnlog index\nindexed 1,284 sessions in 4.2s'} />
            </div>
          </Group>
        </Section>

        <Section
          id="dsn-keys"
          title="Keycaps"
          note="One keycap language everywhere — a grey cap with a pressed bottom edge. Styled off the bare kbd element, which is safe because session content never renders one: markdown emits none and raw HTML is disabled."
        >
          <Group
            title="Caps"
            note="Modifiers, letters, named keys and arrows all take the same cap. min-width keeps a single glyph from collapsing narrower than a word."
          >
            <div className="dsn-keys">
              {['⌘', '⇧', '⌥', '⌃', 'K', '/', 'esc', 'enter', '↑', '↓', '←', '→'].map((k) => (
                <kbd key={k}>{k}</kbd>
              ))}
            </div>
          </Group>

          <Group
            title="Combos"
            note="Rows use the same 3px gap in the shortcuts sheet, the command palette and tooltips."
          >
            <div className="dsn-key-rows">
              {[
                { label: 'Search', keys: ['⌘', 'K'] },
                { label: 'Find in session', keys: ['⌘', 'F'] },
                { label: 'Toggle theme', keys: ['T'] },
                { label: 'Close', keys: ['esc'] },
              ].map((c) => (
                <div key={c.label} className="dsn-key-row">
                  <span className="dsn-key-label">{c.label}</span>
                  <span className="shortcuts-combo">
                    {c.keys.map((k) => (
                      <kbd key={k}>{k}</kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </Group>

          <Group title="On a contrast pill" note="Inside a tooltip the cap inverts with the pill.">
            <div className="dsn-tips">
              <Tooltip content="Search" shortcut={['⌘', 'K']}>
                <button className="dsn-tip-trigger">hover for inverted caps</button>
              </Tooltip>
            </div>
          </Group>
        </Section>

        <Section
          id="dsn-tooltip"
          title="Tooltip"
          note="A contrast pill floated over its trigger, replacing the browser's native title. Hover or focus any trigger below."
        >
          <Group
            title="Variants"
            note="Label alone; label with a mono sub-line; label with keycaps. It flips below the trigger when there is no room above."
          >
            <div className="dsn-tips">
              <Tooltip content="Show sessions">
                <button className="dsn-tip-trigger">label</button>
              </Tooltip>
              <Tooltip
                content={
                  <>
                    <strong>turnlog index</strong>
                    <span>reads ~/.claude/projects</span>
                  </>
                }
              >
                <button className="dsn-tip-trigger">label + sub-line</button>
              </Tooltip>
              <Tooltip content="Find in session" shortcut={['⌘', 'F']}>
                <button className="dsn-tip-trigger">label + keycaps</button>
              </Tooltip>
            </div>
          </Group>
        </Section>

        <Section
          id="dsn-motion"
          title="Motion"
          note="Five durations, each with a job, and nothing in between them. Transform-only where possible, so nothing reflows."
        >
          <Group title="Durations">
            <div className="dsn-motion">
              {MOTION.map((m) => (
                <div key={m.d} className="dsn-motion-row">
                  <span className="dsn-motion-d">{m.d}</span>
                  <span className="dsn-motion-role">{m.role}</span>
                </div>
              ))}
            </div>
          </Group>
        </Section>

        <Section
          id="dsn-collisions"
          title="Collisions"
          note="One hue, several unrelated jobs. Each needs a decision — split the hue, or say why the overload is fine."
        >
          <div className="dsn-collisions">
            {COLLISIONS.map((c) => (
              <div key={c.hue} className="dsn-collision">
                <div className="dsn-collision-head">
                  <span
                    className="dsn-dot"
                    style={{ background: `var(${c.swatch})` }}
                    aria-hidden
                  />
                  <span className="dsn-collision-hue">{c.hue}</span>
                  <span className="dsn-collision-count">{c.jobs.length} jobs</span>
                </div>
                <ul className="dsn-jobs">
                  {c.jobs.map((j) => (
                    <li key={j}>{j}</li>
                  ))}
                </ul>
                {c.resolved && <p className="dsn-resolved">split off: {c.resolved}</p>}
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}
