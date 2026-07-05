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
  | { kind: 'orphan-run'; run: Block[]; repIdx: number };

/** Fold tool_use/tool_result pairs; no sidechain handling at this level. */
function foldTools(rows: MessageRow[]): Block[] {
  const blocks: Block[] = [];
  const pendingTools = new Map<string, Extract<Block, { kind: 'tool' }>>();

  for (const row of rows) {
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

export function buildBlocks(rows: MessageRow[]): Block[] {
  const main: MessageRow[] = [];
  const side: MessageRow[] = [];
  for (const row of rows) (row.isSidechain ? side : main).push(row);

  const blocks = foldTools(main);
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
        b.run.forEach(claim);
      }
    };
    claim(block);
  });
  return map;
}
