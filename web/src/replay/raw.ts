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

/** A base64 image carried inline by the log — a pasted screenshot, or one a
 *  tool returned. `src` is a data: URI; nothing is ever fetched. */
export interface ImageView {
  src: string;
  /** Decoded size, for the label — base64 is 4 chars per 3 bytes. */
  bytes: number;
}

export interface ToolResultView {
  toolUseId: string | null;
  text: string;
  isError: boolean;
  images: ImageView[];
}

export interface RawView {
  textParts: string[];
  thinkingParts: string[];
  toolUses: ToolUseView[];
  toolResults: ToolResultView[];
  images: ImageView[];
}

const EMPTY: RawView = {
  textParts: [],
  thinkingParts: [],
  toolUses: [],
  toolResults: [],
  images: [],
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/* ── inline images ───────────────────────────────────────────────────────
   Two shapes appear on real logs, both base64: the API's
   `source: {media_type, data}` (pasted images and tool screenshots alike)
   and a `file: {base64}` variant. A declared media type is only trusted
   when it is an image/* one — logs are untrusted input, and an <img> whose
   src claims another type is a footgun with no upside. Otherwise the type
   is sniffed from the payload's own magic prefix. */

const MAGIC: ReadonlyArray<readonly [string, string]> = [
  ['iVBORw0KGgo', 'image/png'],
  ['/9j/', 'image/jpeg'],
  ['R0lGOD', 'image/gif'],
  ['UklGR', 'image/webp'],
  ['Qk', 'image/bmp'],
  ['PHN2Zw', 'image/svg+xml'],
];

/** A 12 MB payload is already absurd for a screenshot; past that, skip it
 *  rather than hand the browser something that will stall the scroller. */
const MAX_B64 = 16_000_000;

function mediaTypeFor(declared: unknown, data: string): string | null {
  if (typeof declared === 'string' && /^image\/[\w.+-]+$/.test(declared)) return declared;
  for (const [prefix, type] of MAGIC) {
    if (data.startsWith(prefix)) return type;
  }
  return null;
}

function toImage(part: Record<string, unknown>): ImageView | null {
  const source = asRecord(part.source);
  const file = asRecord(part.file);
  const data = typeof source?.data === 'string' ? source.data : typeof file?.base64 === 'string' ? file.base64 : null;
  if (data === null || data === '' || data.length > MAX_B64) return null;
  const mediaType = mediaTypeFor(source?.media_type ?? file?.media_type, data);
  if (mediaType === null) return null;
  return { src: `data:${mediaType};base64,${data}`, bytes: Math.floor((data.length * 3) / 4) };
}

/** Text of a tool result, with any inline images pulled out to be rendered
 *  rather than announced as "[image]". */
function resultContent(content: unknown): { text: string; images: ImageView[] } {
  if (typeof content === 'string') return { text: content, images: [] };
  if (!Array.isArray(content)) return { text: '', images: [] };
  const texts: string[] = [];
  const images: ImageView[] = [];
  for (const part of content) {
    const p = asRecord(part);
    if (!p) continue;
    if (typeof p.text === 'string') {
      texts.push(p.text);
    } else if (p.type === 'image') {
      const image = toImage(p);
      if (image) images.push(image);
      else texts.push('[image]'); // unreadable payload — say so, never drop
    }
  }
  return { text: texts.filter(Boolean).join('\n'), images };
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
  if (view.textParts.length + view.thinkingParts.length + view.toolUses.length
      + view.toolResults.length + view.images.length === 0
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

  const view: RawView = {
    textParts: [],
    thinkingParts: [],
    toolUses: [],
    toolResults: [],
    images: [],
  };

  if (typeof content === 'string') {
    view.textParts.push(content);
    return view;
  }
  if (!Array.isArray(content)) {
    if (typeof rec.summary === 'string') view.textParts.push(rec.summary);
    // An attachment's prompt can carry pasted images too.
    const prompt = asRecord(rec.attachment)?.prompt;
    if (Array.isArray(prompt)) {
      for (const part of prompt) {
        const p = asRecord(part);
        if (p?.type !== 'image') continue;
        const image = toImage(p);
        if (image) view.images.push(image);
      }
    }
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
      case 'tool_result': {
        const { text, images } = resultContent(part.content);
        view.toolResults.push({
          toolUseId: typeof part.tool_use_id === 'string' ? part.tool_use_id : null,
          text,
          isError: part.is_error === true,
          images,
        });
        break;
      }
      case 'image': {
        // A screenshot pasted into the conversation.
        const image = toImage(part);
        if (image) view.images.push(image);
        break;
      }
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
