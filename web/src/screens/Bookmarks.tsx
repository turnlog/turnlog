import { useMemo, useState } from 'react';
import { useAllBookmarks } from '../api';
import AgentBadge from '../components/AgentBadge';
import Badge from '../components/Badge';
import SearchField from '../components/SearchField';
import { SkeletonRows } from '../components/Skeleton';
import { fmtDate, fmtTime, projectName } from '../format';
import { BookmarkFilledIcon } from '../icons';
import { navigate, projectHash, sessionHash } from '../router';
import type { BookmarkEntry } from '../types';

/**
 * Every moment you marked, in one place.
 *
 * Bookmarks were per-session and therefore invisible in aggregate: you could
 * only rediscover one by reopening the session it lived in. Collected here
 * they become a scrapbook — which is also why captions exist, since thirty
 * unlabelled 240-character prefixes are thirty things to re-read.
 */

function BookmarkRow({ b }: { b: BookmarkEntry }) {
  return (
    <li className="bm-row">
      <button
        className="bm-btn"
        onClick={() => navigate(sessionHash(b.sessionId, { m: b.idx }))}
        title="Open this moment in the session"
      >
        <span className="bm-top">
          <BookmarkFilledIcon size={13} className="bm-mark" />
          {/* The caption is the point when it exists; the message text is the
              fallback so an unlabelled bookmark is still recognisable. */}
          <span className={`bm-label ${b.caption ? '' : 'is-raw'}`}>
            {b.caption ?? b.text ?? ''}
            {!b.caption && b.text === '' && <em>(message no longer in the index)</em>}
          </span>
          <span className="bm-when">{fmtDate(b.createdAt ?? b.ts)}</span>
        </span>
        <span className="bm-meta">
          <AgentBadge tool={b.tool} />
          {b.sessionName && <span className="bm-session">{b.sessionName}</span>}
          <span
            className="bm-project"
            onClick={(e) => {
              if (!b.projectKey) return;
              e.stopPropagation();
              navigate(projectHash(b.projectKey));
            }}
          >
            {projectName(b)}
          </span>
          {b.kind && <Badge>{b.kind}</Badge>}
          <span className="bm-idx">#{b.idx}</span>
          {b.caption && b.text !== '' && <span className="bm-quote">{b.text}</span>}
          {b.ts && <span className="bm-time">{fmtTime(b.ts)}</span>}
        </span>
      </button>
    </li>
  );
}

export default function Bookmarks() {
  const all = useAllBookmarks();
  const [filter, setFilter] = useState('');

  const rows = useMemo(() => {
    const list = all.data?.bookmarks ?? [];
    const q = filter.trim().toLowerCase();
    if (q === '') return list;
    return list.filter((b) =>
      `${b.caption ?? ''} ${b.text} ${b.sessionName ?? ''} ${b.projectKey ?? ''}`
        .toLowerCase()
        .includes(q),
    );
  }, [all.data, filter]);

  return (
    <div className="bookmarks-screen">
      <header className="bm-head">
        <div>
          <h1>Bookmarks</h1>
          <p className="bm-lede">
            Moments you marked, newest first. Add a caption from the replay to say why.
          </p>
        </div>
        <SearchField
          value={filter}
          onChange={setFilter}
          placeholder="Filter bookmarks…"
          ariaLabel="Filter bookmarks"
        />
      </header>

      {all.isLoading ? (
        <SkeletonRows n={6} tile={28} />
      ) : rows.length === 0 ? (
        <div className="fullscreen-note">
          {filter.trim() !== ''
            ? 'No bookmark matches that.'
            : 'No bookmarks yet — hover any message in a replay and click the bookmark in the gutter.'}
        </div>
      ) : (
        <ul className="bm-list">
          {rows.map((b) => (
            <BookmarkRow key={`${b.sessionId}:${b.idx}`} b={b} />
          ))}
        </ul>
      )}
    </div>
  );
}
