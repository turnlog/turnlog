import { useEffect, useRef, useState } from 'react';
import { useSetSessionTags, useTags } from '../api';
import { CloseIcon, PlusIcon } from '../icons';
import Badge from './Badge';
import IconButton from './IconButton';
import SearchField from './SearchField';
import './TagEditor.css';

/**
 * Free-form labels on a session — the organisation layer above pins, which
 * are one bit. Edits the whole set and writes it in one go, so a dropped
 * request cannot leave half an edit applied.
 *
 * Every control here is a system primitive: the chip is a Badge at its one
 * size, the × and + are ghost IconButtons (shrunk by an ancestor-scoped
 * override, which is the sanctioned way to fit a ghost into a dense row), and
 * the field is a real `sm` SearchField rather than a hand-rolled input.
 *
 * Tags belong to the session, not to the agent that wrote it: a Codex session
 * and a Claude Code session take the same labels, which is the point of one
 * timeline per repo.
 */
export default function TagEditor({ sessionId, tags }: { sessionId: string; tags: string[] }) {
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const setTags = useSetSessionTags();
  const all = useTags();

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const commit = (raw: string) => {
    const next = raw.trim();
    if (next === '') return;
    // The server normalises too; this only keeps the UI from showing a
    // duplicate for the instant before the round trip lands.
    if (!tags.some((t) => t.toLowerCase() === next.toLowerCase())) {
      setTags.mutate({ id: sessionId, tags: [...tags, next] });
    }
    setDraft('');
  };

  const remove = (tag: string) =>
    setTags.mutate({ id: sessionId, tags: tags.filter((t) => t !== tag) });

  // Tags already on this session are not worth suggesting again.
  const suggestions = (all.data?.tags ?? [])
    .map((t) => t.tag)
    .filter((t) => !tags.includes(t) && (draft === '' || t.includes(draft.trim().toLowerCase())))
    .slice(0, 6);

  return (
    <div className="tag-editor">
      {tags.map((tag) => (
        <Badge key={tag} className="tag-badge">
          {tag}
          <IconButton
            fill="ghost"
            className="tag-remove"
            label={`Remove tag ${tag}`}
            onClick={() => remove(tag)}
          >
            <CloseIcon />
          </IconButton>
        </Badge>
      ))}

      {open ? (
        <span className="tag-input-wrap">
          <SearchField
            size="sm"
            className="tag-field"
            value={draft}
            onChange={setDraft}
            ariaLabel="Add a tag"
            placeholder="tag…"
            maxLength={32}
            inputRef={inputRef}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit(draft);
              // Comma is how people type lists; treat it as a separator so a
              // pasted "a, b" does not become one tag called "a, b".
              if (e.key === ',') {
                e.preventDefault();
                commit(draft);
              }
              if (e.key === 'Escape') {
                setDraft('');
                setOpen(false);
              }
              if (e.key === 'Backspace' && draft === '' && tags.length > 0) {
                remove(tags[tags.length - 1]!);
              }
            }}
            onBlur={() => {
              commit(draft);
              setOpen(false);
            }}
          />
          {suggestions.length > 0 && (
            <span className="tag-suggest" role="listbox" aria-label="Existing tags">
              {suggestions.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="option"
                  aria-selected={false}
                  // onMouseDown, not onClick: the field's blur would fire
                  // first and close the list before a click could land.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    commit(t);
                  }}
                >
                  <Badge>{t}</Badge>
                </button>
              ))}
            </span>
          )}
        </span>
      ) : tags.length === 0 ? (
        // Empty state names the action — a bare + explains nothing when there
        // is no chip beside it to give it context. Text-only button, the same
        // quiet inline voice as "reset filters".
        <button className="tag-add-text" onClick={() => setOpen(true)}>
          add tags
        </button>
      ) : (
        <IconButton
          fill="ghost"
          className="tag-add"
          label="Add a tag"
          onClick={() => setOpen(true)}
        >
          <PlusIcon />
        </IconButton>
      )}
    </div>
  );
}
