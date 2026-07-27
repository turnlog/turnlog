import type { MessageRow, SessionMeta } from '../server/apiTypes.js';
import { parseRaw, toolSummary, truncate, type ExportOptions } from './markdown.js';
import { redactText } from './redact.js';

/**
 * The markdown export's pretty sibling: one self-contained, styled HTML file
 * per session. Everything is inline — CSS carries the app's design tokens
 * (dark by default, light via prefers-color-scheme), fonts fall back to
 * system stacks, and nothing ever loads from the network. Session logs are
 * untrusted input: every piece of content is escaped, and redaction (when
 * asked for) runs on the content before it is wrapped in markup.
 */

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function fmtCost(v: number | null): string {
  if (v === null) return '—';
  if (v === 0) return '$0';
  if (v < 0.01) return '<$0.01';
  return `$${v.toFixed(2)}`;
}

function fmtDuration(startIso: string | null, endIso: string | null): string {
  if (!startIso || !endIso) return '—';
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

type Red = (s: string) => string;

/** Assistant prose: fenced code blocks become <pre>, the rest stays prose. */
function proseHtml(text: string, red: Red): string {
  const fenceRe = /```[A-Za-z0-9+-]*\n?([\s\S]*?)```/g;
  const out: string[] = [];
  let last = 0;
  for (let m = fenceRe.exec(text); m !== null; m = fenceRe.exec(text)) {
    const before = text.slice(last, m.index).trim();
    if (before) out.push(`<div class="prose">${esc(red(before))}</div>`);
    if (m[1]!.trim()) out.push(`<pre class="code">${esc(red(truncate(m[1]!)))}</pre>`);
    last = m.index + m[0].length;
  }
  const rest = text.slice(last).trim();
  if (rest) out.push(`<div class="prose">${esc(red(rest))}</div>`);
  return out.join('\n');
}

function diffHtml(oldStr: string, newStr: string, red: Red): string {
  const del = truncate(oldStr)
    .split('\n')
    .map((l) => `<span class="dl dl-del">- ${esc(red(l))}</span>`);
  const add = truncate(newStr)
    .split('\n')
    .map((l) => `<span class="dl dl-add">+ ${esc(red(l))}</span>`);
  return `<pre class="code diff">${[...del, ...add].join('\n')}</pre>`;
}

function toolBodyHtml(name: string, input: Record<string, unknown>, red: Red): string {
  switch (name) {
    case 'Bash': {
      const cmd = str(input.command);
      return cmd ? `<pre class="code">${esc(red(truncate(cmd)))}</pre>` : '';
    }
    case 'Edit': {
      const o = str(input.old_string);
      const nw = str(input.new_string);
      return o !== null && nw !== null ? diffHtml(o, nw, red) : '';
    }
    case 'MultiEdit': {
      if (!Array.isArray(input.edits)) return '';
      return input.edits
        .map((e) => {
          const edit = e as { old_string?: unknown; new_string?: unknown } | null;
          const o = str(edit?.old_string);
          const nw = str(edit?.new_string);
          return o !== null && nw !== null ? diffHtml(o, nw, red) : '';
        })
        .filter(Boolean)
        .join('\n');
    }
    case 'Write': {
      const content = str(input.content);
      return content === null ? '' : `<pre class="code">${esc(red(truncate(content)))}</pre>`;
    }
    case 'Read':
      return '';
    case 'Grep':
    case 'Glob': {
      const p = str(input.pattern);
      return p ? `<div class="note">Pattern: <code>${esc(red(p))}</code></div>` : '';
    }
    case 'Task': {
      const p = str(input.prompt);
      return p ? `<blockquote class="task">${esc(red(truncate(p)))}</blockquote>` : '';
    }
    default: {
      const json = JSON.stringify(input, null, 2);
      return json === '{}' ? '' : `<pre class="code">${esc(red(truncate(json)))}</pre>`;
    }
  }
}

/** The design tokens the app uses, inlined — dark default, light on request. */
const STYLE = `
:root{color-scheme:dark;--bg0:#0f1115;--card:#181b21;--bg1:#1e222a;--bg2:#262b34;
--tx0:#eceef2;--tx1:#9aa1ad;--tx2:#626977;--accent:#f0663f;--blue:#6b93f7;
--c-error:#f0663f;--c-ok:#8fe0a8;
--diff-add-bg:rgba(143,224,168,.13);--diff-add-tx:#a5e6ba;
--diff-del-bg:rgba(240,102,63,.12);--diff-del-tx:#f2a48c}
@media (prefers-color-scheme: light){:root{color-scheme:light;--bg0:#edeff3;--card:#ffffff;
--bg1:#f4f5f8;--bg2:#e9ebf0;--tx0:#16181d;--tx1:#5f6572;--tx2:#9aa0ab;--accent:#e8542f;
--blue:#3e6df5;--c-error:#d9432a;--c-ok:#4cba74;
--diff-add-bg:rgba(76,186,116,.12);--diff-add-tx:#23744a;
--diff-del-bg:rgba(217,67,42,.1);--diff-del-tx:#b23a20}}
*{box-sizing:border-box}
body{margin:0;padding:36px 16px;background:var(--bg0);color:var(--tx0);
font:14px/1.55 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
-webkit-font-smoothing:antialiased}
main{max-width:860px;margin:0 auto;display:flex;flex-direction:column;gap:14px}
code,pre{font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace}
.head{background:var(--card);border-radius:24px;padding:26px 30px}
.head h1{margin:0 0 6px;font-size:24px;letter-spacing:-.015em}
.head .meta{margin:0;color:var(--tx1);font-size:13.5px}
.turn{background:var(--card);border-radius:24px;padding:20px 26px}
.label{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;
color:var(--tx2);margin-bottom:8px}
.you .label{color:var(--tx0)}
.claude .label{color:var(--blue)}
.prose{white-space:pre-wrap;overflow-wrap:anywhere}
.prose+.prose,.prose+pre,pre+.prose{margin-top:10px}
.chip{display:inline-block;background:var(--tx0);color:var(--bg0);border-radius:999px;
padding:3px 12px;font-size:12px;font-family:ui-monospace,Menlo,monospace}
pre.code{background:var(--bg1);border-radius:10px;padding:12px 14px;margin:10px 0 0;
font-size:12.5px;line-height:1.5;overflow-x:auto}
.dl{display:block}
.dl-add{background:var(--diff-add-bg);color:var(--diff-add-tx)}
.dl-del{background:var(--diff-del-bg);color:var(--diff-del-tx)}
details{background:var(--bg1);border-radius:10px;padding:9px 14px;margin-top:10px}
details summary{cursor:pointer;color:var(--tx1);font-size:13px;user-select:none}
details summary:hover{color:var(--tx0)}
details[open]>summary{margin-bottom:8px}
.tdot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--tx2);
margin-right:8px;vertical-align:1px}
.tdot.err{background:var(--c-error)}
.result-label{font-size:11px;letter-spacing:.06em;text-transform:uppercase;
color:var(--tx2);margin-top:10px}
.result-label.err{color:var(--c-error)}
blockquote.task{margin:10px 0 0;padding:2px 0 2px 14px;border-left:3px solid var(--bg2);
color:var(--tx1);white-space:pre-wrap;overflow-wrap:anywhere}
.summary-row{color:var(--tx1);font-style:italic;padding:0 26px}
footer{color:var(--tx2);font-size:12.5px;text-align:center;padding:10px 0 20px}
footer a{color:var(--tx1)}
`;

export function sessionToHtml(
  session: SessionMeta,
  rows: MessageRow[],
  opts: ExportOptions = {},
): string {
  const red: Red = opts.redact ? redactText : (s) => s;
  const project = session.projectPath
    ? (session.projectPath.split(/[\\/]/).filter(Boolean).pop() ?? 'session')
    : (session.projectKey ?? 'session');
  const model = session.model
    ? session.model.replace(/^claude-/, '').replace(/-\d{8}$/, '')
    : null;
  const date = session.startedAt ? session.startedAt.slice(0, 10) : 'unknown date';
  // The session's name leads when one exists (user's custom name, else CC's
  // own title); the project then moves down into the meta line.
  const title = session.customName ?? session.aiTitle;
  const meta = [
    date,
    title ? project : null,
    model,
    `${session.turnCount} turns`,
    opts.excerpt ? 'excerpt' : null,
    fmtDuration(session.startedAt, session.endedAt),
    `${fmtCost(session.costUsd)} est.`,
  ]
    .filter(Boolean)
    .join(' · ');

  // Pair tool_result rows to their tool_use by id, so results fold under calls.
  const resultByUseId = new Map<string, { text: string; isError: boolean }>();
  for (const r of rows) {
    if (r.kind !== 'tool_result') continue;
    const view = parseRaw(r.raw);
    const res = view.toolResults[0];
    const id = res?.toolUseId ?? r.toolUseId;
    if (id) resultByUseId.set(id, { text: res?.text ?? r.text, isError: res?.isError ?? r.isError });
  }

  const COMMAND_RE = /<command-name>([^<]*)<\/command-name>/;
  const body: string[] = [];

  // Group everything between two prompts into one "claude" card — CC writes
  // one line per content block, and a label per line would be noise.
  let claude: string[] = [];
  const flush = () => {
    if (claude.length === 0) return;
    body.push(`<section class="turn claude"><div class="label">claude</div>${claude.join('\n')}</section>`);
    claude = [];
  };

  for (const row of rows) {
    if (row.isSidechain) continue; // subagent turns are noise in an export
    switch (row.kind) {
      case 'prompt': {
        flush();
        const cmd = COMMAND_RE.exec(row.text)?.[1]?.trim();
        const content = cmd
          ? `<span class="chip">${esc(cmd)}</span>`
          : `<div class="prose">${esc(red(row.text))}</div>`;
        body.push(`<section class="turn you"><div class="label">you</div>${content}</section>`);
        break;
      }
      case 'tool_result':
        break; // folded under its tool_use
      case 'summary':
        flush();
        if (row.text) body.push(`<div class="summary-row">Summary: ${esc(red(row.text))}</div>`);
        break;
      case 'system':
      case 'meta':
      case 'title':
      case 'attachment':
      case 'mode':
      case 'unknown':
        break; // omitted from prose export
      default: {
        const view = parseRaw(row.raw);
        const prose = view.text.join('\n\n').trim();
        if (prose) claude.push(proseHtml(prose, red));
        for (const think of view.thinking) {
          if (!think.trim()) continue;
          claude.push(
            `<details><summary>thinking</summary><div class="prose">${esc(red(truncate(think)))}</div></details>`,
          );
        }
        for (const use of view.toolUses) {
          const toolBody = toolBodyHtml(use.name, use.input, red);
          const result = use.id ? resultByUseId.get(use.id) : undefined;
          const parts: string[] = [
            `<details><summary><span class="tdot ${result?.isError ? 'err' : ''}"></span>${esc(red(toolSummary(use.name, use.input)))}</summary>`,
          ];
          if (toolBody) parts.push(toolBody);
          if (result && result.text.trim()) {
            parts.push(
              `<div class="result-label ${result.isError ? 'err' : ''}">${result.isError ? 'result · error' : 'result'}</div>`,
              `<pre class="code">${esc(red(truncate(result.text)))}</pre>`,
            );
          }
          parts.push('</details>');
          claude.push(parts.join('\n'));
        }
      }
    }
  }
  flush();

  const footer =
    opts.attribution !== false
      ? `<footer>Exported with <a href="https://turnlog.dev">Turnlog</a> — search &amp; replay for Claude Code.</footer>`
      : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(red(title ?? project))} — Claude Code session</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<header class="head">
<h1>${esc(red(title ?? project))}</h1>
<p class="meta">${esc(meta)}</p>
</header>
${body.join('\n')}
${footer}
</main>
</body>
</html>
`;
}
