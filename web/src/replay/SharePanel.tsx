import { useEffect, useRef, useState } from 'react';
import { fetchExport, useTurns } from '../api';
import Tooltip from '../components/Tooltip';
import { CheckIcon, CopyIcon, DownloadIcon, ShareIcon } from '../icons';

/**
 * Share panel: one popover for every way a session leaves the app — format,
 * an optional turn range (share the fix, not the 1,800-turn session), and a
 * redact toggle with its scrub list spelled out so nothing is scrubbed (or
 * kept) silently.
 */
export default function SharePanel({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<'markdown' | 'html'>('markdown');
  const [redact, setRedact] = useState(false);
  const [whole, setWhole] = useState(true);
  const [fromTurn, setFromTurn] = useState(1);
  const [toTurn, setToTurn] = useState(1);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const turns = useTurns(sessionId);
  const turnList = turns.data?.turns ?? [];
  const turnCount = turnList.length;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const openPanel = () => {
    setFromTurn(1);
    setToTurn(Math.max(1, turnCount));
    setWhole(true);
    setOpen(true);
  };

  const clampTurn = (n: number) => Math.min(Math.max(1, n), Math.max(1, turnCount));
  const idxRange = (): { fromIdx?: number; toIdx?: number } => {
    if (whole || turnCount === 0) return {};
    const a = clampTurn(Math.min(fromTurn, toTurn)) - 1;
    const b = clampTurn(Math.max(fromTurn, toTurn)) - 1;
    // endIdx is exclusive (the next turn's start); the export bound is inclusive.
    return { fromIdx: turnList[a]!.idx, toIdx: turnList[b]!.endIdx - 1 };
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        await fetchExport(sessionId, { format, redact, ...idxRange() }),
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard denied — ignore */
    }
  };
  const download = async () => {
    const body = await fetchExport(sessionId, { format, redact, ...idxRange() }).catch(() => null);
    if (body === null) return;
    const [type, ext] = format === 'html' ? ['text/html', 'html'] : ['text/markdown', 'md'];
    const rangeTag = whole || turnCount === 0 ? '' : `-t${clampTurn(fromTurn)}-${clampTurn(toTurn)}`;
    const url = URL.createObjectURL(new Blob([body], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sessionId.slice(0, 8)}${rangeTag}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const turnInput = (value: number, set: (n: number) => void, label: string) => (
    <input
      type="number"
      className="share-num"
      min={1}
      max={Math.max(1, turnCount)}
      value={value}
      aria-label={label}
      onChange={(e) => set(clampTurn(Number(e.target.value) || 1))}
      onFocus={(e) => e.currentTarget.select()}
    />
  );

  return (
    <div className="share-wrap" ref={rootRef}>
      <Tooltip content="Share / export">
        <button
          className={`replay-action ${open ? 'active' : ''}`}
          onClick={() => (open ? setOpen(false) : openPanel())}
          aria-label="Share or export this session"
          aria-expanded={open}
        >
          <ShareIcon size={16} />
        </button>
      </Tooltip>
      {open && (
        <div className="share-pop" role="dialog" aria-label="Share this session">
          <div className="share-row">
            <span className="share-label">format</span>
            <div className="view-toggle share-seg">
              <button
                className={format === 'markdown' ? 'active' : ''}
                onClick={() => setFormat('markdown')}
              >
                markdown
              </button>
              <button className={format === 'html' ? 'active' : ''} onClick={() => setFormat('html')}>
                web page
              </button>
            </div>
          </div>
          {turnCount > 1 && (
            <div className="share-row">
              <span className="share-label">turns</span>
              <div className="view-toggle share-seg">
                <button className={whole ? 'active' : ''} onClick={() => setWhole(true)}>
                  all {turnCount}
                </button>
                <button className={!whole ? 'active' : ''} onClick={() => setWhole(false)}>
                  range
                </button>
              </div>
            </div>
          )}
          {!whole && turnCount > 1 && (
            <div className="share-row">
              <span className="share-label">range</span>
              <div className="share-range">
                {turnInput(fromTurn, setFromTurn, 'First turn to export')}
                <span className="share-range-sep">to</span>
                {turnInput(toTurn, setToTurn, 'Last turn to export')}
              </div>
            </div>
          )}
          <div className="share-row">
            <span className="share-label">redact</span>
            <div className="view-toggle share-seg">
              <button className={!redact ? 'active' : ''} onClick={() => setRedact(false)}>
                off
              </button>
              <button className={redact ? 'active' : ''} onClick={() => setRedact(true)}>
                on
              </button>
            </div>
          </div>
          <p className="share-hint">
            {redact
              ? 'Scrubs API keys and tokens, key=value secrets, emails, and home paths.'
              : 'Exports verbatim — switch redact on before sharing outside your machine.'}
          </p>
          <div className="share-actions">
            <button className="share-btn" onClick={copy}>
              {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
              {copied ? 'copied' : 'copy'}
            </button>
            <button className="share-btn primary" onClick={() => void download()}>
              <DownloadIcon size={14} />
              download
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
