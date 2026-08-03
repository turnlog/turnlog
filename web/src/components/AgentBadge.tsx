import { agentInfo } from '../agents';
import Badge from './Badge';

/** Which agent wrote a session: the adapter's own mark plus its name, in the
 *  agent's brand color — one look everywhere (sidebar rows, replay header).
 *  Two encodings, always: the mark for recognition, the word for certainty.
 *  Unknown tools fall back to the neutral contrast badge with no mark. */
export default function AgentBadge({ tool }: { tool: string }) {
  const agent = agentInfo(tool);
  const Mark = agent.Mark;
  return (
    <Badge kind="tool" className={agent.colorClass}>
      {/* Sized by the badge via CSS (1em) — no number here. */}
      {Mark && <Mark />}
      {agent.label}
    </Badge>
  );
}
