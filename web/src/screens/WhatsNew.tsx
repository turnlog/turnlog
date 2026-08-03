import { useEffect } from 'react';
import { useStatus } from '../api';
import { getPref, setPref } from '../prefs';
import { RELEASES, type NoteKind, type ReleaseNotes } from '../whatsnew';

/** Fixed order — a release reads added → improved → fixed, never data order. */
const KINDS: { kind: NoteKind; title: string }[] = [
  { kind: 'added', title: 'Added' },
  { kind: 'improved', title: 'Improved' },
  { kind: 'fixed', title: 'Fixed' },
];

/**
 * Notes grouped under a heading per kind, rather than a badge repeated down
 * every row: with the rows sorted, the kind is a property of the group and
 * saying it once is enough. That retired three badge variants — and with
 * them the only place blue meant "improved".
 */
function groups(r: ReleaseNotes) {
  return KINDS.map((k) => ({
    ...k,
    notes: r.notes.filter((n) => n.kind === k.kind),
  })).filter((g) => g.notes.length > 0);
}

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

  // Reading this page clears the header dot's "new version" ring.
  useEffect(() => {
    if (current && getPref('lastSeenVersion') !== current) {
      setPref('lastSeenVersion', current);
    }
  }, [current]);

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
              {r.version === current && <span className="wn-current-badge">current</span>}
              <span className="wn-release-date">{fmtReleaseDate(r.date)}</span>
            </header>
            {groups(r).map((g) => (
              <div key={g.kind} className="wn-group">
                <h3 className="wn-group-title">{g.title}</h3>
                <ul className="wn-notes">
                  {g.notes.map((n, i) => (
                    <li key={i} className="wn-note">
                      {n.text}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
