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
  /**
   * The call's own body when it is free-form rather than key/value — Codex's
   * `exec` carries a snippet of JavaScript, not arguments. Rendered as code;
   * `input` stays the structured half.
   */
  body?: string;
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

/** A fresh, empty view — never the shared EMPTY, which callers mutate. */
function newView(): RawView {
  return { textParts: [], thinkingParts: [], toolUses: [], toolResults: [], images: [] };
}

/** Parse a JSON string into an object, or null. Tool arguments arrive as
 *  strings from every agent that is not Claude Code. */
function parseObject(v: unknown): Record<string, unknown> | null {
  if (typeof v !== 'string' || v.trim() === '') return null;
  try {
    const parsed = JSON.parse(v);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Which agent wrote this record, from the record's own shape.
 *
 * The same posture the server-side parser takes (RawLine → VersionSniffer →
 * Adapter), and more robust than threading the session's agent down through
 * the component tree: a record renders correctly wherever it is shown. An
 * unrecognized shape falls through to the Claude Code reader, which itself
 * degrades to the indexed plain text — the cardinal rule, on the UI side.
 */
function extract(record: unknown): RawView {
  const rec = asRecord(record);
  if (!rec) return EMPTY;
  if (rec.source === 'cursor-ide') return extractCursorIde(rec);
  if (asRecord(rec.payload) !== null && typeof rec.type === 'string') return extractCodex(rec);
  // Claude Code — and Cursor CLI, whose transcripts are the same shape.
  return extractClaude(rec);
}

/**
 * Codex rollout records: `{timestamp, type, payload}`. Reasoning becomes a
 * thinking block, tool calls carry their arguments, outputs pair back by
 * call_id — the same structure the replay already draws for Claude Code.
 */
function extractCodex(rec: Record<string, unknown>): RawView {
  const view = newView();
  const payload = asRecord(rec.payload);
  if (!payload) return view;
  const type = payload.type;

  switch (type) {
    case 'agent_message':
    case 'user_message': {
      const text = payload.message ?? payload.text;
      if (typeof text === 'string' && text !== '') view.textParts.push(text);
      return view;
    }
    case 'reasoning': {
      // summary is a list of {text} blocks; often empty, since Codex only
      // records a summary when the model produced one.
      const summary = Array.isArray(payload.summary) ? payload.summary : [];
      for (const part of summary) {
        const text = asRecord(part)?.text;
        if (typeof text === 'string' && text !== '') view.thinkingParts.push(text);
      }
      return view;
    }
    case 'custom_tool_call':
    case 'function_call':
    case 'local_shell_call': {
      const raw = payload.input ?? payload.arguments;
      const structured = parseObject(raw);
      view.toolUses.push({
        id: typeof payload.call_id === 'string' ? payload.call_id : null,
        name: typeof payload.name === 'string' ? payload.name : String(type),
        input: structured ?? {},
        // exec calls carry JavaScript, not arguments — keep it as code.
        ...(structured === null && typeof raw === 'string' && raw !== ''
          ? { body: raw }
          : {}),
      });
      return view;
    }
    case 'custom_tool_call_output':
    case 'function_call_output': {
      const output = payload.output;
      // Three shapes on real rollouts: a plain string, a list of
      // {type:'input_text', text} blocks (the common one), or an object.
      let text = '';
      if (typeof output === 'string') {
        text = output;
      } else if (Array.isArray(output)) {
        text = output
          .map((b) => {
            const part = asRecord(b);
            return typeof part?.text === 'string' ? part.text : '';
          })
          .filter(Boolean)
          .join('\n');
      } else {
        const out = asRecord(output);
        const inner = out?.output ?? out?.content;
        if (typeof inner === 'string') text = inner;
      }
      view.toolResults.push({
        toolUseId: typeof payload.call_id === 'string' ? payload.call_id : null,
        text,
        isError: asRecord(output)?.success === false,
        images: [],
      });
      return view;
    }
    default:
      return view; // token_count, session_meta, world_state — nothing to draw
  }
}

/**
 * Cursor IDE envelopes, built by the extractor that reads the IDE's own
 * database: `{source, t, data}`. A `bubble` is one message; its
 * `toolFormerData` is the call, split out as a `bubble_result` for pairing.
 */
function extractCursorIde(rec: Record<string, unknown>): RawView {
  const view = newView();
  const data = asRecord(rec.data);
  if (!data) return view;

  if (rec.t === 'bubble_result') {
    const tf = asRecord(data.toolFormerData) ?? {};
    const status = tf.status;
    view.toolResults.push({
      toolUseId: typeof tf.toolCallId === 'string' ? tf.toolCallId : null,
      text: typeof tf.result === 'string' ? tf.result : '',
      isError: typeof status === 'string' && /error|fail/i.test(status),
      images: [],
    });
    return view;
  }

  const tf = asRecord(data.toolFormerData);
  if (tf) {
    // rawArgs is what the model actually sent; params is Cursor's expanded
    // form. Prefer the former, fall back to the latter.
    const input = parseObject(tf.rawArgs) ?? parseObject(tf.params);
    view.toolUses.push({
      id: typeof tf.toolCallId === 'string' ? tf.toolCallId : null,
      name: typeof tf.name === 'string' ? tf.name : 'tool',
      input: input ?? {},
    });
    return view;
  }

  if (typeof data.text === 'string' && data.text !== '') view.textParts.push(data.text);
  const thinking = asRecord(data.thinking)?.text ?? data.thinking;
  if (typeof thinking === 'string' && thinking !== '') view.thinkingParts.push(thinking);
  const blocks = Array.isArray(data.allThinkingBlocks) ? data.allThinkingBlocks : [];
  for (const b of blocks) {
    const text = asRecord(b)?.text;
    if (typeof text === 'string' && text !== '') view.thinkingParts.push(text);
  }
  // Pasted images live on the bubble itself.
  const images = Array.isArray(data.images) ? data.images : [];
  for (const img of images) {
    const part = asRecord(img);
    if (!part) continue;
    const image = toImage(part);
    if (image) view.images.push(image);
  }
  return view;
}

function extractClaude(rec: Record<string, unknown>): RawView {
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
