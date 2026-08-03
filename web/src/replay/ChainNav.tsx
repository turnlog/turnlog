import { useSessionChain } from '../api';
import Tooltip from '../components/Tooltip';
import { fmtDate } from '../format';
import { ChevronLeftIcon, ChevronRightIcon } from '../icons';
import { sessionHash } from '../router';

/**
 * Resume-chain navigation: this conversation continued across session files
 * (chainLen > 1 — the component only mounts then). Oldest part is 1.
 */
export default function ChainNav({ sessionId }: { sessionId: string }) {
  const chain = useSessionChain(sessionId);
  const parts = chain.data?.chain ?? [];
  const pos = parts.findIndex((p) => p.id === sessionId);
  if (parts.length < 2 || pos === -1) return null;
  const prev = pos > 0 ? parts[pos - 1] : null;
  const next = pos < parts.length - 1 ? parts[pos + 1] : null;
  return (
    <span className="chain-nav">
      {prev && (
        <Tooltip
          content={
            <div className="tooltip-row">
              Earlier part
              <span className="tooltip-num">{fmtDate(prev.startedAt)}</span>
            </div>
          }
        >
          <a
            href={sessionHash(prev.id)}
            className="icon-btn ghost chain-nav-btn"
            aria-label="Earlier part of this conversation"
          >
            <ChevronLeftIcon size={14} />
          </a>
        </Tooltip>
      )}
      <Tooltip content="Resumed conversation — one thread across session files">
        <span className="chain-nav-label">
          part {pos + 1}/{parts.length}
        </span>
      </Tooltip>
      {next && (
        <Tooltip
          content={
            <div className="tooltip-row">
              Later part
              <span className="tooltip-num">{fmtDate(next.startedAt)}</span>
            </div>
          }
        >
          <a
            href={sessionHash(next.id)}
            className="icon-btn ghost chain-nav-btn"
            aria-label="Later part of this conversation"
          >
            <ChevronRightIcon size={14} />
          </a>
        </Tooltip>
      )}
    </span>
  );
}
