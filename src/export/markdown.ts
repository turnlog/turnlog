import type { MessageRow, SessionMeta } from '../server/apiTypes.js';

/**
 * Markdown serializer over the normalized model (deep-dive §2.5): prompts as
 * blockquotes, assistant prose verbatim, tool calls as <details> blocks,
 * Edit/Write as fenced ```diff. The output pastes cleanly into GitHub, Slack,
 * and gists — clipboard is how the tool spreads. Kept dependency-free: a
 * minimal ±line diff rather than pulling a diff library into the server.
 */

export interface ExportOptions {
  /** Append the "Exported with Turnlog" footer (default true, removable in settings). */
  attribution?: boolean;
}

/** Cap enormous tool results / file writes so the markdown stays shareable. */
const MAX_BLOCK_CHARS = 8000;

interface RawView {
  text: string[];
  thinking: string[];
  toolUses: { id: string | null; name: string; input: Record<string, unknown> }[];
  toolResults: { toolUseId: string | null; text: string; isError: boolean }[];
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => {
        const r = asRecord(p);
        if (!r) return '';
        if (typeof r.text === 'string') return r.text;
        if (r.type === 'image') return '[image]';
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

/** Tolerant extraction from the verbatim JSONL line — never throws. */
function parseRaw(raw: string): RawView {
  const view: RawView = { text: [], thinking: [], toolUses: [], toolResults: [] };
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return view;
  }
  const rec = asRecord(obj);
  if (!rec) return view;
  const message = asRecord(rec.message);
  const content = message?.content ?? rec.content;

  if (typeof content === 'string') {
    view.text.push(content);
    return view;
  }
  if (!Array.isArray(content)) return view;

  for (const raw2 of content) {
    const part = asRecord(raw2);
    if (!part) continue;
    switch (part.type) {
      case 'text':
        if (typeof part.text === 'string') view.text.push(part.text);
        break;
      case 'thinking':
        if (typeof part.thinking === 'string') view.thinking.push(part.thinking);
        break;
      case 'tool_use':
        view.toolUses.push({
          id: str(part.id),
          name: str(part.name) ?? 'tool',
          input: asRecord(part.input) ?? {},
        });
        break;
      case 'tool_result':
        view.toolResults.push({
          toolUseId: str(part.tool_use_id),
          text: resultText(part.content),
          isError: part.is_error === true,
        });
        break;
      default:
        if (typeof part.text === 'string') view.text.push(part.text);
    }
  }
  return view;
}

function truncate(s: string): string {
  if (s.length <= MAX_BLOCK_CHARS) return s;
  return `${s.slice(0, MAX_BLOCK_CHARS)}\n… (${s.length - MAX_BLOCK_CHARS} more characters truncated)`;
}

function fence(body: string, lang = ''): string {
  // A body containing ``` would break the fence — bump to a longer fence.
  const ticks = body.includes('```') ? '````' : '```';
  return `${ticks}${lang}\n${truncate(body)}\n${ticks}`;
}

function blockquote(text: string): string {
  return text
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n');
}

function shortPath(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.length <= 3 ? p : `…/${parts.slice(-3).join('/')}`;
}

const LANG_BY_EXT: Record<string, string> = {
  ts: 'ts', tsx: 'tsx', js: 'js', jsx: 'jsx', py: 'python', go: 'go', rs: 'rust',
  json: 'json', sh: 'bash', bash: 'bash', md: 'markdown', css: 'css', html: 'html',
  sql: 'sql', yml: 'yaml', yaml: 'yaml',
};
function langFor(path: string | null): string {
  if (!path) return '';
  const dot = path.lastIndexOf('.');
  return dot === -1 ? '' : (LANG_BY_EXT[path.slice(dot + 1).toLowerCase()] ?? '');
}

/** Minimal unified diff: old lines as `-`, new lines as `+`. Dependency-free. */
function editDiff(oldStr: string, newStr: string): string {
  const minus = oldStr.split('\n').map((l) => `- ${l}`);
  const plus = newStr.split('\n').map((l) => `+ ${l}`);
  return fence([...minus, ...plus].join('\n'), 'diff');
}

function toolBody(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'Bash': {
      const cmd = str(input.command);
      return cmd ? fence(cmd, 'bash') : '';
    }
    case 'Edit': {
      const o = str(input.old_string);
      const nw = str(input.new_string);
      return o !== null && nw !== null ? editDiff(o, nw) : '';
    }
    case 'MultiEdit': {
      if (!Array.isArray(input.edits)) return '';
      return input.edits
        .map((e) => {
          const edit = asRecord(e);
          const o = str(edit?.old_string);
          const nw = str(edit?.new_string);
          return o !== null && nw !== null ? editDiff(o, nw) : '';
        })
        .filter(Boolean)
        .join('\n\n');
    }
    case 'Write': {
      const content = str(input.content);
      return content !== null ? fence(content, langFor(str(input.file_path))) : '';
    }
    case 'Read':
      return '';
    case 'Grep':
    case 'Glob':
      return str(input.pattern) ? `Pattern: \`${str(input.pattern)}\`` : '';
    case 'Task':
      return str(input.prompt) ? blockquote(str(input.prompt)!) : '';
    default: {
      const json = JSON.stringify(input, null, 2);
      return json === '{}' ? '' : fence(json, 'json');
    }
  }
}

function toolSummary(name: string, input: Record<string, unknown>): string {
  const p = str(input.file_path) ?? str(input.notebook_path);
  if (p) return `${name} · ${shortPath(p)}`;
  const d = str(input.description) ?? str(input.pattern) ?? str(input.command)?.split('\n')[0];
  return d ? `${name} · ${d}` : name;
}

function fmtCost(v: number | null): string {
  if (v === null) return '—';
  if (v === 0) return '$0';
  if (v < 0.01) return '<$0.01';
  return `$${v.toFixed(2)}`;
}

export function sessionToMarkdown(
  session: SessionMeta,
  rows: MessageRow[],
  opts: ExportOptions = {},
): string {
  const out: string[] = [];
  const project = session.projectPath
    ? session.projectPath.split(/[\\/]/).filter(Boolean).pop()
    : (session.projectKey ?? 'session');
  const model = session.model ? ` · ${session.model.replace(/^claude-/, '').replace(/-\d{8}$/, '')}` : '';

  out.push(`# ${project} — Claude Code session`);
  out.push(
    `*${session.startedAt ?? 'unknown date'}${model} · ${session.turnCount} turns · ${fmtCost(session.costUsd)} est.*`,
  );
  out.push('');

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

  for (const row of rows) {
    if (row.isSidechain) continue; // subagent turns are noise in an export
    switch (row.kind) {
      case 'prompt': {
        const cmd = COMMAND_RE.exec(row.text)?.[1]?.trim();
        out.push(blockquote(`**You:** ${cmd ? `\`${cmd}\`` : row.text}`));
        out.push('');
        break;
      }
      case 'tool_result':
        break; // folded under its tool_use
      case 'summary':
        if (row.text) out.push(`*Summary: ${row.text}*`, '');
        break;
      case 'system':
      case 'unknown':
        break; // omitted from prose export
      default: {
        // assistant / tool_use — may carry prose, thinking, and tool calls.
        const view = parseRaw(row.raw);
        const prose = view.text.join('\n\n').trim();
        if (prose) out.push(prose, '');
        for (const think of view.thinking) {
          if (!think.trim()) continue;
          out.push('<details><summary>Thinking</summary>', '', blockquote(think), '', '</details>', '');
        }
        for (const use of view.toolUses) {
          const body = toolBody(use.name, use.input);
          const result = use.id ? resultByUseId.get(use.id) : undefined;
          out.push(`<details><summary>${toolSummary(use.name, use.input)}</summary>`, '');
          if (body) out.push(body, '');
          if (result && result.text.trim()) {
            out.push(result.isError ? '**Result (error):**' : '**Result:**', '', fence(result.text), '');
          }
          out.push('</details>', '');
        }
      }
    }
  }

  if (opts.attribution !== false) {
    out.push('---');
    out.push(
      '*Exported with [Turnlog](https://turnlog.dev) — search & replay for Claude Code.*',
    );
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
