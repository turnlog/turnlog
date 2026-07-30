import type { ReactNode } from 'react';
import './Segmented.css';

/**
 * Segmented control — the pill track with one pressed segment (view toggles,
 * share-panel format/redact rows, the sidebar's empty-sessions switch).
 * Single-select; clicking the active segment is a no-op.
 */
export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
  /** Native title — for disabled segments that need a why. */
  title?: string;
}

export default function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: {
  /** '' = nothing selected (e.g. a lens has taken over the view). */
  value: T | '';
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div className={`view-toggle ${className ?? ''}`} role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'active' : ''}
          disabled={o.disabled}
          title={o.title}
          onClick={() => {
            if (o.value !== value) onChange(o.value);
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
