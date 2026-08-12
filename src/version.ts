import { createRequire } from 'node:module';

const pkg = createRequire(import.meta.url)('../package.json') as { version: string };

export const APP_VERSION: string = pkg.version;

/**
 * Version of the Claude Code parser/adapter pipeline. Bumping this forces a
 * full reindex of every CC session file on the next scan.
 * v5: attachments carrying a body (edited_text_file's snippet, file content,
 * directory listing) indexed only their path — the body was unsearchable.
 * v6: gitBranch, stamped on every record and previously discarded.
 * v7: command, extracted from Bash tool_use inputs — 40% of tool calls had
 * no dimension of their own.
 */
export const ADAPTER_VERSION = 7;

/**
 * Version of the Codex rollout adapter. Per-tool on purpose: bumping one
 * tool's adapter must not reindex the other tool's files.
 * v2: no normalization change — reindex reprices rows now that the pricing
 * table covers OpenAI models (costs are baked in at index time).
 * v3: tool output arrives as a list of text blocks on real rollouts, which
 * the adapter dropped — every exec result indexed with empty search text.
 * v4: session_meta.git.branch, carried across the file like cwd and model.
 * v5: command, from local_shell_call actions, shell function_calls, and the
 * exec_command handle inside exec's JavaScript bodies.
 */
export const CODEX_ADAPTER_VERSION = 5;

/**
 * Version of the Cursor CLI (agent-transcripts JSONL) adapter.
 * v2: command, from run_terminal_cmd-shaped tool_use inputs.
 */
export const CURSOR_ADAPTER_VERSION = 2;

/**
 * Version of the Cursor IDE (state.vscdb) extractor+adapter. Separate from
 * the CLI constant: the two formats churn independently, and a bump reindexes
 * only the sessions that came from the matching source.
 * v2: command, from run_terminal_cmd-shaped toolFormerData params.
 */
export const CURSOR_IDE_ADAPTER_VERSION = 2;
