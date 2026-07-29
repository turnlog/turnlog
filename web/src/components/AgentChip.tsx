import { agentInfo } from '../agents';

/** Which agent wrote a session: uppercase chip in the agent's brand color,
 *  one look everywhere (sidebar rows, replay header). Unknown tools fall
 *  back to the neutral contrast chip. */
export default function AgentChip({ tool }: { tool: string }) {
  const agent = agentInfo(tool);
  return <span className={`chip-tool ${agent.colorClass}`}>{agent.label}</span>;
}
