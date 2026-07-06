import {
  cloneElement,
  useLayoutEffect,
  useRef,
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
  x: number; // trigger center; the pill is centered on this
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
  const [left, setLeft] = useState<number | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  // Clamp the pill inside the viewport using its *measured* width, so triggers
  // in the screen corners (header sidebar-toggle, status circle) keep a tooltip
  // anchored under them instead of snapping toward center. Runs before paint,
  // so there's no visible flash from the raw → clamped correction.
  useLayoutEffect(() => {
    if (!pos || !tipRef.current) return;
    const half = tipRef.current.offsetWidth / 2;
    const m = 8; // viewport margin
    setLeft(Math.min(Math.max(pos.x, half + m), window.innerWidth - half - m));
  }, [pos]);

  const show = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const below = r.top < 96; // not enough room above → drop below
    setLeft(null); // remeasure for the new trigger
    setPos({
      x: r.left + r.width / 2,
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
            ref={tipRef}
            className={`tooltip ${pos.below ? 'below' : 'above'}`}
            style={{
              left: left ?? pos.x,
              top: pos.y,
              visibility: left === null ? 'hidden' : 'visible',
            }}
            role="tooltip"
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}
