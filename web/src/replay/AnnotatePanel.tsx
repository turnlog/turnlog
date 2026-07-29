import { useState } from 'react';
import { useSetSessionMeta } from '../api';
import { projectName } from '../format';
import type { SessionMeta } from '../types';

/** Name + note editor for a session's user annotations. */
export default function AnnotatePanel({ s, onClose }: { s: SessionMeta; onClose: () => void }) {
  const [name, setName] = useState(s.customName ?? '');
  const [note, setNote] = useState(s.note ?? '');
  const setMeta = useSetSessionMeta();
  const save = () => {
    setMeta.mutate(
      { id: s.id, patch: { customName: name || null, note: note || null } },
      { onSuccess: onClose },
    );
  };
  return (
    <div className="annotate-panel">
      <label className="annotate-field">
        <span className="annotate-label">Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={projectName(s)}
          maxLength={200}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') onClose();
          }}
        />
      </label>
      <label className="annotate-field">
        <span className="annotate-label">Note</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Anything future-you should know about this session…"
          rows={3}
          maxLength={4000}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
          }}
        />
      </label>
      <div className="annotate-actions">
        <button className="pill" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-accent annotate-save" onClick={save} disabled={setMeta.isPending}>
          Save
        </button>
      </div>
    </div>
  );
}
