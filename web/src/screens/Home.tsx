import type { ReactNode } from 'react';
import { useStats, useStatus } from '../api';
import { fmtCost, fmtCount, fmtTokens, projectName } from '../format';
import { ChatIcon, HistoryIcon, TransferIcon, WalletIcon } from '../icons';
import { LockGlyph } from '../Sidebar';

function StatTile({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="stat-tile">
      {icon && <span className="stat-ico">{icon}</span>}
      <div>
        <div className="stat-value">
          {value}
          {sub && <span className="stat-sub">{sub}</span>}
        </div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  );
}

export default function Home() {
  const stats = useStats();
  const status = useStatus();
  const licensed = status.data?.licensed ?? true;
  const empty = stats.data !== undefined && stats.data.sessions === 0;

  if (empty) {
    return (
      <div className="fullscreen-note">
        <div>
          <h1>No sessions indexed yet</h1>
          <p>
            {status.data?.state === 'indexing'
              ? 'Indexing is running — sessions appear as they are parsed.'
              : 'Run Claude Code, then come back. Turnlog watches ~/.claude/projects live.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="home">
      <h1 className="home-title">Every turn your agents ever took — searchable.</h1>

      <div className="stat-strip">
        <StatTile
          icon={<HistoryIcon size={19} />}
          label="sessions"
          value={stats.data ? fmtCount(stats.data.sessions) : '…'}
        />
        <StatTile
          icon={<ChatIcon size={19} />}
          label="turns logged"
          value={stats.data ? fmtCount(stats.data.messages) : '…'}
        />
        <StatTile
          icon={<TransferIcon size={19} />}
          label="tokens in / out"
          value={
            stats.data
              ? `${fmtTokens(stats.data.inputTokens)} / ${fmtTokens(stats.data.outputTokens)}`
              : '…'
          }
        />
        <StatTile
          icon={<WalletIcon size={19} />}
          label="est. spend"
          value={stats.data ? fmtCost(stats.data.costUsd) : '…'}
          sub=" est."
        />
      </div>

      {!licensed && (
        <div className="trial-banner">
          <LockGlyph />
          <span>
            Trial — your <strong>10 newest</strong> sessions are open. The rest of your history
            is indexed and waiting; a license unlocks all{' '}
            {stats.data ? fmtCount(stats.data.sessions) : ''} sessions.
          </span>
        </div>
      )}

      {stats.data && stats.data.projects.length > 0 && (
        <section className="home-projects">
          <h2>projects</h2>
          <ul>
            {stats.data.projects.slice(0, 12).map((p) => (
              <li key={p.projectKey}>
                <span className="home-project-name">{projectName(p)}</span>
                <span className="home-project-count">
                  {fmtCount(p.sessionCount)} session{p.sessionCount === 1 ? '' : 's'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="home-hint">
        Pick a session from the sidebar, or press <kbd>/</kbd> and search everything.
      </p>
    </div>
  );
}
