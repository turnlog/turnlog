import { useEffect, useRef, useState } from 'react';
import { fmtCount } from '../format';
import { CloseIcon } from '../icons';
import { navigate, sessionHash } from '../router';

/** In-session find: drives the same ?q= the global search uses. */
export default function FindBar({
  sessionId,
  query,
  hitIdxs,
  onClose,
  onCycle,
}: {
  sessionId: string;
  query: string;
  hitIdxs: number[];
  onClose: () => void;
  /** Enter / ⇧Enter — next / previous match relative to the current jump. */
  onCycle: (dir: 1 | -1) => void;
}) {
  const [value, setValue] = useState(query);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Debounce into the URL — q is the single source of find state.
  useEffect(() => {
    if (value.trim() === query) return;
    const t = setTimeout(() => {
      navigate(
        value.trim()
          ? sessionHash(sessionId, { q: value.trim() })
          : sessionHash(sessionId),
      );
    }, 250);
    return () => clearTimeout(t);
  }, [value, query, sessionId]);

  return (
    <div className="find-bar">
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          } else if (e.key === 'Enter' && hitIdxs.length > 0) {
            e.preventDefault();
            onCycle(e.shiftKey ? -1 : 1);
          }
        }}
        placeholder="Find in this session…"
        aria-label="Find in session"
      />
      <span className="find-count">
        {query ? `${fmtCount(hitIdxs.length)} hit${hitIdxs.length === 1 ? '' : 's'}` : ''}
      </span>
      <button onClick={onClose} aria-label="Close find">
        <CloseIcon size={14} />
      </button>
    </div>
  );
}
