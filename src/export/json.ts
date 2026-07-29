import type { MessageRow, SessionMeta } from '../server/apiTypes.js';
import type { ExportOptions } from './markdown.js';
import { redactText } from './redact.js';

/**
 * JSON serializer: the normalized message stream for jq and scripts — the
 * machine sibling of the markdown/HTML exports. Zero interpretation: the
 * session row and message rows exactly as the API serves them (raw JSONL
 * included), plus an honest excerpt flag for bounded ranges.
 */
export function sessionToJson(
  session: SessionMeta,
  rows: MessageRow[],
  opts: ExportOptions = {},
): string {
  const doc = JSON.stringify(
    {
      turnlogExport: 1,
      excerpt: opts.excerpt === true,
      session,
      messages: rows,
    },
    null,
    2,
  );
  // Same posture as the other formats: redaction runs over the final
  // document. The scrub patterns (keys, emails, home paths) never contain
  // quotes or backslashes, so the output stays valid JSON.
  return opts.redact ? redactText(doc) : doc;
}
