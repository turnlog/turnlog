import type { NormalizedRecord } from './types.js';
import { normalizeCodex, type CodexParseState } from './adapters/codex.js';
import { normalizeCursorCli } from './adapters/cursorCli.js';
import { normalizeCursorIde, type CursorIdeEnvelope } from './adapters/cursorIde.js';
import { normalizeV1 } from './adapters/v1.js';

/**
 * Inspect a parsed record and pick the adapter version that understands it.
 * There is a single adapter today; when Claude Code's format shifts, a new
 * adapter file is added and this function routes based on record shape or the
 * `version` field.
 */
export function sniffAdapterVersion(_obj: unknown): 1 {
  return 1;
}

/**
 * Turn one raw JSONL line into a NormalizedRecord.
 *
 * Cardinal rule: never crash, never drop. Malformed JSON and adapter bugs
 * both degrade to a kind:'unknown' record carrying the raw line.
 * Returns null only for blank lines.
 */
export function normalizeLine(text: string, fallbackId: string): NormalizedRecord | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;

  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return unknownRecord(trimmed, fallbackId);
  }

  try {
    sniffAdapterVersion(obj);
    return normalizeV1(obj, trimmed, fallbackId);
  } catch {
    return unknownRecord(trimmed, fallbackId);
  }
}

/**
 * The Codex flavor of normalizeLine. Same cardinal rule; the state object
 * threads cross-line context (cwd, current model) through one file's pass.
 */
export function normalizeCodexLine(
  text: string,
  fallbackId: string,
  state: CodexParseState,
): NormalizedRecord | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;

  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return unknownRecord(trimmed, fallbackId);
  }

  try {
    return normalizeCodex(obj, trimmed, fallbackId, state);
  } catch {
    return unknownRecord(trimmed, fallbackId);
  }
}

/** The Cursor CLI flavor — stateless like CC, one transcript line in. */
export function normalizeCursorCliLine(
  text: string,
  fallbackId: string,
): NormalizedRecord | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;

  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return unknownRecord(trimmed, fallbackId);
  }

  try {
    return normalizeCursorCli(obj, trimmed, fallbackId);
  } catch {
    return unknownRecord(trimmed, fallbackId);
  }
}

/**
 * The Cursor IDE flavor. Input is an extractor-built envelope rather than a
 * file line; the cardinal rule holds all the same — an adapter bug degrades
 * to kind 'unknown' carrying the envelope, never a crash, never a drop.
 */
export function normalizeCursorIdeEnvelope(
  env: CursorIdeEnvelope,
  fallbackId: string,
): NormalizedRecord {
  const raw = JSON.stringify(env);
  try {
    return normalizeCursorIde(env, raw, fallbackId);
  } catch {
    return unknownRecord(raw, fallbackId);
  }
}

function unknownRecord(raw: string, fallbackId: string): NormalizedRecord {
  return {
    uuid: fallbackId,
    parentUuid: null,
    kind: 'unknown',
    role: null,
    ts: null,
    isSidechain: false,
    toolName: null,
    toolUseId: null,
    isError: false,
    model: null,
    messageId: null,
    subtype: null,
    text: '',
    tokensIn: 0,
    tokensOut: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cacheWrite1hTokens: 0,
    costUsd: null,
    cwd: null,
    gitBranch: null,
    command: null,
    filesTouched: [],
    raw,
  };
}
