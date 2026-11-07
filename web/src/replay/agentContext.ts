import { createContext } from 'react';

/**
 * The replay's assistant-role label ('claude' | 'codex' | a future agent) —
 * provided by Replay from the session's tool, consumed by every BlockView so
 * a Codex answer never renders under a CLAUDE rail.
 */
export const AgentLabelContext = createContext('claude');

/**
 * Whose rows these are — the media route checks a reference against one
 * message of one session, and a nested subagent transcript is its own session.
 */
export const SessionIdContext = createContext<string | null>(null);
