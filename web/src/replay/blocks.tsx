import { memo, useMemo, useState } from 'react';
import CodeBlock from '../code/CodeBlock';
import { langFromPath } from '../code/highlighter';
import { fmtTime } from '../format';
import Markdown from '../md/Markdown';
import type { MessageRow } from '../types';
import { EditDiff, WriteDiff } from './DiffView';
import { parseRaw, prettyRaw, type ToolResultView } from './raw';
import type { Block } from './thread';

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

const PromptBlock = memo(function PromptBlock({ row }: { row: MessageRow }) {
  const command = COMMAND_RE.exec(row.text)?.[1]?.trim();
  const stdout = STDOUT_RE.exec(row.text)?.[1]?.trim();

  return (
    <div className="block block-user">
      <div className="block-head">
        <span className="block-label">you</span>
        <Ts iso={row.ts} />
      </div>
      {command ? (
        <div className="prompt-command">
          <span className="chip chip-cmd">{command}</span>
          {stdout && stdout !== '' && <ClampedText text={stdout} />}
        </div>
      ) : (
        <ClampedText text={row.text} />
      )}
    </div>
  );
});

/* ── assistant ───────────────────────────────────────────────────────── */

const AssistantBlock = memo(function AssistantBlock({ row }: { row: MessageRow }) {
  const view = parseRaw(row);
  const [thinkingOpen, setThinkingOpen] = useState(false);

  return (
    <div className="block block-assistant">
      <div className="block-head">
        <span className="block-label">claude</span>
        <Ts iso={row.ts} />
      </div>
      {view.thinkingParts.length > 0 && (
        <div className="thinking">
          <button className="thinking-toggle" onClick={() => setThinkingOpen(!thinkingOpen)}>
            <Caret open={thinkingOpen} /> thinking
          </button>
          {thinkingOpen && <ClampedText text={view.thinkingParts.join('\n\n')} />}
        </div>
      )}
      {view.textParts.map((text, i) => (
        <Markdown key={i} text={text} />
      ))}
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
      return str(input.description) ?? '';
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

function ToolBody({ name, input }: { name: string; input: Record<string, unknown> }) {
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
    case 'Task': {
      const prompt = str(input.prompt);
      return prompt ? <ClampedText text={prompt} /> : null;
    }
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
  return (
    <div className={`tool-result ${isError ? 'error' : ''}`}>
      <div className="tool-result-label">{isError ? 'result · error' : 'result'}</div>
      {text === '' ? (
        <div className="tool-note">(empty)</div>
      ) : (
        <ClampedText text={text} />
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

const ToolBlockView = memo(function ToolBlockView({
  block,
  forceOpen,
}: {
  block: Extract<Block, { kind: 'tool' }>;
  forceOpen: boolean;
}) {
  const [open, setOpen] = useState(false);
  const view = parseRaw(block.use);
  const use = useMemo(
    () =>
      view.toolUses.find((t) => t.id === block.use.toolUseId) ??
      view.toolUses[0] ?? { id: null, name: block.use.toolName ?? 'tool', input: {} },
    [view, block.use.toolUseId, block.use.toolName],
  );
  const isOpen = open || forceOpen;

  const resultView = block.result ? parseRaw(block.result) : null;
  const failed = resultView?.toolResults[0]?.isError === true;
  const summary = toolSummary(use.name, use.input);

  return (
    <div className="block block-tool">
      <button className="tool-head" onClick={() => setOpen(!isOpen)}>
        <Caret open={isOpen} />
        <span className={`tool-dot ${failed ? 'failed' : ''}`} />
        <span className="tool-name">{use.name}</span>
        {summary && <span className="tool-summary">{summary}</span>}
        {!block.result && <span className="tool-pending">no result</span>}
        <Ts iso={block.use.ts} />
      </button>
      {isOpen && (
        <div className="tool-body">
          <ToolBody name={use.name} input={use.input} />
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
    </div>
  );
});

/* ── the rest ────────────────────────────────────────────────────────── */

function SummaryBlock({ row }: { row: MessageRow }) {
  return (
    <div className="block block-summary">
      <span className="chip chip-summary">summary</span>
      <span className="summary-text">{row.text}</span>
    </div>
  );
}

const SystemBlock = memo(function SystemBlock({ row }: { row: MessageRow }) {
  const [open, setOpen] = useState(false);
  const oneLine = row.text.split('\n')[0] ?? '';
  return (
    <div className="block block-system">
      <button className="system-head" onClick={() => setOpen(!open)}>
        <Caret open={open} />
        <span className="block-label">system</span>
        {!open && <span className="system-preview">{oneLine.slice(0, 120)}</span>}
        <Ts iso={row.ts} />
      </button>
      {open && <ClampedText text={row.text} />}
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
      return <SystemBlock row={row} />;
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
}: {
  block: Block;
  currentIdx: number | null;
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
      <ToolBlockView block={block} forceOpen={isCurrent} />
    ) : (
      <SidechainRun blocks={block.run} />
    );

  return <div className={`block-slot ${isCurrent ? 'match-current' : ''}`}>{inner}</div>;
}
