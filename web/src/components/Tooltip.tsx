import {
  cloneElement,
  useState,
  type MouseEvent,
  type FocusEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

/**
 * Design-system tooltip: a contrast pill floated over the trigger, replacing
 * the browser's native `title` (slow, unstyled, no rich content). Clones a
 * single child element and attaches hover/focus handlers — no wrapper box, so
 * absolutely-positioned triggers (calendar blocks) keep their layout.
 */
interface Pos {
  x: number;
  y: number;
  below: boolean;
}

export default function Tooltip({
  content,
  children,
}: {
  content: ReactNode;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  children: ReactElement<any>;
}) {
  const [pos, setPos] = useState<Pos | null>(null);

  const show = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const below = r.top < 96; // not enough room above → drop below
    setPos({
      x: Math.min(Math.max(r.left + r.width / 2, 110), window.innerWidth - 110),
      y: below ? r.bottom + 8 : r.top - 8,
      below,
    });
  };
  const hide = () => setPos(null);

  const props = children.props;
  const trigger = cloneElement(children, {
    onMouseEnter: (e: MouseEvent<HTMLElement>) => {
      show(e.currentTarget);
      props.onMouseEnter?.(e);
    },
    onMouseLeave: (e: MouseEvent<HTMLElement>) => {
      hide();
      props.onMouseLeave?.(e);
    },
    onFocus: (e: FocusEvent<HTMLElement>) => {
      show(e.currentTarget);
      props.onFocus?.(e);
    },
    onBlur: (e: FocusEvent<HTMLElement>) => {
      hide();
      props.onBlur?.(e);
    },
  });

  return (
    <>
      {trigger}
      {pos &&
        createPortal(
          <div
            className={`tooltip ${pos.below ? 'below' : 'above'}`}
            style={{ left: pos.x, top: pos.y }}
            role="tooltip"
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}
