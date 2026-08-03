import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import {
  createSavedSearch,
  deleteSavedSearch,
  listSavedSearches,
  parseSearchQuery,
  seedStarterSearches,
} from '../src/server/api.js';
import { testDb, tmpDir } from './helpers.js';

let db: Database.Database;

beforeEach(() => {
  db = testDb(tmpDir('turnlog-starter-'));
});

describe('starter saved searches', () => {
  it('seeds examples into a fresh index', () => {
    expect(seedStarterSearches(db)).toBeGreaterThan(0);
    expect(listSavedSearches(db).length).toBeGreaterThan(0);
  });

  it('never seeds twice', () => {
    const first = seedStarterSearches(db);
    expect(seedStarterSearches(db)).toBe(0);
    expect(listSavedSearches(db)).toHaveLength(first);
  });

  it('does not resurrect a deleted example — the one unforgivable behaviour', () => {
    seedStarterSearches(db);
    for (const s of listSavedSearches(db)) deleteSavedSearch(db, s.id);
    expect(listSavedSearches(db)).toEqual([]);

    // A later launch must leave the empty list alone.
    expect(seedStarterSearches(db)).toBe(0);
    expect(listSavedSearches(db)).toEqual([]);
  });

  it('leaves someone who already has their own searches alone', () => {
    createSavedSearch(db, 'mine', 'is:pinned');
    expect(seedStarterSearches(db)).toBe(0);
    expect(listSavedSearches(db).map((s) => s.query)).toEqual(['is:pinned']);
  });

  it('seeds queries the parser actually understands', () => {
    seedStarterSearches(db);
    for (const s of listSavedSearches(db)) {
      const parsed = parseSearchQuery(s.query);
      // Every example must be operators, not bare words that happen to parse
      // — an example that silently searches for the text "is:error" teaches
      // the wrong thing.
      expect(parsed.hasFilters).toBe(true);
      expect(parsed.terms).toBe('');
    }
  });
});
