import type { NormalizedRecord } from './types.js';
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
    model: null,
    text: '',
    tokensIn: 0,
    tokensOut: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cacheWrite1hTokens: 0,
    costUsd: null,
    cwd: null,
    filesTouched: [],
    raw,
  };
}
