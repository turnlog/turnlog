import { useEffect, useRef, useState } from 'react';
import { useSetSessionTags, useTags } from '../api';
import { CloseIcon } from '../icons';
import Badge from './Badge';
import Button from './Button';
import IconButton from './IconButton';
import './TagEditor.css';

/**
 * Free-form labels on a session — the organisation layer above pins, which
 * are one bit. Edits the whole set and writes it in one go, so a dropped
 * request cannot leave half an edit applied.
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
            <CloseIcon size={10} />
          </IconButton>
        </Badge>
      ))}

      {open ? (
        <span className="tag-input-wrap">
          <input
            ref={inputRef}
            className="tag-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="tag…"
            maxLength={32}
            aria-label="Add a tag"
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
                  // onMouseDown, not onClick: the input's blur would fire
                  // first and close the list before a click could land.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    commit(t);
                  }}
                >
                  {t}
                </button>
              ))}
            </span>
          )}
        </span>
      ) : (
        <Button className="tag-add" onClick={() => setOpen(true)}>
          {tags.length === 0 ? 'add tags' : '+'}
        </Button>
      )}
    </div>
  );
}
