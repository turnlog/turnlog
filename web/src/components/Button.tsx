import type { ButtonHTMLAttributes, ReactNode } from 'react';
import './Button.css';

/**
 * The quiet screen-level text action: exports, maintenance, "This week".
 * One shape — a gray inset pill — because that is all this button ever was
 * once the compact card/popover pair moved to Primary.
 *
 * Anything that needs weight is a Primary: it carries the fills (accent for a
 * call to action, contrast for the one emphasis on a surface) and the frame's
 * metrics. This is what is left when an action wants to be available without
 * asking for attention.
 *
 * `fill` picks the ground the same way Primary, IconButton and Segmented do:
 * quiet (--bg2) on a card, card (--card) on the bare app background, where
 * --bg2 all but disappears in the light theme.
 */
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  fill?: 'quiet' | 'card';
};

export default function Button({ fill = 'quiet', className, children, ...rest }: ButtonProps) {
  return (
    <button
      className={`pill ${fill === 'card' ? 'on-bg' : ''} ${className ?? ''}`.trim()}
      {...rest}
    >
      {children}
    </button>
  );
}
