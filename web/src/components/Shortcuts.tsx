import { useEffect, useState } from 'react';
import { SHIFT, SHORTCUTS, isTyping } from '../keys';
import { APP_EVENT, onAppEvent } from '../events';
import Overlay from './Overlay';

/**
 * The keyboard cheat sheet: `?` anywhere (outside an input) opens it; the
 * palette links here too via the `turnlog:shortcuts` window event. One
 * static card — shortcuts should be scannable, not searchable.
 */

interface Row {
  label: string;
  keys: string[][];
}

const GROUPS: { title: string; rows: Row[] }[] = [
  {
    title: 'Everywhere',
    rows: [
      { label: 'Command palette', keys: [SHORTCUTS.palette] },
      { label: 'Search everything', keys: [SHORTCUTS.search] },
      { label: 'Toggle sidebar', keys: [SHORTCUTS.sidebar] },
      { label: 'Switch theme', keys: [SHORTCUTS.theme] },
      { label: 'Stop Turnlog (press twice)', keys: [SHORTCUTS.stop] },
      { label: 'Keyboard shortcuts', keys: [SHORTCUTS.sheet] },
      { label: 'Close / dismiss', keys: [['esc']] },
    ],
  },
  {
    title: 'Search results',
    rows: [
      { label: 'Move through hits', keys: [['↑'], ['↓']] },
      { label: 'Open the active hit', keys: [['enter']] },
    ],
  },
  {
    title: 'Session replay',
    rows: [
      { label: 'Find in session', keys: [SHORTCUTS.find] },
      { label: 'Next match (in find)', keys: [['enter']] },
      { label: 'Previous match (in find)', keys: [[SHIFT, 'enter']] },
    ],
  },
];

export default function Shortcuts() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '?' && !e.metaKey && !e.ctrlKey && !isTyping(e.target)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    const offOpen = onAppEvent(APP_EVENT.shortcuts, () => setOpen(true));
    return () => {
      window.removeEventListener('keydown', onKey);
      offOpen();
    };
  }, []);

  if (!open) return null;

  return (
    <Overlay onClose={() => setOpen(false)}>
      <div className="shortcuts" role="dialog" aria-label="Keyboard shortcuts">
        <div className="shortcuts-head">
          <span className="shortcuts-title">Keyboard shortcuts</span>
          <kbd>esc</kbd>
        </div>
        <div className="shortcuts-groups">
          {GROUPS.map((g) => (
            <section key={g.title} className="shortcuts-group">
              <h3>{g.title}</h3>
              {g.rows.map((r) => (
                <div key={r.label} className="shortcuts-row">
                  <span className="shortcuts-label">{r.label}</span>
                  <span className="shortcuts-keys">
                    {r.keys.map((combo, i) => (
                      <span key={i} className="shortcuts-combo">
                        {combo.map((k, j) => (
                          <kbd key={j}>{k}</kbd>
                        ))}
                      </span>
                    ))}
                  </span>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </Overlay>
  );
}
