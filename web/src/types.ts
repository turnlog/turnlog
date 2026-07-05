/**
 * The API contract is defined once, server-side, and imported here as
 * type-only (erased at build time — nothing from src/ ends up in the bundle).
 */
export type {
  MessageListResponse,
  MessageRow,
  ProjectInfo,
  SearchGroup,
  SearchHit,
  SearchResponse,
  SessionListResponse,
  SessionMeta,
  SearchAggregates,
  SpendDay,
  SpendResponse,
  SpendSplit,
  StatsResponse,
  StatusResponse,
  TurnsResponse,
  TurnSummary,
} from '../../src/server/apiTypes';

export const SNIPPET_OPEN = '\uE000';
export const SNIPPET_CLOSE = '\uE001';
