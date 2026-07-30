import type { ButtonHTMLAttributes, ReactNode } from 'react';
import './Button.css';

/**
 * Text action button (with optional leading icon). Two families:
 *
 *   default/`primary` — compact r10 popover/card actions (copy, download);
 *     primary is the contrast-filled call to action, at most one per surface.
 *   `pill` — the gray inset pill for quiet screen-level actions (exports,
 *     "This week", maintenance).
 */
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  primary?: boolean;
  pill?: boolean;
  children: ReactNode;
}

export default function Button({ primary, pill, className, children, ...rest }: ButtonProps) {
  const base = pill ? 'pill' : `btn ${primary ? 'primary' : ''}`;
  return (
    <button className={`${base} ${className ?? ''}`.trim()} {...rest}>
      {children}
    </button>
  );
}
