import type { MessageRow } from '../types';

/**
 * Tolerant extraction from the verbatim JSONL record. The format is
 * undocumented and changes without notice — every accessor here must survive
 * any shape and fall back to the indexed plain text. Rendering fidelity may
 * degrade; rendering must never throw. (The UI-side half of the parser's
 * cardinal rule.)
 */

export interface ToolUseView {
  id: string | null;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultView {
  toolUseId: string | null;
  text: string;
  isError: boolean;
}

export interface RawView {
  textParts: string[];
  thinkingParts: string[];
  toolUses: ToolUseView[];
  toolResults: ToolResultView[];
}

const EMPTY: RawView = { textParts: [], thinkingParts: [], toolUses: [], toolResults: [] };

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function resultContentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        const p = asRecord(part);
        if (!p) return '';
        if (typeof p.text === 'string') return p.text;
        if (p.type === 'image') return '[image]';
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

const cache = new Map<string, RawView>();
const CACHE_MAX = 800;

export function parseRaw(row: MessageRow): RawView {
  const hit = cache.get(row.uuid);
  if (hit) return hit;

  let view = EMPTY;
  try {
    view = extract(JSON.parse(row.raw));
  } catch {
    /* unparseable raw → plain-text fallback via row.text */
  }
  if (view.textParts.length + view.thinkingParts.length + view.toolUses.length + view.toolResults.length === 0
      && row.text !== '') {
    view = { ...view, textParts: [row.text] };
  }

  if (cache.size >= CACHE_MAX) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  cache.set(row.uuid, view);
  return view;
}

function extract(record: unknown): RawView {
  const rec = asRecord(record);
  if (!rec) return EMPTY;
  const message = asRecord(rec.message);
  const content = message?.content ?? rec.content;

  const view: RawView = { textParts: [], thinkingParts: [], toolUses: [], toolResults: [] };

  if (typeof content === 'string') {
    view.textParts.push(content);
    return view;
  }
  if (!Array.isArray(content)) {
    if (typeof rec.summary === 'string') view.textParts.push(rec.summary);
    return view;
  }

  for (const raw of content) {
    const part = asRecord(raw);
    if (!part) continue;
    switch (part.type) {
      case 'text':
        if (typeof part.text === 'string') view.textParts.push(part.text);
        break;
      case 'thinking':
        if (typeof part.thinking === 'string') view.thinkingParts.push(part.thinking);
        break;
      case 'tool_use':
        view.toolUses.push({
          id: typeof part.id === 'string' ? part.id : null,
          name: typeof part.name === 'string' ? part.name : 'tool',
          input: asRecord(part.input) ?? {},
        });
        break;
      case 'tool_result':
        view.toolResults.push({
          toolUseId: typeof part.tool_use_id === 'string' ? part.tool_use_id : null,
          text: resultContentToText(part.content),
          isError: part.is_error === true,
        });
        break;
      default:
        if (typeof part.text === 'string') view.textParts.push(part.text);
    }
  }
  return view;
}

/** Pretty raw JSON for "view raw" panes; falls back to the raw string. */
export function prettyRaw(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
