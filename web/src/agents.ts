/**
 * The agent registry — the single UI source of truth for every adapter's
 * identity. Claude Code and Codex are the first two, not the last: a new
 * adapter is one entry here plus one `--agent-*` token in theme.css, and
 * every surface (badges, calendar stripes, tooltips) picks it up.
 *
 * Brand colors are used in small doses only — calendar edge stripes today —
 * never as surface fills (Claude's terracotta would collide with the app's
 * vermilion accent semantics).
 */
import type { ComponentType } from 'react';
import { ClaudeMark, CursorMark, OpenAIMark } from './icons';

export interface AgentInfo {
  /** The `sessions.tool` value the server stamps. */
  id: string;
  /** Badge label, written the way the product writes it. */
  label: string;
  /** CSS class carrying the brand hue (`.agent-*` in app.css). */
  colorClass: string;
  /** Brand mark, drawn in currentColor. Absent for unregistered adapters. */
  Mark?: ComponentType<{ size?: number; className?: string }>;
}

const REGISTRY: Record<string, AgentInfo> = {
  'claude-code': {
    id: 'claude-code',
    label: 'Claude',
    colorClass: 'agent-claude',
    Mark: ClaudeMark,
  },
  codex: { id: 'codex', label: 'Codex', colorClass: 'agent-codex', Mark: OpenAIMark },
  // Covers both Cursor sources (CLI transcripts and IDE composers). The brand
  // is monochrome: --agent-cursor flips black/white with the theme.
  cursor: { id: 'cursor', label: 'Cursor', colorClass: 'agent-cursor', Mark: CursorMark },
};

/**
 * Unknown tool values (a future adapter before its UI registration) degrade
 * to a neutral badge carrying the raw id — a new tool must never break the UI.
 * No `Mark`: the label alone still identifies it.
 */
export function agentInfo(tool: string): AgentInfo {
  return REGISTRY[tool] ?? { id: tool, label: tool, colorClass: 'agent-unknown' };
}
