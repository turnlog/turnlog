import { useEffect, useState } from 'react';
import { useTheme } from '../theme';
import { highlight, resolveLang } from './highlighter';

/** Above this size, highlighting waits for an explicit click. */
const HIGHLIGHT_CAP = 30_000;

export default function CodeBlock({ code, langHint }: { code: string; langHint?: string | null }) {
  const theme = useTheme();
  const lang = resolveLang(langHint);
  const overCap = code.length > HIGHLIGHT_CAP;
  const [forced, setForced] = useState(false);
  const [html, setHtml] = useState<string | null>(null);

  const shouldHighlight = lang !== null && (!overCap || forced);

  useEffect(() => {
    if (!shouldHighlight) return;
    let alive = true;
    highlight(code, lang, theme).then(
      (result) => {
        if (alive) setHtml(result);
      },
      () => {
        /* plain <pre> stays — highlighting is best-effort */
      },
    );
    return () => {
      alive = false;
    };
  }, [code, lang, shouldHighlight]);

  if (html !== null) {
    // Shiki output is generated markup over escaped text — safe by construction.
    return <div className="code-block" dangerouslySetInnerHTML={{ __html: html }} />;
  }
  return (
    <div className="code-block">
      <pre>
        <code>{code}</code>
      </pre>
      {lang !== null && overCap && !forced && (
        <button className="code-highlight-anyway" onClick={() => setForced(true)}>
          highlight anyway ({Math.round(code.length / 1024)} KB)
        </button>
      )}
    </div>
  );
}
