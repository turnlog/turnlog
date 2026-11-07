import { memo, useContext, useMemo, useState } from 'react';
import { mediaUrl, useChildRows } from '../api';
import { AgentLabelContext, SessionIdContext } from './agentContext';
import CodeBlock from '../code/CodeBlock';
import { langFromPath } from '../code/highlighter';
import Badge from '../components/Badge';
import { MediaStrip, type MediaItem } from '../components/Media';
import { SkeletonLines } from '../components/Skeleton';
import Tooltip from '../components/Tooltip';
import { fmtCount, fmtTime, mcpName } from '../format';
import { BookmarkFilledIcon, BookmarkIcon, CheckIcon, CopyIcon } from '../icons';
import Markdown from '../md/Markdown';
import type { ChildSessionSummary, MessageRow } from '../types';
import { BookmarkContext, type BookmarkState } from './bookmarkContext';
import { ChildSessionsContext, matchChildSession } from './childSessions';
import { EditDiff, WriteDiff } from './DiffView';
import {
  parseRaw,
  prettyRaw,
  type ImageView,
  type MediaRef,
  type ToolResultView,
} from './raw';
import {
  ATTACH_LABEL,
  SUBAGENT_TOOLS,
  buildChildBlocks,
  recordShape,
  type Block,
} from './thread';

/* ── shared bits ─────────────────────────────────────────────────────── */

function Caret({ open }: { open: boolean }) {
  return <span className={`caret ${open ? 'open' : ''}`}>▸</span>;
}

function Ts({ iso }: { iso: string | null }) {
  const t = fmtTime(iso);
  return t ? <span className="block-ts">{t}</span> : null;
}

const CLAMP_CHARS = 2400;

function ClampedText({ text, mono = true }: { text: string; mono?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const over = text.length > CLAMP_CHARS;
  const shown = expanded || !over ? text : text.slice(0, CLAMP_CHARS);
  return (
    <div className="clamped">
      <pre className={mono ? '' : 'sans'}>{shown}</pre>
      {over && (
        <button className="clamp-toggle" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'collapse' : `show all (${Math.round(text.length / 1024)} KB)`}
        </button>
      )}
    </div>
  );
}

/**
 * Everything a row can show as media: images the log carried inline (decoded
 * as data: URIs — nothing fetched) and files it names by path, which the
 * guarded media route serves against this exact message.
 */
const NO_IMAGES: ImageView[] = [];
const NO_REFS: MediaRef[] = [];

function useMediaItems(
  row: MessageRow | null,
  images: ImageView[],
  refs: MediaRef[],
  label: string,
): MediaItem[] {
  const sessionId = useContext(SessionIdContext);
  return useMemo(() => {
    const items: MediaItem[] = images.map((img, i) => ({
      src: img.src,
      kind: 'image',
      name: images.length > 1 ? `${label} ${i + 1}` : label,
      bytes: img.bytes,
      explicit: true,
    }));
    if (row && sessionId) {
      for (const ref of refs) {
        items.push({
          src: mediaUrl(sessionId, row.idx, ref.ref),
          kind: ref.kind,
          name: ref.ref,
          explicit: ref.explicit,
        });
      }
    }
    return items;
  }, [row, sessionId, images, refs, label]);
}

function RawDetails({ raw }: { raw: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="raw-details">
      <button className="raw-toggle" onClick={() => setOpen(!open)}>
        {open ? 'hide raw' : 'view raw'}
      </button>
      {open && <ClampedText text={prettyRaw(raw)} />}
    </div>
  );
}

/* ── prompt ──────────────────────────────────────────────────────────── */

const COMMAND_RE = /<command-name>([^<]*)<\/command-name>/;
const STDOUT_RE = /<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/;

/**
 * Copy this ask. Prompt reuse is a real loop — you find the thing you asked
 * three weeks ago precisely so you can ask it again — and the spine already
 * isolates the asks. Appears on hover so it costs the reading view nothing.
 */
function CopyPrompt({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  if (text.trim() === '') return null;
  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation(); // the block header is clickable in some views
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard denied — nothing actionable */
    }
  };
  return (
    <button
      className={`copy-prompt ${copied ? 'ok' : ''}`}
      onClick={copy}
      aria-label={copied ? 'Prompt copied' : 'Copy this prompt'}
      title={copied ? 'Copied' : 'Copy this prompt'}
    >
      {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
    </button>
  );
}

const PromptBlock = memo(function PromptBlock({ row }: { row: MessageRow }) {
  const command = COMMAND_RE.exec(row.text)?.[1]?.trim();
  const stdout = STDOUT_RE.exec(row.text)?.[1]?.trim();
  const { images, media } = parseRaw(row);
  const items = useMediaItems(row, images, media, 'pasted image');

  return (
    <div className="block block-user">
      <div className="block-head">
        <span className="block-label">you</span>
        <Ts iso={row.ts} />
        <CopyPrompt text={row.text} />
      </div>
      {command ? (
        <div className="prompt-command">
          <Badge kind="cmd">{command}</Badge>
          {stdout && stdout !== '' && <ClampedText text={stdout} />}
        </div>
      ) : (
        row.text !== '' && <ClampedText text={row.text} />
      )}
      <MediaStrip items={items} />
    </div>
  );
});

/* ── assistant ───────────────────────────────────────────────────────── */

/** What the record says about how the answer was made, beyond its words. */
function responseFacts(row: MessageRow): { effort: string | null; thinkingMs: number | null; fast: boolean } {
  try {
    const o = JSON.parse(row.raw) as {
      effort?: unknown;
      thinkingDurationMs?: unknown;
      message?: { usage?: { speed?: unknown } };
    };
    return {
      effort: typeof o.effort === 'string' ? o.effort : null,
      thinkingMs: typeof o.thinkingDurationMs === 'number' ? o.thinkingDurationMs : null,
      fast: o.message?.usage?.speed === 'fast',
    };
  } catch {
    return { effort: null, thinkingMs: null, fast: false };
  }
}

function fmtSeconds(ms: number): string {
  return ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 1000)}s`;
}

const AssistantBlock = memo(function AssistantBlock({ row }: { row: MessageRow }) {
  const view = parseRaw(row);
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const agentLabel = useContext(AgentLabelContext);
  const sessionId = useContext(SessionIdContext);
  const facts = useMemo(() => responseFacts(row), [row]);
  const items = useMediaItems(row, view.images, view.media, 'image');
  const resolveMedia = useMemo(
    () => (ref: string) => (sessionId ? mediaUrl(sessionId, row.idx, ref) : null),
    [sessionId, row.idx],
  );
  // Current models return thinking with its text omitted: a signature and a
  // duration, nothing to read. Say that it happened, not that it is empty.
  const thinking = view.thinkingParts.filter((t) => t.trim() !== '').join('\n\n');
  const hidThinking = view.thinkingParts.length > 0 && thinking === '';
  const meta = [
    hidThinking ? `thought${facts.thinkingMs !== null ? ` ${fmtSeconds(facts.thinkingMs)}` : ''}` : null,
    facts.effort ? `${facts.effort} effort` : null,
    facts.fast ? 'fast mode' : null,
  ].filter(Boolean);

  if (hidThinking && view.textParts.length === 0 && items.length === 0) {
    return (
      <div className="block block-mode block-thought">
        <span className="mode-text">{meta.join(' · ')}</span>
      </div>
    );
  }

  return (
    <div className="block block-assistant">
      <div className="block-head">
        <span className="block-label">{agentLabel}</span>
        {meta.length > 0 && <span className="block-meta">{meta.join(' · ')}</span>}
        <Ts iso={row.ts} />
      </div>
      {thinking !== '' && (
        <div className="thinking">
          <button className="thinking-toggle" onClick={() => setThinkingOpen(!thinkingOpen)}>
            <Caret open={thinkingOpen} /> thinking
            {facts.thinkingMs !== null && <span className="thinking-time">{fmtSeconds(facts.thinkingMs)}</span>}
          </button>
          {thinkingOpen && <ClampedText text={thinking} />}
        </div>
      )}
      {view.textParts.map((text, i) => (
        <Markdown key={i} text={text} resolveMedia={resolveMedia} />
      ))}
      <MediaStrip items={items} />
    </div>
  );
});

/* ── tool calls ──────────────────────────────────────────────────────── */

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function shortPath(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.length <= 3 ? p : `…/${parts.slice(-3).join('/')}`;
}

function toolSummary(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'Bash':
      return str(input.description) ?? (str(input.command)?.split('\n')[0] ?? '');
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
    case 'NotebookEdit':
      return shortPath(str(input.file_path) ?? str(input.notebook_path) ?? '');
    case 'Grep':
      return str(input.pattern) ?? '';
    case 'Glob':
      return str(input.pattern) ?? '';
    case 'Task':
    case 'Agent':
      return str(input.description) ?? '';
    case 'TaskCreate':
      return str(input.subject) ?? '';
    case 'TaskUpdate': {
      const id = str(input.taskId) ?? (typeof input.taskId === 'number' ? String(input.taskId) : '');
      const status = str(input.status);
      return `#${id}${status ? ` → ${status.replace(/_/g, ' ')}` : ''}`;
    }
    case 'TaskGet':
      return str(input.taskId) ? `#${str(input.taskId)}` : '';
    case 'ToolSearch':
      return str(input.query) ?? '';
    case 'Skill':
      return str(input.skill) ?? str(input.name) ?? '';
    case 'SendUserFile': {
      const files = Array.isArray(input.files) ? input.files.length : 0;
      return str(input.caption) ?? `${files} file${files === 1 ? '' : 's'}`;
    }
    case 'AskUserQuestion': {
      const qs = Array.isArray(input.questions) ? input.questions : [];
      const first = (qs[0] as { question?: unknown } | undefined)?.question;
      return typeof first === 'string' ? first : `${qs.length} questions`;
    }
    case 'WebFetch':
      return str(input.url) ?? '';
    case 'WebSearch':
      return str(input.query) ?? '';
    case 'TodoWrite':
      return Array.isArray(input.todos) ? `${input.todos.length} items` : '';
    default: {
      const first = Object.entries(input).find(([, v]) => typeof v === 'string');
      return first ? `${first[0]}: ${(first[1] as string).split('\n')[0] ?? ''}` : '';
    }
  }
}

function TodoList({ todos }: { todos: unknown[] }) {
  const GLYPH: Record<string, string> = { completed: '☑', in_progress: '◐', pending: '☐' };
  return (
    <ul className="todo-list">
      {todos.map((t, i) => {
        const item = t as { content?: unknown; status?: unknown };
        return (
          <li key={i} data-status={str(item.status) ?? 'pending'}>
            <span>{GLYPH[str(item.status) ?? ''] ?? '☐'}</span> {str(item.content) ?? ''}
          </li>
        );
      })}
    </ul>
  );
}

function ToolBody({
  name,
  input,
  body,
}: {
  name: string;
  input: Record<string, unknown>;
  /** Free-form call body (Codex exec's JavaScript) — code, not arguments. */
  body?: string;
}) {
  // A call whose payload is a snippet reads as the snippet, not as a JSON
  // string with escaped newlines.
  if (body !== undefined && body !== '') {
    return <CodeBlock code={body} langHint="javascript" />;
  }
  switch (name) {
    case 'Bash': {
      const cmd = str(input.command);
      return cmd ? <CodeBlock code={cmd} langHint="bash" /> : null;
    }
    case 'Edit': {
      const path = str(input.file_path) ?? '';
      const oldS = str(input.old_string);
      const newS = str(input.new_string);
      if (oldS !== null && newS !== null) {
        return <EditDiff path={path} oldString={oldS} newString={newS} />;
      }
      break;
    }
    case 'MultiEdit': {
      const path = str(input.file_path) ?? '';
      if (Array.isArray(input.edits)) {
        return (
          <>
            {input.edits.slice(0, 5).map((e, i) => {
              const edit = e as { old_string?: unknown; new_string?: unknown };
              const oldS = str(edit.old_string);
              const newS = str(edit.new_string);
              return oldS !== null && newS !== null ? (
                <EditDiff key={i} path={path} oldString={oldS} newString={newS} />
              ) : null;
            })}
            {input.edits.length > 5 && (
              <div className="tool-note">…{input.edits.length - 5} more edits (view raw)</div>
            )}
          </>
        );
      }
      break;
    }
    case 'Write': {
      const content = str(input.content);
      return content !== null ? <WriteDiff content={content} /> : null;
    }
    case 'Read': {
      const range =
        input.offset !== undefined || input.limit !== undefined
          ? ` (offset ${String(input.offset ?? 0)}, limit ${String(input.limit ?? '∞')})`
          : '';
      return <div className="tool-note">{(str(input.file_path) ?? '') + range}</div>;
    }
    case 'Grep':
    case 'Glob': {
      const where = str(input.path);
      return (
        <div className="tool-note">
          <code>{str(input.pattern) ?? ''}</code>
          {where ? ` in ${shortPath(where)}` : ''}
        </div>
      );
    }
    case 'Task':
    case 'Agent': {
      const prompt = str(input.prompt);
      return prompt ? <ClampedText text={prompt} mono={false} /> : null;
    }
    case 'TaskCreate': {
      const desc = str(input.description);
      return desc ? <ClampedText text={desc} mono={false} /> : null;
    }
    case 'AskUserQuestion':
      if (Array.isArray(input.questions)) {
        return (
          <ul className="ask-list">
            {input.questions.map((q, i) => {
              const item = q as { question?: unknown; options?: unknown };
              const options = Array.isArray(item.options) ? item.options : [];
              return (
                <li key={i}>
                  <span className="ask-q">{str(item.question) ?? ''}</span>
                  {options.length > 0 && (
                    <span className="ask-options">
                      {options
                        .map((o) => str((o as { label?: unknown }).label) ?? '')
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        );
      }
      break;
    case 'TodoWrite':
      if (Array.isArray(input.todos)) return <TodoList todos={input.todos} />;
      break;
    default:
      break;
  }
  const json = JSON.stringify(input, null, 2);
  return json === '{}' ? null : <CodeBlock code={json} langHint="json" />;
}

function ResultBody({ result }: { result: MessageRow }) {
  const view = parseRaw(result);
  const first: ToolResultView | undefined = view.toolResults[0];
  const text = first?.text !== undefined && first.text !== '' ? first.text : result.text;
  const isError = first?.isError === true;
  const images = first?.images ?? [];
  // A result whose only content is its images reads as the images.
  const textShown = text.replace(/\[Image: source: [^\]\n]+\]/g, '').trim();
  return (
    <div className={`tool-result ${isError ? 'error' : ''}`}>
      <div className="tool-result-label">{isError ? 'result · error' : 'result'}</div>
      {textShown === '' && images.length === 0 ? (
        <div className="tool-note">(empty)</div>
      ) : textShown === '' ? (
        <div className="tool-note">
          {images.length} image{images.length === 1 ? '' : 's'} — shown above
        </div>
      ) : (
        <ClampedText text={textShown} />
      )}
    </div>
  );
}

/**
 * A road not taken: the prompt (and any work under it) that was interrupted
 * and replaced by a retry. Folded away by default — it did not happen — but
 * never dropped, so "what did I ask before I rephrased" stays answerable.
 */
function AbandonedRun({ blocks }: { blocks: Block[] }) {
  const [open, setOpen] = useState(false);
  const n = blocks.length;
  return (
    <div className="sidechain abandoned-run">
      <button className="sidechain-head" onClick={() => setOpen(!open)}>
        <Caret open={open} />
        <span className="sidechain-label">abandoned attempt</span>
        <span className="sidechain-count">
          {n} event{n === 1 ? '' : 's'}
        </span>
      </button>
      {open && (
        <div className="sidechain-body">
          {blocks.map((b, i) => (
            <BlockView key={i} block={b} currentIdx={null} />
          ))}
        </div>
      )}
    </div>
  );
}

export function SidechainRun({ blocks, label }: { blocks: Block[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const turns = blocks.length;
  return (
    <div className="sidechain">
      <button className="sidechain-head" onClick={() => setOpen(!open)}>
        <Caret open={open} />
        <span className="sidechain-label">{label ?? 'subagent run'}</span>
        <span className="sidechain-count">
          {turns} turn{turns === 1 ? '' : 's'}
        </span>
      </button>
      {open && (
        <div className="sidechain-body">
          {blocks.map((b, i) => (
            <BlockView key={i} block={b} currentIdx={null} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Child idxs belong to another session — the parent's gutter must not claim them. */
const NO_BOOKMARKS: BookmarkState = { idxs: new Set(), toggle: null };

/**
 * A file-based subagent transcript nested under its Task call — the same
 * fold as SidechainRun, but the rows live in a child session and load on
 * first expand.
 */
function ChildSessionRun({ child, label }: { child: ChildSessionSummary; label: string }) {
  const [open, setOpen] = useState(false);
  const rows = useChildRows(child.id, open);
  const blocks = useMemo(() => buildChildBlocks(rows.data ?? []), [rows.data]);
  return (
    <div className="sidechain">
      <button className="sidechain-head" onClick={() => setOpen(!open)}>
        <Caret open={open} />
        <span className="sidechain-label">{label}</span>
        <span className="sidechain-count">{fmtCount(child.eventCount)} events</span>
      </button>
      {open && (
        <div className="sidechain-body">
          {rows.isLoading ? (
            <SkeletonLines n={3} />
          ) : rows.isError ? (
            <div className="tool-note">failed to load subagent transcript</div>
          ) : (
            <BookmarkContext.Provider value={NO_BOOKMARKS}>
              {blocks.map((b, i) => (
                <BlockView key={i} block={b} currentIdx={null} />
              ))}
            </BookmarkContext.Provider>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The words for why a moment matters. Thirty unlabelled bookmarks are thirty
 * message prefixes to re-read; one line of your own makes the collection
 * usable. Only offered once a block is marked — captioning is the second
 * step, never a reason not to bookmark.
 */
function BookmarkCaption({
  idx,
  caption,
  onSave,
}: {
  idx: number;
  caption: string;
  onSave: (idx: number, caption: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(caption);

  if (!editing) {
    return (
      <button
        className={`bm-caption ${caption ? '' : 'empty'}`}
        onClick={() => {
          setDraft(caption);
          setEditing(true);
        }}
        title={caption ? 'Edit this caption' : 'Say why this moment matters'}
      >
        {caption || 'add a caption'}
      </button>
    );
  }
  const commit = () => {
    setEditing(false);
    if (draft.trim() !== caption) onSave(idx, draft.trim());
  };
  return (
    <input
      className="bm-caption-input"
      value={draft}
      autoFocus
      maxLength={300}
      placeholder="why does this matter?"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setEditing(false);
      }}
    />
  );
}

const ToolBlockView = memo(function ToolBlockView({
  block,
  forceOpen,
  defaultOpen = false,
}: {
  block: Extract<Block, { kind: 'tool' }>;
  forceOpen: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const view = parseRaw(block.use);
  const use = useMemo(
    () =>
      view.toolUses.find((t) => t.id === block.use.toolUseId) ??
      view.toolUses[0] ?? {
        id: null,
        name: block.use.toolName ?? 'tool',
        input: {},
        // Nothing structured to show: fall back to the indexed text, which
        // for an unrecognized agent is the whole call.
        body: block.use.text || undefined,
      },
    [view, block.use.toolUseId, block.use.toolName],
  );
  const isOpen = open || forceOpen;

  // Task calls whose transcript went to a separate file (newer CC) get the
  // child session nested where the inline sidechain run would have been.
  const childSessions = useContext(ChildSessionsContext);
  const child =
    SUBAGENT_TOOLS.has(block.use.toolName ?? '') && block.run === null
      ? matchChildSession(childSessions, str(use.input.prompt), block.use.ts)
      : null;

  const resultView = block.result ? parseRaw(block.result) : null;
  const failed = resultView?.toolResults[0]?.isError === true;
  // A call's media shows without opening it: what the agent sent you, what a
  // screenshot tool saw. Inline result bytes win over a path to the same file.
  const resultImages = useMemo(
    () => resultView?.toolResults.flatMap((r) => r.images) ?? NO_IMAGES,
    [resultView],
  );
  const useItems = useMediaItems(
    block.use,
    NO_IMAGES,
    resultImages.length > 0 ? NO_REFS : view.media,
    'file',
  );
  const resultItems = useMediaItems(
    block.result,
    resultImages,
    resultView?.media ?? NO_REFS,
    'tool screenshot',
  );
  const media = useMemo(() => [...useItems, ...resultItems], [useItems, resultItems]);
  const summary = toolSummary(use.name, use.input);
  const category =
    use.name === 'Bash'
      ? 'cat-cmd'
      : ['Edit', 'MultiEdit', 'Write', 'NotebookEdit'].includes(use.name)
        ? 'cat-diff'
        : '';

  return (
    <div className="block block-tool">
      <button className="tool-head" onClick={() => setOpen(!isOpen)}>
        <Caret open={isOpen} />
        <span className={`tool-dot ${category} ${failed ? 'failed' : ''}`} />
        <span className="tool-name">{mcpName(use.name)}</span>
        {summary && <span className="tool-summary">{summary}</span>}
        {!block.result && <span className="tool-pending">no result</span>}
        <Ts iso={block.use.ts} />
      </button>
      {media.length > 0 && (
        <div className="tool-media">
          <MediaStrip items={media} />
        </div>
      )}
      {isOpen && (
        <div className="tool-body">
          <ToolBody name={use.name} input={use.input} body={use.body} />
          {block.result && <ResultBody result={block.result} />}
          <RawDetails raw={block.use.raw} />
        </div>
      )}
      {block.run && (
        <SidechainRun
          blocks={block.run}
          label={str(use.input.subagent_type) ?? 'subagent run'}
        />
      )}
      {child && (
        <ChildSessionRun
          child={child}
          label={str(use.input.subagent_type) ?? 'subagent run'}
        />
      )}
    </div>
  );
});

/* ── the rest ────────────────────────────────────────────────────────── */

function SummaryBlock({ row }: { row: MessageRow }) {
  return (
    <div className="block block-summary">
      <Badge kind="summary">summary</Badge>
      <span className="summary-text">{row.text}</span>
    </div>
  );
}

const SystemBlock = memo(function SystemBlock({ row }: { row: MessageRow }) {
  const [open, setOpen] = useState(false);
  const { subtype } = recordShape(row);
  // "While you were away": the agent's own recap — prose worth reading as is.
  if (subtype === 'away_summary' && row.text !== '') {
    return (
      <div className="block block-summary">
        <Badge kind="summary">recap</Badge>
        <span className="summary-text">{row.text}</span>
        <Ts iso={row.ts} />
      </div>
    );
  }
  const command = subtype === 'local_command' ? COMMAND_RE.exec(row.text)?.[1]?.trim() : undefined;
  if (command) {
    return (
      <div className="block block-mode">
        <Badge kind="cmd">{command}</Badge>
        <Ts iso={row.ts} />
      </div>
    );
  }
  const oneLine = (row.text.split('\n')[0] ?? '') || subtype;
  return (
    <div className="block block-system">
      <button className="system-head" onClick={() => setOpen(!open)}>
        <Caret open={open} />
        <span className="block-label">system</span>
        {!open && <span className="system-preview">{oneLine.slice(0, 120)}</span>}
        <Ts iso={row.ts} />
      </button>
      {open && <ClampedText text={row.text || prettyRaw(row.raw)} />}
    </div>
  );
});

function TitleBlock({ row }: { row: MessageRow }) {
  return (
    <div className="block block-summary">
      <Badge kind="summary">title</Badge>
      <span className="summary-text">{row.text}</span>
    </div>
  );
}

const AttachmentBlock = memo(function AttachmentBlock({ row }: { row: MessageRow }) {
  const [open, setOpen] = useState(false);
  const att = useMemo(() => {
    try {
      const a = (JSON.parse(row.raw) as { attachment?: unknown }).attachment;
      return typeof a === 'object' && a !== null ? (a as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }, [row.raw]);
  const type = str(att?.type) ?? '';
  const label = ATTACH_LABEL[type];

  if (label) {
    // Read the path from the record, not from row.text: the indexed text is
    // now "path\nbody" for the subtypes that carry one.
    const detail =
      str(att?.filename) ??
      str(att?.path) ??
      str(att?.displayPath) ??
      str(att?.prompt) ??
      str(att?.planFilePath) ??
      row.text ??
      '';
    // The body the attachment carried — a hand-edit's snippet, an attached
    // file's contents, a directory listing. It is what the run actually saw,
    // so it folds like every other long payload instead of being invisible.
    const body =
      str(att?.snippet) ??
      str((att?.content as { file?: { content?: unknown } } | undefined)?.file?.content) ??
      str(att?.content);
    if (body) {
      return (
        <div className="block block-summary block-attachment has-body">
          <button className="attach-head" onClick={() => setOpen(!open)}>
            <Caret open={open} />
            <Badge>{label}</Badge>
            {detail && <span className="attach-detail">{shortPath(detail)}</span>}
            <Ts iso={row.ts} />
          </button>
          {open && <ClampedText text={body} />}
        </div>
      );
    }
    return (
      <div className="block block-summary block-attachment">
        <Badge>{label}</Badge>
        {detail && <span className="attach-detail">{shortPath(detail)}</span>}
        <Ts iso={row.ts} />
      </div>
    );
  }
  // Harness bookkeeping (reminders, tool listings, …) — recognized, dim,
  // collapsed. Same posture as unknown rows, minus the "unrecognized" alarm.
  return (
    <div className="block block-unknown">
      <button className="system-head" onClick={() => setOpen(!open)}>
        <Caret open={open} />
        <span className="block-label">context{type ? ` · ${type}` : ''}</span>
        <Ts iso={row.ts} />
      </button>
      {open && <ClampedText text={prettyRaw(row.raw)} />}
    </div>
  );
});

/**
 * A mode/permission-mode change ("permissions · auto"). CC writes these
 * repeatedly; thread.ts folds runs of the same value, so a rendered row is an
 * actual switch.
 */
const ModeBlock = memo(function ModeBlock({ row }: { row: MessageRow }) {
  const text = useMemo(() => {
    try {
      const o = JSON.parse(row.raw) as {
        type?: unknown;
        mode?: unknown;
        permissionMode?: unknown;
      };
      if (typeof o.permissionMode === 'string') return `permissions · ${o.permissionMode}`;
      if (typeof o.mode === 'string') return `mode · ${o.mode}`;
    } catch {
      /* degrade below */
    }
    return 'mode';
  }, [row.raw]);
  return (
    <div className="block block-mode">
      <span className="mode-text">{text}</span>
    </div>
  );
});

/** One harness record's name, for the folded row and its expansion. */
function harnessLabel(row: MessageRow): string {
  const { type, subtype } = recordShape(row);
  if (row.kind === 'attachment') return subtype || 'context';
  if (row.kind === 'system') return subtype || 'system';
  if (row.kind === 'title') return type || 'title';
  return type || row.kind;
}

/**
 * Harness records between two moments, as one quiet row: request snapshots,
 * cache latches, injected reminders, repeated titles. Recognized and kept —
 * open the row to read any of them raw — but none is something that happened.
 */
const HarnessRun = memo(function HarnessRun({ rows }: { rows: MessageRow[] }) {
  const [open, setOpen] = useState(false);
  const [rawAt, setRawAt] = useState<number | null>(null);
  const names = [...new Set(rows.map(harnessLabel))];
  const shown = names.slice(0, 3).join(', ') + (names.length > 3 ? ', …' : '');
  return (
    <div className="block block-unknown block-harness">
      <button className="system-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Caret open={open} />
        <span className="block-label">bookkeeping</span>
        <span className="system-preview">
          {rows.length} record{rows.length === 1 ? '' : 's'} · {shown}
        </span>
        <Ts iso={rows.find((r) => r.ts)?.ts ?? null} />
      </button>
      {open && (
        <ul className="harness-list">
          {rows.map((r) => (
            <li key={r.idx}>
              <button
                className="harness-item"
                onClick={() => setRawAt(rawAt === r.idx ? null : r.idx)}
                aria-expanded={rawAt === r.idx}
              >
                <Caret open={rawAt === r.idx} />
                <span>{harnessLabel(r)}</span>
                <Ts iso={r.ts} />
              </button>
              {rawAt === r.idx && <ClampedText text={prettyRaw(r.raw)} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});

const UnknownBlock = memo(function UnknownBlock({ row }: { row: MessageRow }) {
  const [open, setOpen] = useState(false);
  const type = useMemo(() => {
    try {
      const t = (JSON.parse(row.raw) as { type?: unknown }).type;
      return typeof t === 'string' ? t : null;
    } catch {
      return null;
    }
  }, [row.raw]);
  return (
    <div className="block block-unknown">
      <button className="system-head" onClick={() => setOpen(!open)}>
        <Caret open={open} />
        <span className="block-label">unrecognized event{type ? ` · ${type}` : ''}</span>
        <Ts iso={row.ts} />
      </button>
      {open && <ClampedText text={prettyRaw(row.raw)} />}
    </div>
  );
});

function MessageBlock({ row }: { row: MessageRow }) {
  switch (row.kind) {
    case 'prompt':
      return <PromptBlock row={row} />;
    case 'assistant':
      return <AssistantBlock row={row} />;
    case 'summary':
      return <SummaryBlock row={row} />;
    case 'system':
    case 'meta': // injected context (isMeta) — a dim collapsible row, not a prompt
      return <SystemBlock row={row} />;
    case 'title':
      return <TitleBlock row={row} />;
    case 'attachment':
      return <AttachmentBlock row={row} />;
    case 'mode':
      return <ModeBlock row={row} />;
    case 'tool_result':
      // Unpaired result (tool_use outside the loaded window) — still shown.
      return <ResultBody result={row} />;
    default:
      return <UnknownBlock row={row} />;
  }
}

export function BlockView({
  block,
  currentIdx,
  defaultOpen = false,
}: {
  block: Block;
  currentIdx: number | null;
  /** Lens views open tool blocks by default — the content IS the view. */
  defaultOpen?: boolean;
}) {
  const isCurrent =
    currentIdx !== null &&
    (block.kind === 'message'
      ? block.row.idx === currentIdx
      : block.kind === 'tool'
        ? block.use.idx === currentIdx || block.result?.idx === currentIdx
        : false);

  const inner =
    block.kind === 'message' ? (
      <MessageBlock row={block.row} />
    ) : block.kind === 'tool' ? (
      <ToolBlockView block={block} forceOpen={isCurrent} defaultOpen={defaultOpen} />
    ) : block.kind === 'abandoned' ? (
      <AbandonedRun blocks={block.run} />
    ) : block.kind === 'harness' ? (
      <HarnessRun rows={block.rows} />
    ) : (
      <SidechainRun blocks={block.run} />
    );

  // "Mark this moment": every block kind gets the same gutter toggle; state
  // arrives via context so log view and expanded spine turns share it.
  const bookmarks = useContext(BookmarkContext);
  const marked = bookmarks.idxs.has(block.repIdx);

  return (
    <div
      className={`block-slot ${isCurrent ? 'match-current' : ''} ${marked ? 'bookmarked' : ''}`}
    >
      {bookmarks.toggle && (
        <Tooltip content={marked ? 'Remove bookmark' : 'Bookmark this moment'}>
          <button
            className={`block-bookmark ${marked ? 'on' : ''}`}
            onClick={() => bookmarks.toggle!(block.repIdx)}
            aria-label={marked ? 'Remove bookmark' : 'Bookmark this moment'}
            aria-pressed={marked}
          >
            {marked ? <BookmarkFilledIcon size={14} /> : <BookmarkIcon size={14} />}
          </button>
        </Tooltip>
      )}
      {marked && bookmarks.setCaption && (
        <BookmarkCaption
          idx={block.repIdx}
          caption={bookmarks.captions?.get(block.repIdx) ?? ''}
          onSave={bookmarks.setCaption}
        />
      )}
      {inner}
    </div>
  );
}
