import { useEffect, useState, type ReactNode } from 'react';
import { useTheme } from '../theme';

/** Shared scaffolding for the two internal design-system pages. */

export interface TokenSpec {
  token: string;
  use: string;
}

export function Section({
  id,
  title,
  note,
  children,
}: {
  id: string;
  title: string;
  note: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="ds-section">
      <header className="ds-section-head">
        <h2>{title}</h2>
        <p>{note}</p>
      </header>
      {children}
    </section>
  );
}

export function Group({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <div className="ds-group">
      <div className="ds-group-head">
        <h3>{title}</h3>
        {note && <span>{note}</span>}
      </div>
      {children}
    </div>
  );
}

/** One specimen: the live thing on the left, what it is on the right. */
export function Row({
  name,
  note,
  children,
}: {
  name: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <div className="ds-row">
      <div className="ds-row-demo">{children}</div>
      <div className="ds-row-spec">
        <span className="ds-row-name">{name}</span>
        {note && <span className="ds-row-note">{note}</span>}
      </div>
    </div>
  );
}

/** `tokens` lands in a dependency array — pass a module-level constant. */
export function useTokenValues(tokens: string[]): Record<string, string> {
  const theme = useTheme();
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    const cs = getComputedStyle(document.documentElement);
    const next: Record<string, string> = {};
    for (const t of tokens) next[t] = cs.getPropertyValue(t).trim();
    setValues(next);
  }, [theme, tokens]);
  return values;
}

/** As above, but resolved against an element — for theme-scoped subtrees. */
export function useScopedTokenValues(
  el: HTMLElement | null,
  tokens: string[],
): Record<string, string> {
  const theme = useTheme();
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!el) return;
    const cs = getComputedStyle(el);
    const next: Record<string, string> = {};
    for (const t of tokens) next[t] = cs.getPropertyValue(t).trim();
    setValues(next);
  }, [theme, el, tokens]);
  return values;
}

export function Swatch({
  spec,
  value,
  mode,
}: {
  spec: TokenSpec;
  value?: string;
  mode?: 'fill' | 'ink';
}) {
  return (
    <div className="ds-swatch">
      <span
        className="ds-badge"
        style={
          mode === 'ink'
            ? { background: 'var(--card)', color: `var(${spec.token})` }
            : { background: `var(${spec.token})` }
        }
        aria-hidden
      >
        {mode === 'ink' ? 'Aa' : ''}
      </span>
      <span className="ds-swatch-meta">
        <span className="ds-swatch-name">{spec.token}</span>
        <span className="ds-swatch-value">{value || '—'}</span>
        <span className="ds-swatch-use">{spec.use}</span>
      </span>
    </div>
  );
}
