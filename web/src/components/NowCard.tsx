import { useLive } from '../api';
import { fmtCost, fmtCount, fmtTokens, projectName } from '../format';
import { navigate, sessionHash } from '../router';
import AgentBadge from './AgentBadge';
import Tooltip from './Tooltip';
import './NowCard.css';

/**
 * What your agents are doing right now — sessions written to in the last few
 * minutes, most recent first.
 *
 * It renders only while something is running and disappears when nothing is,
 * which is deliberate: this is a diagnostic, not a dashboard. A surface that
 * is always present invites "while we're here, also show…" until it becomes
 * one.
 *
 * Every column is a fact each adapter fills, so two different agents running
 * at once read alike. Context size is the exception and is shown only where
 * the agent reports a running window total — Codex logs per-response deltas,
 * and a number meaning something different per agent is worse than none.
 */
export default function NowCard() {
  const live = useLive();
  const sessions = live.data?.sessions ?? [];
  if (sessions.length === 0) return null;

  return (
    <section className="card now-card">
      <div className="list-card-head">
        <h2>
          <span className="now-pulse" aria-hidden />
          Now
        </h2>
        <span className="now-window">
          active in the last {live.data?.withinMinutes ?? 5} min
        </span>
      </div>
      <ul className="now-list">
        {sessions.map((s) => (
          <li key={s.id}>
            <button className="now-row" onClick={() => navigate(sessionHash(s.id))}>
              <span className="now-row-top">
                <AgentBadge tool={s.tool} />
                <span className="now-project">
                  {/* A live session always has a name to show: its own, or
                      failing that the repo it is working in. */}
                  {s.name || projectName({ projectPath: s.projectPath ?? '', projectKey: s.projectKey })}
                </span>
                <span className="now-figures">
                  {s.contextTokens !== null && (
                    <Tooltip content="Tokens in the context window at the last response">
                      <span>{fmtTokens(s.contextTokens)} ctx</span>
                    </Tooltip>
                  )}
                  <span>{fmtCount(s.turnCount)}t</span>
                  <span>{fmtCost(s.costUsd)}</span>
                </span>
              </span>
              {s.lastPrompt && <span className="now-prompt">{s.lastPrompt}</span>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
