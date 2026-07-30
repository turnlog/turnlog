import type { ButtonHTMLAttributes, ReactNode } from 'react';
import Tooltip from './Tooltip';
import './IconButton.css';

/**
 * The one component behind every round icon-only button. Three variants map
 * to the three surfaces the app puts round buttons on:
 *
 *   header  — 44px on the app background (class `circle`, `circle-sm` at 34px)
 *   control — 34px inside sidebars/cards   (class `dir-toggle`)
 *   action  — 32px toolbar rows            (class `replay-action`)
 *   ghost   — 26px quiet inline button     (class `icon-ghost`): transparent
 *             at rest, for row hovers and floating nav pills. Dense contexts
 *             may shrink it with an ancestor-scoped size override.
 *
 * `label` is mandatory: an icon-only button without an accessible name is a
 * defect, not an option. Pass `tooltip` (and optionally `shortcut`) to get
 * the standard hover pill without hand-wrapping in <Tooltip>.
 */
const VARIANT_CLASS = {
  header: 'circle',
  control: 'dir-toggle',
  action: 'replay-action',
  ghost: 'icon-ghost',
} as const;

/** Each family spells its pressed state differently — normalize behind one prop. */
const ACTIVE_CLASS = { header: 'active', control: 'on', action: 'active', ghost: 'on' } as const;

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  variant?: keyof typeof VARIANT_CLASS;
  /** header only: the 34px version. */
  small?: boolean;
  active?: boolean;
  tooltip?: ReactNode;
  shortcut?: string[];
  children: ReactNode;
}

export default function IconButton({
  label,
  variant = 'header',
  small,
  active,
  tooltip,
  shortcut,
  className,
  children,
  ...rest
}: IconButtonProps) {
  const cls = [
    VARIANT_CLASS[variant],
    small && variant === 'header' ? 'circle-sm' : '',
    active ? ACTIVE_CLASS[variant] : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  const btn = (
    <button className={cls} aria-label={label} {...rest}>
      {children}
    </button>
  );
  return tooltip ? (
    <Tooltip content={tooltip} shortcut={shortcut}>
      {btn}
    </Tooltip>
  ) : (
    btn
  );
}
