import { useState } from 'react';
import { useSessionChain } from '../api';
import IconButton from '../components/IconButton';
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
/** Each tool's resume verb. A tool with no terminal resume (Cursor — IDE
 *  composers reopen in the IDE, not a shell) gets no button at all. */
const RESUME_VERBS: Record<string, (id: string) => string> = {
  'claude-code': (id) => `claude --resume ${id}`,
  codex: (id) => `codex resume ${id}`,
};

export default function ResumeButton({ session }: { session: SessionMeta }) {
  const [copied, setCopied] = useState(false);
  const canResume = RESUME_VERBS[session.tool] !== undefined;
  const chain = useSessionChain(session.id, canResume && session.chainLen > 1);
  if (!canResume) return null;
  const parts = chain.data?.chain;
  const tip = parts && parts.length > 0 ? parts[parts.length - 1]! : session;
  const isElsewhere = tip.id !== session.id;

  const copy = async () => {
    const cd = tip.projectPath ? `cd ${shellQuote(tip.projectPath)} && ` : '';
    // Each tool has its own resume verb; the id is the session id either way.
    const resume = RESUME_VERBS[session.tool]!(tip.id);
    try {
      await navigator.clipboard.writeText(`${cd}${resume}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard denied — ignore */
    }
  };

  return (
    <IconButton
      label="Copy the resume command for this session"
      tooltip={
        copied
          ? 'Command copied — paste it in your terminal'
          : isElsewhere
            ? 'Continue this conversation (resumes the latest part)'
            : session.tool === 'codex'
              ? 'Continue this session in Codex'
              : 'Continue this session in Claude Code'
      }
      className={copied ? 'ok' : ''}
      onClick={copy}
    >
      {copied ? <CheckIcon size={16} /> : <PlayCircleIcon size={16} />}
    </IconButton>
  );
}
