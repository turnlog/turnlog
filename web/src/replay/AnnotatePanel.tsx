import Primary from '../components/Primary';
import TextArea from '../components/TextArea';
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
        <TextArea
          value={note}
          onChange={setNote}
          placeholder="Anything future-you should know about this session…"
          maxLength={4000}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
          }}
        />
      </label>
      <div className="annotate-actions">
        <Primary fill="quiet" onClick={onClose}>
          Cancel
        </Primary>
        <Primary fill="accent" onClick={save} disabled={setMeta.isPending}>
          Save
        </Primary>
      </div>
    </div>
  );
}
