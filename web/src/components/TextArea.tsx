import type { TextareaHTMLAttributes } from 'react';
import './TextArea.css';

/**
 * Multi-line text field — session notes today, anything longer than a line
 * tomorrow. The inset sibling of SearchField: same ground, same radius, same
 * focus ring, so a form mixing the two reads as one set of fields.
 *
 * Vertical resize only. Horizontal resize would break out of whatever column
 * the field is laid into, and a text field is not a layout control.
 */
interface TextAreaProps extends Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'value' | 'onChange'
> {
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
  className?: string;
}

export default function TextArea({
  value,
  onChange,
  ariaLabel,
  className,
  rows = 3,
  ...rest
}: TextAreaProps) {
  return (
    <textarea
      className={`textarea ${className ?? ''}`.trim()}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={ariaLabel}
      rows={rows}
      {...rest}
    />
  );
}
