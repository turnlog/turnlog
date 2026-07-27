import type { MessageRow } from '../types';
import { parseRaw } from './raw';

/**
 * Turns the flat idx-ordered message window into display blocks:
 *
 *  - tool_use rows fold their tool_result (paired by toolUseId) into one block
 *  - sidechain rows are grouped into subagent runs (chained via parentUuid)
 *    and nested under the Task tool call that spawned them
 *  - anything unattachable renders standalone — never dropped
 *
 * Threading is a parentUuid *chain*, but v1 display order is file order
 * (idx), which is what Claude Code itself replays. Branch rendering is a
 * later refinement; nothing here assumes a strict tree.
 */

export type Block =
  | { kind: 'message'; row: MessageRow; repIdx: number }
  | {
      kind: 'tool';
      use: MessageRow;
      result: MessageRow | null;
      run: Block[] | null;
      repIdx: number;
    }
  | { kind: 'orphan-run'; run: Block[]; repIdx: number }
  | { kind: 'abandoned'; run: Block[]; repIdx: number };

const INERT_KINDS = new Set(['meta', 'system', 'attachment', 'mode', 'title', 'unknown']);

/**
 * Rows on abandoned branches: interrupting Claude and retyping leaves the
 * first attempt as a dead sibling subtree that file order would otherwise
 * replay as a normal turn.
 *
 * Most multi-child nodes are not branches — continuation lines of one API
 * response (same message id), `tool_result` rows pairing with their call, and
 * injected bookkeeping records all hang off a shared parent. Past those, the
 * last child in file order is the live path and earlier siblings are dead.
 *
 * Mirrors `findAbandonedIdxs` in `src/server/api.ts` (which does the same for
 * the turn spine). This half sees only the loaded window: a fork whose halves
 * straddle the window edge simply renders flat — degrade, never throw.
 */
export function findAbandoned(rows: MessageRow[]): Set<number> {
  // Sidechains fork by design (parallel subagents share a parent) — the main
  // chain is the only place a branch means "abandoned".
  const main = rows.filter((r) => !r.isSidechain);
  const byUuid = new Map(main.map((r) => [r.uuid, r]));
  const children = new Map<string, MessageRow[]>();
  for (const r of main) {
    if (r.parentUuid === null) continue;
    const list = children.get(r.parentUuid);
    if (list) list.push(r);
    else children.set(r.parentUuid, [r]);
  }

  const abandoned = new Set<number>();
  for (const [parentUuid, kids] of children) {
    if (kids.length < 2) continue;
    const parentMsgId = byUuid.get(parentUuid)?.messageId ?? null;
    const forks = kids.filter(
      (c) =>
        !(parentMsgId !== null && c.messageId === parentMsgId) &&
        c.kind !== 'tool_result' &&
        !INERT_KINDS.has(c.kind),
    );
    if (forks.length < 2) continue;
    forks.sort((a, b) => a.idx - b.idx);
    for (const dead of forks.slice(0, -1)) {
      const stack = [dead];
      while (stack.length > 0) {
        const node = stack.pop()!;
        if (abandoned.has(node.idx)) continue;
        abandoned.add(node.idx);
        for (const child of children.get(node.uuid) ?? []) stack.push(child);
      }
    }
  }
  return abandoned;
}

/**
 * Mode rows split into two independent streams ('mode', 'permission-mode');
 * CC rewrites each repeatedly with the same value. Only a changed value is a
 * moment worth a row.
 */
function modeChange(row: MessageRow): { stream: string; value: string } | null {
  try {
    const o = JSON.parse(row.raw) as { type?: unknown; mode?: unknown; permissionMode?: unknown };
    const stream = typeof o.type === 'string' ? o.type : '';
    const value =
      typeof o.permissionMode === 'string'
        ? o.permissionMode
        : typeof o.mode === 'string'
          ? o.mode
          : '';
    return { stream, value };
  } catch {
    return null;
  }
}

/** Fold tool_use/tool_result pairs; no sidechain handling at this level. */
function foldTools(rows: MessageRow[]): Block[] {
  const blocks: Block[] = [];
  const pendingTools = new Map<string, Extract<Block, { kind: 'tool' }>>();
  const lastMode = new Map<string, string>();

  for (const row of rows) {
    if (row.kind === 'mode') {
      const change = modeChange(row);
      if (change) {
        if (lastMode.get(change.stream) === change.value) continue; // repeat — fold away
        lastMode.set(change.stream, change.value);
      }
    }
    if (row.kind === 'tool_use') {
      const block: Extract<Block, { kind: 'tool' }> = {
        kind: 'tool',
        use: row,
        result: null,
        run: null,
        repIdx: row.idx,
      };
      blocks.push(block);
      if (row.toolUseId) pendingTools.set(row.toolUseId, block);
      continue;
    }
    if (row.kind === 'tool_result' && row.toolUseId) {
      const owner = pendingTools.get(row.toolUseId);
      if (owner && owner.result === null) {
        owner.result = row;
        continue;
      }
    }
    blocks.push({ kind: 'message', row, repIdx: row.idx });
  }
  return blocks;
}

interface Run {
  rootIdx: number;
  firstText: string;
  blocks: Block[];
}

function groupSidechainRuns(side: MessageRow[]): Run[] {
  const byUuid = new Map(side.map((r) => [r.uuid, r]));
  const rootOf = new Map<string, string>();

  const findRoot = (row: MessageRow): string => {
    const seen = new Set<string>();
    let current = row;
    while (current.parentUuid && byUuid.has(current.parentUuid) && !seen.has(current.uuid)) {
      seen.add(current.uuid);
      current = byUuid.get(current.parentUuid)!;
    }
    return current.uuid;
  };

  const groups = new Map<string, MessageRow[]>();
  for (const row of side) {
    let root = rootOf.get(row.uuid);
    if (!root) {
      root = findRoot(row);
      rootOf.set(row.uuid, root);
    }
    const list = groups.get(root);
    if (list) list.push(row);
    else groups.set(root, [row]);
  }

  const runs: Run[] = [];
  for (const rows of groups.values()) {
    rows.sort((a, b) => a.idx - b.idx);
    const first = rows[0]!;
    runs.push({ rootIdx: first.idx, firstText: first.text, blocks: foldTools(rows) });
  }
  runs.sort((a, b) => a.rootIdx - b.rootIdx);
  return runs;
}

function taskPrompt(block: Extract<Block, { kind: 'tool' }>): string | null {
  if (block.use.toolName !== 'Task') return null;
  const use = parseRaw(block.use).toolUses.find((t) => t.name === 'Task');
  const prompt = use?.input.prompt;
  return typeof prompt === 'string' ? prompt : null;
}

const norm = (s: string) => s.trim().slice(0, 200);

/**
 * Blocks for a file-based subagent transcript: plain tool folding, no
 * sidechain regrouping — every row of the child file belongs to the one run.
 */
export function buildChildBlocks(rows: MessageRow[]): Block[] {
  return foldTools(rows);
}

export function buildBlocks(rows: MessageRow[]): Block[] {
  const main: MessageRow[] = [];
  const side: MessageRow[] = [];
  for (const row of rows) (row.isSidechain ? side : main).push(row);

  // Roads not taken fold away into one marker each, in place, so the replay
  // reads as the conversation that actually happened without hiding the rest.
  const dead = findAbandoned(main);
  const live = dead.size === 0 ? main : main.filter((r) => !dead.has(r.idx));
  const blocks = foldTools(live);
  if (dead.size > 0) {
    const deadRows = main.filter((r) => dead.has(r.idx));
    const runs: MessageRow[][] = [];
    for (const row of deadRows) {
      // Consecutive dead rows belong to the same abandoned attempt.
      const last = runs[runs.length - 1];
      if (last && row.idx === last[last.length - 1]!.idx + 1) last.push(row);
      else runs.push([row]);
    }
    for (const run of runs) {
      const block: Block = {
        kind: 'abandoned',
        run: foldTools(run),
        repIdx: run[0]!.idx,
      };
      const at = blocks.findIndex((b) => b.repIdx > block.repIdx);
      if (at === -1) blocks.push(block);
      else blocks.splice(at, 0, block);
    }
  }
  if (side.length === 0) return blocks;

  const runs = groupSidechainRuns(side);
  const toolBlocks = blocks.filter(
    (b): b is Extract<Block, { kind: 'tool' }> => b.kind === 'tool',
  );

  for (const run of runs) {
    // Best anchor: the Task call whose prompt matches the run's opening
    // message (parallel subagents make "nearest preceding" ambiguous).
    let anchor =
      run.firstText !== ''
        ? toolBlocks.find(
            (b) =>
              b.run === null &&
              b.use.idx < run.rootIdx &&
              taskPrompt(b) !== null &&
              norm(taskPrompt(b)!) === norm(run.firstText),
          )
        : undefined;
    if (!anchor) {
      // Fallback: nearest preceding unclaimed Task call.
      for (let i = toolBlocks.length - 1; i >= 0; i--) {
        const b = toolBlocks[i]!;
        if (b.use.idx < run.rootIdx && b.run === null && b.use.toolName === 'Task') {
          anchor = b;
          break;
        }
      }
    }
    if (anchor) {
      anchor.run = run.blocks;
    } else {
      // No spawner in the loaded window — render standalone, in stream order.
      const orphan: Block = { kind: 'orphan-run', run: run.blocks, repIdx: run.rootIdx };
      const at = blocks.findIndex((b) => b.repIdx > run.rootIdx);
      if (at === -1) blocks.push(orphan);
      else blocks.splice(at, 0, orphan);
    }
  }
  return blocks;
}

/** message idx → block position, for jump-to-context and match navigation. */
export function idxToBlockMap(blocks: Block[]): Map<number, number> {
  const map = new Map<number, number>();
  blocks.forEach((block, i) => {
    const claim = (b: Block) => {
      if (b.kind === 'message') map.set(b.row.idx, i);
      else if (b.kind === 'tool') {
        map.set(b.use.idx, i);
        if (b.result) map.set(b.result.idx, i);
        b.run?.forEach(claim);
      } else {
        // orphan-run / abandoned — both carry a nested block list.
        b.run.forEach(claim);
      }
    };
    claim(block);
  });
  return map;
}
