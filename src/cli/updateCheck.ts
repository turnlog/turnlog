/**
 * The single optional network touch in the whole product:
 * a version check against the npm registry on `turnlog` startup. Opt out with
 * TURNLOG_NO_UPDATE_CHECK=1 or `"checkUpdates": false` in settings.json.
 * Fails silent — it must never block, delay, or error the CLI.
 */

const REGISTRY_URL = 'https://registry.npmjs.org/turnlog/latest';
const TIMEOUT_MS = 2000;

export function updateCheckEnabled(checkUpdates: boolean | undefined): boolean {
  if (process.env.TURNLOG_NO_UPDATE_CHECK) return false;
  return checkUpdates !== false;
}

/** True if `a` is a newer stable version than `b`. Prerelease tags ignored. */
function isNewer(a: string, b: string): boolean {
  const pa = a.split('-')[0]!.split('.').map(Number);
  const pb = b.split('-')[0]!.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

/** Latest published version if it's newer than `current`, else null. */
export async function checkForUpdate(current: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(REGISTRY_URL, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return data.version && isNewer(data.version, current) ? data.version : null;
  } catch {
    return null;
  }
}
