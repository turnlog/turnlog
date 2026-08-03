import { beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { Indexer } from '../src/indexer/indexer.js';
import { searchMessages } from '../src/server/api.js';
import { copyCodexCorpus, copyCorpus, testDb, tmpDir } from './helpers.js';

let db: Database.Database;

beforeAll(async () => {
  db = testDb(tmpDir('turnlog-facets-'));
  await new Indexer(db, {
    projectsDir: copyCorpus(),
    codexDir: copyCodexCorpus(),
  }).scanAll();
});

describe('search facets', () => {
  it('offers the dimensions of the current match set', () => {
    const { facets } = searchMessages(db, { query: 'the' });
    expect(facets).not.toBeNull();
    expect(facets!.kinds.length).toBeGreaterThan(0);
    expect(facets!.projects.length).toBeGreaterThan(0);
  });

  it('hands back an operator that actually narrows the query', () => {
    const first = searchMessages(db, { query: 'the' });
    const kind = first.facets!.kinds[0]!;
    // The chip's whole promise: appending it filters to what it counted.
    const refined = searchMessages(db, { query: `the ${kind.operator}` });
    expect(refined.totalHits).toBeGreaterThan(0);
    expect(refined.totalHits).toBeLessThanOrEqual(first.totalHits);
  });

  it('counts sessions for session dimensions, not hits', () => {
    const { facets, aggregates } = searchMessages(db, { query: 'the' });
    const projectTotal = facets!.projects.reduce((n, p) => n + p.count, 0);
    // A project with 300 hits in one session is one project — so the project
    // counts can never exceed the matched-session count.
    expect(projectTotal).toBeLessThanOrEqual(aggregates!.matchedSessions);
  });

  it('offers an agent facet only when more than one agent matched', () => {
    const all = searchMessages(db, { query: 'the' });
    // The corpus holds both, so the choice is real.
    expect(all.facets!.agents.length).toBeGreaterThan(1);

    // Narrowed to one agent, the dimension stops being a choice and is
    // dropped rather than offering a chip that filters nothing away.
    const one = searchMessages(db, { query: 'the agent:codex' });
    expect(one.totalHits).toBeGreaterThan(0);
    expect(one.facets!.agents).toEqual([]);
  });

  it('shows the folder but filters on the exact key', () => {
    const { facets } = searchMessages(db, { query: 'the' });
    const project = facets!.projects[0]!;
    // Keys are path-derived and unreadable as a chip.
    expect(project.label).toBeTruthy();
    expect(project.label!.length).toBeLessThan(project.value.length);
    // The operator keeps the full key: project: is a substring match, so a
    // shortened one would over-match a sibling (turnlog / turnlog-landing)
    // and the chip would not deliver the count it promised.
    expect(project.operator).toContain(project.value);
    const refined = searchMessages(db, { query: `the ${project.operator}` });
    expect(refined.aggregates!.matchedSessions).toBe(project.count);
  });

  it('is null for a session-scoped find — nothing to refine', () => {
    const scoped = searchMessages(db, { query: 'the', sessionId: 'anything' });
    expect(scoped.facets).toBeNull();
  });
});

describe('the agent: operator', () => {
  it('matches the stored key and its short form alike', () => {
    const long = searchMessages(db, { query: 'the agent:claude-code' }).totalHits;
    const short = searchMessages(db, { query: 'the agent:claude' }).totalHits;
    expect(long).toBeGreaterThan(0);
    expect(short).toBe(long);
  });

  it('separates the agents rather than lumping them', () => {
    const all = searchMessages(db, { query: 'the' }).totalHits;
    const claude = searchMessages(db, { query: 'the agent:claude' }).totalHits;
    const codex = searchMessages(db, { query: 'the agent:codex' }).totalHits;
    expect(claude).toBeGreaterThan(0);
    expect(codex).toBeGreaterThan(0);
    expect(claude + codex).toBeLessThanOrEqual(all);
  });
});
