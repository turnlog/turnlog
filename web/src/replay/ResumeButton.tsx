import { useState } from 'react';
import { useSessionChain } from '../api';
import Tooltip from '../components/Tooltip';
import { CheckIcon, PlayCircleIcon } from '../icons';
import type { SessionMeta } from '../types';

/** Quote a path for pasting into a shell; plain paths stay readable. */
function shellQuote(p: string): string {
  return /^[\w/.~-]+$/.test(p) ? p : `'${p.replaceAll("'", `'\\''`)}'`;
}

/**
 * Close the find→act loop: copy the command that reopens this conversation in
 * Claude Code. A resumed chain continues from its latest part — that file
 * carries the whole copied history — so the tip's id is what gets copied.
 */
export default function ResumeButton({ session }: { session: SessionMeta }) {
  const [copied, setCopied] = useState(false);
  const chain = useSessionChain(session.id, session.chainLen > 1);
  const parts = chain.data?.chain;
  const tip = parts && parts.length > 0 ? parts[parts.length - 1]! : session;
  const isElsewhere = tip.id !== session.id;

  const copy = async () => {
    const cd = tip.projectPath ? `cd ${shellQuote(tip.projectPath)} && ` : '';
    try {
      await navigator.clipboard.writeText(`${cd}claude --resume ${tip.id}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard denied — ignore */
    }
  };

  return (
    <Tooltip
      content={
        copied
          ? 'Command copied — paste it in your terminal'
          : isElsewhere
            ? 'Continue this conversation (resumes the latest part)'
            : 'Continue this session in Claude Code'
      }
    >
      <button
        className={`replay-action ${copied ? 'ok' : ''}`}
        onClick={copy}
        aria-label="Copy the claude --resume command for this session"
      >
        {copied ? <CheckIcon size={16} /> : <PlayCircleIcon size={16} />}
      </button>
    </Tooltip>
  );
}
