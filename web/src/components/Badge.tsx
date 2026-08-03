import type { HTMLAttributes, ReactNode } from 'react';
import './Badge.css';

/**
 * Badge — every small rounded label: metadata tags (model, record kind),
 * status badges (failed, summary, attachment), slash-command pills, and the
 * brand-filled agent badge. Display-only; interactive pills are buttons with
 * their own classes.
 */
const KIND_CLASS = {
  default: 'badge',
  /** slash command / CLI string — mono, in the commands purple */
  cmd: 'badge badge-cmd',
  /** blue wash — compaction summaries, titles, plan markers */
  summary: 'badge badge-summary',
  /** error wash — failed edits, missing files */
  failed: 'badge badge-failed',
  /** identity pill — which model ran; pairs with `tool` */
  model: 'badge badge-model',
  /** identity pill — which agent wrote it; pair with an agents.ts colorClass */
  tool: 'badge badge-tool',
} as const;

interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  kind?: keyof typeof KIND_CLASS;
  className?: string;
  children: ReactNode;
}

/**
 * There is one badge size. Kinds change the wash, the family, and the casing —
 * never the metrics. (The sidebar used to get a smaller one via app.css
 * overrides, then briefly via an `sm` prop; both meant the same component
 * rendered at different scales depending on where it landed.)
 */
export default function Badge({ kind = 'default', className, children, ...rest }: ChipProps) {
  return (
    <span className={`${KIND_CLASS[kind]} ${className ?? ''}`.trim()} {...rest}>
      {children}
    </span>
  );
}
