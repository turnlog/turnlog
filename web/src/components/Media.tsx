import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, PlayCircleIcon } from '../icons';
import IconButton from './IconButton';
import Overlay from './Overlay';
import './Media.css';

/**
 * Images and videos in a replay — pasted, returned by a tool, or named by
 * path. Thumbnails are a fixed height, so a row never grows when one finishes
 * decoding (the log is virtualized); full size opens in a viewer instead.
 */
export interface MediaItem {
  src: string;
  kind: 'image' | 'video';
  /** File path or a description — the caption. */
  name: string;
  /** Decoded size of an inline image; unknown for a file on disk. */
  bytes?: number;
  /** Named on purpose (a tool argument): a missing file is said out loud. */
  explicit: boolean;
}

export function baseName(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p;
}

export function MediaThumb({
  item,
  onOpen,
  onFail,
}: {
  item: MediaItem;
  onOpen: () => void;
  onFail: () => void;
}) {
  const tag = item.bytes !== undefined
    ? `${Math.max(1, Math.round(item.bytes / 1024))} KB`
    : baseName(item.name);
  return (
    <button
      type="button"
      className={`media-thumb ${item.kind}`}
      onClick={onOpen}
      aria-label={`View ${item.kind}: ${baseName(item.name)}`}
    >
      {item.kind === 'image' ? (
        <img src={item.src} alt="" loading="lazy" onError={onFail} />
      ) : (
        // #t=0.1 asks for the first frame, so the thumb is a still, not black.
        <video src={`${item.src}#t=0.1`} preload="metadata" muted playsInline onError={onFail} />
      )}
      {item.kind === 'video' && (
        <span className="media-play" aria-hidden>
          <PlayCircleIcon size={22} />
        </span>
      )}
      <span className="media-tag">{tag}</span>
    </button>
  );
}

export function MediaStrip({ items }: { items: MediaItem[] }) {
  const [openAt, setOpenAt] = useState<number | null>(null);
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  if (items.length === 0) return null;
  const live = items.filter((m) => !failed.has(m.src));
  const fail = (src: string) => setFailed((prev) => new Set(prev).add(src));
  return (
    <div className="media-strip">
      {items.map((m) =>
        failed.has(m.src) ? (
          // Spotted in prose and gone: say nothing. Named on purpose: say so.
          m.explicit ? (
            <span key={m.src} className="media-missing" title={m.name}>
              not on disk · {baseName(m.name)}
            </span>
          ) : null
        ) : (
          <MediaThumb
            key={m.src}
            item={m}
            onOpen={() => setOpenAt(live.indexOf(m))}
            onFail={() => fail(m.src)}
          />
        ),
      )}
      {openAt !== null && live.length > 0 && (
        <MediaViewer items={live} start={openAt} onClose={() => setOpenAt(null)} />
      )}
    </div>
  );
}

export function MediaViewer({
  items,
  start,
  onClose,
}: {
  items: MediaItem[];
  start: number;
  onClose: () => void;
}) {
  const [at, setAt] = useState(Math.min(Math.max(start, 0), items.length - 1));
  const n = items.length;
  const item = items[at]!;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') setAt((i) => (i - 1 + n) % n);
      if (e.key === 'ArrowRight') setAt((i) => (i + 1) % n);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [n]);

  // Portaled: a fixed overlay inside a virtualized row inherits its clipping.
  return createPortal(
    <Overlay onClose={onClose} center>
      <div className="media-viewer" role="dialog" aria-label={`${item.kind}: ${baseName(item.name)}`}>
        <div className="media-viewer-head">
          <span className="media-viewer-name" title={item.name}>
            {item.name}
          </span>
          {n > 1 && (
            <span className="media-viewer-count">
              {at + 1} / {n}
            </span>
          )}
          <IconButton label="Close" tooltip="Close" shortcut={['Esc']} onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </div>
        <div className="media-viewer-stage">
          {item.kind === 'image' ? (
            <img key={item.src} src={item.src} alt={baseName(item.name)} />
          ) : (
            <video key={item.src} src={item.src} controls autoPlay playsInline />
          )}
        </div>
        {n > 1 && (
          <div className="media-viewer-nav">
            <IconButton label="Previous" tooltip="Previous" shortcut={['←']} onClick={() => setAt((at - 1 + n) % n)}>
              <ChevronLeftIcon />
            </IconButton>
            <IconButton label="Next" tooltip="Next" shortcut={['→']} onClick={() => setAt((at + 1) % n)}>
              <ChevronRightIcon />
            </IconButton>
          </div>
        )}
      </div>
    </Overlay>,
    document.body,
  );
}
