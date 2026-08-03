import type { InputHTMLAttributes, KeyboardEvent, Ref } from 'react';
import { CloseIcon, MagniferIcon } from '../icons';
import './SearchField.css';

/**
 * Text-filter input — the sidebar quick filter, the search screen's query
 * box, and the home hero input are all this one field. The wrapper carries
 * the surface and the focus ring; sizes:
 *
 *   sm — inset row inside a card (bg1, 13px)
 *   lg — a screen's primary query box (card surface, 15px)
 */
interface SearchFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'size' | 'onKeyDown'> {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  size?: 'sm' | 'lg';
  /** Magnifier glyph at the left edge. */
  icon?: boolean;
  /** Show a clear (×) button while non-empty. */
  clearable?: boolean;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  inputRef?: Ref<HTMLInputElement>;
  className?: string;
}

export default function SearchField({
  value,
  onChange,
  ariaLabel,
  size = 'sm',
  icon,
  clearable,
  onKeyDown,
  inputRef,
  className,
  ...rest
}: SearchFieldProps) {
  return (
    <div className={`search-field search-field-${size} ${className ?? ''}`.trim()}>
      {icon && <MagniferIcon size={size === 'sm' ? 13 : 15} />}
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        aria-label={ariaLabel}
        {...rest}
      />
      {clearable && value !== '' && (
        <button
          className="search-field-clear"
          onClick={() => onChange('')}
          aria-label={`Clear ${ariaLabel.toLowerCase()}`}
        >
          <CloseIcon size={size === 'sm' ? 12 : 14} />
        </button>
      )}
    </div>
  );
}
