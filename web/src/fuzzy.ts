/**
 * Case-insensitive fuzzy match for the command palette: every query character
 * must appear in the target in order. Returns a score (higher = better) or
 * null for no match. An exact substring always beats a scattered subsequence;
 * word-boundary hits and contiguous runs beat lone characters; shorter
 * targets win ties so "api" ranks `api` above `grape-pie-experiments`.
 */
const BOUNDARY = new Set([' ', '-', '_', '/', '.', ':']);

export function fuzzyScore(query: string, target: string): number | null {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (q.length === 0) return 0;
  const sub = t.indexOf(q);
  if (sub !== -1) return 1000 - sub - t.length * 0.1;
  let score = 0;
  let from = 0;
  let prevHit = -2;
  for (const ch of q) {
    const hit = t.indexOf(ch, from);
    if (hit === -1) return null;
    if (hit === 0 || BOUNDARY.has(t[hit - 1]!)) score += 10;
    else if (hit === prevHit + 1) score += 6;
    else score += 1;
    prevHit = hit;
    from = hit + 1;
  }
  return score - t.length * 0.05;
}
