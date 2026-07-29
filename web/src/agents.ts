/**
 * The agent registry — the single UI source of truth for every adapter's
 * identity. Claude Code and Codex are the first two, not the last: a new
 * adapter is one entry here plus one `--agent-*` token in theme.css, and
 * every surface (chips, calendar stripes, tooltips) picks it up.
 *
 * Brand colors are used in small doses only — calendar edge stripes today —
 * never as surface fills (Claude's terracotta would collide with the app's
 * vermilion accent semantics). Chips stay contrast-neutral uppercase.
 */
export interface AgentInfo {
  /** The `sessions.tool` value the server stamps. */
  id: string;
  /** Chip label, lowercase like model chips. */
  label: string;
  /** CSS class carrying the brand hue (`.agent-*` in app.css). */
  colorClass: string;
}

const REGISTRY: Record<string, AgentInfo> = {
  'claude-code': { id: 'claude-code', label: 'claude', colorClass: 'agent-claude' },
  codex: { id: 'codex', label: 'codex', colorClass: 'agent-codex' },
};

/**
 * Unknown tool values (a future adapter before its UI registration) degrade
 * to a neutral chip carrying the raw id — a new tool must never break the UI.
 */
export function agentInfo(tool: string): AgentInfo {
  return REGISTRY[tool] ?? { id: tool, label: tool, colorClass: 'agent-unknown' };
}
