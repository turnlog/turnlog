import { useEffect, useId, useRef, useState } from 'react';

export interface DropdownOption {
  value: string;
  label: string;
}

/**
 * Custom single-select (native <select> can't be styled to match the card
 * language). Listbox pattern: focus stays on the trigger; the active option
 * is conveyed via aria-activedescendant.
 */
export default function Dropdown({
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const id = useId();

  const selected = options.find((o) => o.value === value);

  const openMenu = () => {
    const i = options.findIndex((o) => o.value === value);
    setActive(i === -1 ? 0 : i);
    setOpen(true);
  };

  const select = (v: string) => {
    setOpen(false);
    if (v !== value) onChange(v);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    menuRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActive((a) => Math.min(a + 1, options.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
        break;
      case 'Home':
        e.preventDefault();
        setActive(0);
        break;
      case 'End':
        e.preventDefault();
        setActive(options.length - 1);
        break;
      case 'Enter':
      case ' ': {
        e.preventDefault();
        const option = options[active];
        if (option) select(option.value);
        break;
      }
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        break;
      case 'Tab':
        setOpen(false);
        break;
    }
  };

  return (
    <div ref={rootRef} className={`dd ${open ? 'open' : ''} ${className ?? ''}`}>
      <button
        type="button"
        className="dd-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
      >
        <span className="dd-label">{selected?.label ?? value}</span>
        <svg className="dd-caret" width="10" height="10" viewBox="0 0 24 24" aria-hidden>
          <path
            d="M5 9l7 7 7-7"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && (
        <ul ref={menuRef} className="dd-menu" role="listbox" aria-label={ariaLabel}>
          {options.map((o, i) => (
            <li
              key={o.value}
              id={`${id}-${i}`}
              data-index={i}
              role="option"
              aria-selected={o.value === value}
              className={`dd-option ${i === active ? 'active' : ''} ${o.value === value ? 'selected' : ''}`}
              onMouseDown={(e) => e.preventDefault() /* keep focus on the trigger */}
              onClick={() => select(o.value)}
              onMouseEnter={() => setActive(i)}
            >
              <span className="dd-option-label">{o.label}</span>
              {o.value === value && (
                <svg className="dd-check" width="11" height="11" viewBox="0 0 24 24" aria-hidden>
                  <path
                    d="M4 12.5l5.5 5.5L20 6.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
