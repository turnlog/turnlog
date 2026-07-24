import path from 'node:path';
import type Database from 'better-sqlite3';
import { searchMessages } from '../server/api.js';
import { SNIPPET_CLOSE, SNIPPET_OPEN } from '../server/apiTypes.js';
import type { SessionMeta } from '../server/apiTypes.js';

/**
 * `turnlog search <q>` — the index from the terminal. Same query language as
 * the UI (text + operators); hits grouped by session. When the local server
 * is running, each group carries a deep link that opens the UI at the first
 * match; resolving that URL is the caller's job (this module stays pure so
 * tests can assert on output).
 */

export interface SearchCliOptions {
  limit?: number;
  /** ANSI styling (TTY). Off = plain text with «match» markers. */
  color?: boolean;
  /** Print the raw SearchResponse as JSON instead of formatted text. */
  json?: boolean;
  /** The running server's tokened URL, when one was found. */
  serverUrl?: string | null;
}

const MARK_RE = new RegExp(`${SNIPPET_OPEN}(.*?)${SNIPPET_CLOSE}`, 'g');
/** Truncation can orphan a marker char; strip any survivor. */
const STRAY_MARK_RE = new RegExp(`[${SNIPPET_OPEN}${SNIPPET_CLOSE}]`, 'g');
const SNIPPET_MAX = 160;

function sessionLabel(s: SessionMeta): string {
  if (s.customName) return s.customName;
  const p = s.projectPath ?? s.projectKey;
  return p ? path.basename(p) : s.id.slice(0, 8);
}

export function renderSearch(
  db: Database.Database,
  query: string,
  opts: SearchCliOptions = {},
): string {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 500);
  const res = searchMessages(db, { query, limit });
  if (opts.json) return `${JSON.stringify(res, null, 2)}\n`;

  const bold = (t: string) => (opts.color ? `\x1b[1m${t}\x1b[0m` : t);
  const dim = (t: string) => (opts.color ? `\x1b[2m${t}\x1b[0m` : t);
  const mark = (t: string) => (opts.color ? `\x1b[1;4m${t}\x1b[0m` : `«${t}»`);

  if (res.totalHits === 0) {
    return 'no matches\n';
  }

  const out: string[] = [];
  for (const g of res.groups) {
    const s = g.session;
    const date = s.startedAt ? s.startedAt.slice(0, 10) : '';
    out.push(
      `${bold(sessionLabel(s))} ${dim(
        `${s.id.slice(0, 8)} · ${date} · ${g.hits.length} hit${g.hits.length === 1 ? '' : 's'}`,
      )}`,
    );
    for (const h of g.hits) {
      const label = (h.toolName ?? h.kind).padEnd(12);
      const snippet = h.snippet
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, SNIPPET_MAX)
        .replace(MARK_RE, (_, m: string) => mark(m))
        .replace(STRAY_MARK_RE, '');
      out.push(`  ${dim(`[${String(h.idx).padStart(4)}]`)} ${dim(label)} ${snippet}`);
    }
    if (opts.serverUrl) {
      out.push(
        `  ${dim('↗')} ${opts.serverUrl}#/session/${encodeURIComponent(s.id)}?m=${
          g.hits[0]!.idx
        }&q=${encodeURIComponent(query)}`,
      );
    }
    out.push('');
  }

  const agg = res.aggregates;
  const cost =
    agg && agg.matchedSessions > 0 ? ` · this work cost ~$${agg.totalCostUsd.toFixed(2)} est.` : '';
  out.push(
    dim(
      `${res.totalHits} hit${res.totalHits === 1 ? '' : 's'} in ${res.groups.length} session${
        res.groups.length === 1 ? '' : 's'
      }${cost}`,
    ),
  );
  if (!opts.serverUrl) {
    out.push(dim('run `turnlog` to open results in the UI'));
  }
  return `${out.join('\n')}\n`;
}
