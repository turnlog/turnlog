import { agentInfo } from '../agents';

/** Which agent wrote a session: uppercase contrast chip, one look everywhere
 *  (sidebar rows, replay header). Brand color lives in the calendar stripes,
 *  not here. */
export default function AgentChip({ tool }: { tool: string }) {
  return <span className="chip-tool">{agentInfo(tool).label}</span>;
}
