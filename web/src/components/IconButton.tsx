import type { ButtonHTMLAttributes, ReactNode } from 'react';
import Tooltip from './Tooltip';
import './IconButton.css';

/**
 * The one component behind every round icon-only button inside the app — on
 * cards, in sidebars, along toolbar rows. One size, 34px, and four fills
 * chosen by the ground underneath rather than by importance:
 *
 *   quiet   — --bg2, the default, on a card
 *   card    — --card, on the bare app background, where --bg2 all but
 *             disappears in the light theme. The same pairing Primary makes
 *   inset   — --bg1, one surface down, for controls already on --bg2 ground
 *   ghost   — transparent until hovered, and the one exception to the size:
 *             26px, because it rides inside list rows and floating nav pills
 *             where a 34 crowds the row
 *
 * `active` is the contrast fill, the same statement Primary makes — a toggle
 * that is on should look like the one thing on the surface that is on, not
 * like a slightly darker version of hover.
 *
 * The 44px buttons in the app frame are a different type: they share their
 * metrics with the header's nav pills and the hero CTA, so they all live in
 * components/Primary.tsx.
 *
 * `label` is mandatory: an icon-only button without an accessible name is a
 * defect, not an option. Pass `tooltip` (and optionally `shortcut`) to get
 * the standard hover pill without hand-wrapping in <Tooltip>.
 */
export type IconFill = 'quiet' | 'card' | 'inset' | 'ghost';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  fill?: IconFill;
  active?: boolean;
  tooltip?: ReactNode;
  shortcut?: string[];
  children: ReactNode;
}

export default function IconButton({
  label,
  fill = 'quiet',
  active,
  tooltip,
  shortcut,
  className,
  children,
  ...rest
}: IconButtonProps) {
  const cls = ['icon-btn', fill === 'quiet' ? '' : fill, active ? 'on' : '', className ?? '']
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
