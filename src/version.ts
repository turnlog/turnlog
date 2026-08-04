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
 * v2: no normalization change — reindex reprices rows now that the pricing
 * table covers OpenAI models (costs are baked in at index time).
 */
export const CODEX_ADAPTER_VERSION = 2;

/** Version of the Cursor CLI (agent-transcripts JSONL) adapter. */
export const CURSOR_ADAPTER_VERSION = 1;

/**
 * Version of the Cursor IDE (state.vscdb) extractor+adapter. Separate from
 * the CLI constant: the two formats churn independently, and a bump reindexes
 * only the sessions that came from the matching source.
 */
export const CURSOR_IDE_ADAPTER_VERSION = 1;
