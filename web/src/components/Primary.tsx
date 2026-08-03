import type { MouseEventHandler, ReactNode } from 'react';
import Tooltip from './Tooltip';
import './Primary.css';

/**
 * Primary — the app frame's button, and the one type behind every instance of
 * it: the header's nav pills and round icon buttons, the sidebar toggle, the
 * hero call to action, the stop button. One height, one padding, one font
 * size, one icon size. A circle is this button with no visible label.
 *
 * Only the fill varies, and each one means something:
 *
 *   card      the rest fill, on the app background
 *   quiet     one surface up: the dismissive half of a pair (Cancel beside
 *             Save), and any frame button standing on a card rather than on
 *             the background, where a --card fill would vanish
 *   contrast  "you are here" — route-active nav
 *   accent    the call to action, at most one per screen
 *   danger    the armed half of an arm-then-confirm
 *
 * Half the family are links, so `href` renders an <a>. `active` sets the
 * contrast fill and `aria-current` together — a route-active button that
 * forgets one of the two is the bug the prop exists to prevent.
 *
 * The smaller round buttons — 34px inside cards, 32px in toolbar rows, 26px
 * on row hover — are a different family: components/IconButton.tsx.
 */
export type PrimaryFill = 'card' | 'quiet' | 'contrast' | 'accent' | 'danger';

interface Common {
  fill?: PrimaryFill;
  /** Leading icon: says what the button is. */
  icon?: ReactNode;
  /** Trailing icon: says the button moves you forward. */
  trailing?: ReactNode;
  /** Route-active — contrast fill plus `aria-current="page"` on links. */
  active?: boolean;
  /** Renders an <a> instead of a <button>. */
  href?: string;
  tooltip?: ReactNode;
  /** Keycaps under the tooltip label, e.g. ['⇧', 'Q']. */
  shortcut?: string[];
  className?: string;
  onClick?: MouseEventHandler<HTMLElement>;
  disabled?: boolean;
  type?: 'button' | 'submit';
}

/** Visible text names the button; `label` then only overrides the a11y name. */
type Labelled = Common & { children: ReactNode; label?: string };
/** No visible text, so the accessible name is mandatory, not optional. */
type IconOnly = Common & { children?: undefined; label: string };

export default function Primary({
  fill = 'card',
  icon,
  trailing,
  active,
  href,
  tooltip,
  shortcut,
  className,
  label,
  children,
  ...rest
}: Labelled | IconOnly) {
  const cls = [
    'primary-btn',
    active ? 'contrast' : fill === 'card' ? '' : fill,
    children === undefined ? 'round' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  const content = (
    <>
      {icon}
      {children}
      {trailing}
    </>
  );

  const el = href ? (
    <a
      href={href}
      className={cls}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      onClick={rest.onClick}
    >
      {content}
    </a>
  ) : (
    <button className={cls} aria-label={label} {...rest}>
      {content}
    </button>
  );

  return tooltip ? (
    <Tooltip content={tooltip} shortcut={shortcut}>
      {el}
    </Tooltip>
  ) : (
    el
  );
}
