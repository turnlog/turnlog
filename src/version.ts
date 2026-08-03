import { createRequire } from 'node:module';

const pkg = createRequire(import.meta.url)('../package.json') as { version: string };

export const APP_VERSION: string = pkg.version;

/**
 * Version of the Claude Code parser/adapter pipeline. Bumping this forces a
 * full reindex of every CC session file on the next scan.
 */
export const ADAPTER_VERSION = 4;

/**
 * Version of the Codex rollout adapter. Per-tool on purpose: bumping one
 * tool's adapter must not reindex the other tool's files.
 */
export const CODEX_ADAPTER_VERSION = 1;
