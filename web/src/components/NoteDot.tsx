import Tooltip from './Tooltip';

/**
 * A saved note surfaces as a floating yellow dot; hovering (or focusing) it
 * lifts the note itself as a sticky-note popover. The same affordance is used
 * in the sidebar list and the replay header.
 */
export default function NoteDot({ note }: { note: string }) {
  return (
    <Tooltip className="note-tip" content={note}>
      <span className="note-dot" tabIndex={0} role="note" aria-label={`Note: ${note}`} />
    </Tooltip>
  );
}
