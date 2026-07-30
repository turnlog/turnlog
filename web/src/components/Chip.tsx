import type { HTMLAttributes, ReactNode } from 'react';
import './Chip.css';

/**
 * Chip — every small rounded label: metadata tags (model, record kind),
 * status badges (failed, summary, attachment), slash-command pills, and the
 * brand-filled agent chip. Display-only; interactive pills are buttons with
 * their own classes.
 */
const KIND_CLASS = {
  default: 'chip',
  /** contrast surface — "this one is open/current" */
  open: 'chip chip-open',
  /** slash command / CLI string — mono on the contrast surface */
  cmd: 'chip chip-cmd',
  /** blue wash — compaction summaries, titles, plan markers */
  summary: 'chip chip-summary',
  /** attachment marker on prompt blocks */
  attach: 'chip chip-attach',
  /** error wash — failed edits, missing files */
  failed: 'chip chip-failed',
  /** mono model name */
  model: 'chip chip-model',
  /** brand-filled agent identity — pair with an agents.ts colorClass */
  tool: 'chip-tool',
} as const;

interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  kind?: keyof typeof KIND_CLASS;
  className?: string;
  children: ReactNode;
}

export default function Chip({ kind = 'default', className, children, ...rest }: ChipProps) {
  return (
    <span className={`${KIND_CLASS[kind]} ${className ?? ''}`.trim()} {...rest}>
      {children}
    </span>
  );
}
