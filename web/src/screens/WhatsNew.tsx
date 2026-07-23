import { useStatus } from '../api';
import { RELEASES } from '../whatsnew';

function fmtReleaseDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/** User-level release notes, bundled with the app — never fetched. */
export default function WhatsNew() {
  const { data } = useStatus();
  const current = data?.appVersion ?? null;

  return (
    <div className="whatsnew">
      <div className="whatsnew-inner">
        <header className="whatsnew-head">
          <h1>What&rsquo;s new</h1>
          {current && <span className="whatsnew-current">you&rsquo;re on v{current}</span>}
        </header>
        {RELEASES.map((r) => (
          <section key={r.version} className="wn-release">
            <header className="wn-release-head">
              <h2>v{r.version}</h2>
              {r.version === current && <span className="wn-current-chip">current</span>}
              <span className="wn-release-date">{fmtReleaseDate(r.date)}</span>
            </header>
            <ul className="wn-notes">
              {r.notes.map((n, i) => (
                <li key={i} className="wn-note">
                  <span className={`wn-kind wn-${n.kind}`}>{n.kind}</span>
                  <span>{n.text}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
