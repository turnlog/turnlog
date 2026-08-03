import type { ReactNode } from 'react';
import './Facts.css';

/**
 * A short list of label/value pairs — the one way Turnlog presents a set of
 * measurements about something.
 *
 * Run together on one line (`10:37–16:02 · 2,355 turns · 504k tok · $137.08`)
 * a reader has to parse which number is which; stacked and labelled, each
 * value is where the eye expects it and the column of figures can be
 * compared down the page. Values are mono because every one of them is
 * measured, labels are dim because they are the same on every row.
 *
 * Used by every tooltip that carries facts, and by the sidebar's info button.
 */
export default function Facts({
  rows,
}: {
  rows: { label: string; value: ReactNode }[];
}) {
  return (
    <span className="facts">
      {rows.map((r) => (
        <span key={r.label} className="facts-row">
          <span className="facts-label">{r.label}</span>
          <span className="facts-value">{r.value}</span>
        </span>
      ))}
    </span>
  );
}
