/**
 * The API contract is defined once, server-side, and imported here as
 * type-only (erased at build time — nothing from src/ ends up in the bundle).
 */
export type {
  BookmarksResponse,
  ChildSessionSummary,
  DiskSessionInfo,
  DiskUsageResponse,
  FileHistoryResponse,
  FileSummary,
  HealthResponse,
  IndexedEvent,
  MaintenanceResponse,
  MessageListResponse,
  MessageRow,
  PrefsResponse,
  ProjectInfo,
  SavedSearch,
  SearchGroup,
  SearchHit,
  SearchResponse,
  SessionListResponse,
  SessionMeta,
  SessionMetaPatch,
  SearchAggregates,
  SessionChainResponse,
  SessionChildrenResponse,
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
