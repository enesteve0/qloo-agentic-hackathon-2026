import { describe, expect, it } from 'vitest';
import { createRunCtx } from '@/server/qloo/client';
import {
  applyChoices,
  contentTokens,
  decideOutcome,
  issueFor,
  normalizeName,
  resolutionKey,
  resolveAnchors,
  resolveStage,
} from '@/server/qloo/resolve';
import { plantedId, syntheticUuid } from '@/server/qloo/synthetic';
import { createMockTransport } from '@/server/qloo/transport-mock';
import type { Candidate, ResolutionOutcome } from '@/shared/types';
import { makeClient, scripted } from './helpers';

const film = (year: number, director: string): Candidate => ({
  id: `5157E7C0-0000-4000-8000-00000000${year}`,
  name: 'Solaris',
  type: 'movie',
  disambiguation: `Film · ${year} · ${director}`,
  popularity: 0.7,
  year,
});
const SOLARIS = [film(1972, 'Andrei Tarkovsky'), film(2002, 'Steven Soderbergh')];
const cand = (name: string, disambiguation: string | null = null, id = name): Candidate => ({
  id,
  name,
  type: 'artist',
  disambiguation,
  popularity: 0.5,
  year: null,
});

describe('name normalization', () => {
  it('folds accents, case, punctuation, & and a leading "the"', () => {
    expect(normalizeName('Beyoncé')).toBe('beyonce');
    expect(normalizeName('  The   Strokes ')).toBe('strokes');
    expect(normalizeName('Chef’s Table: BBQ')).toBe('chefs table bbq');
    expect(normalizeName("McDonald's")).toBe('mcdonalds');
    expect(normalizeName('Simon & Garfunkel')).toBe('simon and garfunkel');
    expect(normalizeName('Rosalía')).toBe('rosalia');
    expect(normalizeName('The')).toBe('the');
    expect(contentTokens('The Blue Note Jazz Club of New York')).toEqual(['blue', 'note', 'jazz', 'club', 'new', 'york']);
  });
});

describe('resolution outcomes', () => {
  it('exact: exactly one candidate has the same normalized name (Beyonce ↔ Beyoncé)', () => {
    const o = decideOutcome('Beyonce', 'artist', [cand('Beyoncé'), cand('Beyoncé Tribute Band')]);
    expect(o).toMatchObject({ status: 'resolved', match: 'exact', selected: { name: 'Beyoncé' }, warnings: [] });
    expect(o.status === 'resolved' && o.alternatives.map((c) => c.name)).toEqual(['Beyoncé Tribute Band']);
  });

  it('ambiguous: the planted Solaris pair without a hint', () => {
    const o = decideOutcome('Solaris', 'movie', SOLARIS);
    expect(o).toMatchObject({ status: 'ambiguous', candidates: SOLARIS });
  });

  it('semantic: the planner searchHint picks one of the two Solaris films, with a warning', () => {
    const o = decideOutcome('Solaris', 'movie', SOLARIS, '2002 film');
    expect(o).toMatchObject({ status: 'resolved', match: 'semantic', selected: { year: 2002 } });
    expect(o.status === 'resolved' && o.warnings[0]).toMatch(/by its description/);
    expect(decideOutcome('Solaris', 'movie', SOLARIS, 'the Tarkovsky one')).toMatchObject({ match: 'semantic', selected: { year: 1972 } });
  });

  it('semantic: ≥2 input words all found in one candidate’s name and disambiguation', () => {
    const o = decideOutcome('Blue Note Jazz Club', 'place', [cand('Blue Note', 'Jazz club · Greenwich Village, New York'), cand('Blue Note Records', 'Record label')]);
    expect(o).toMatchObject({ status: 'resolved', match: 'semantic', selected: { name: 'Blue Note' } });
  });

  it('hint words no candidate mentions cannot discriminate, and one word is never enough', () => {
    expect(decideOutcome('Solaris', 'movie', SOLARIS, 'the remake with Clooney').status).toBe('ambiguous');
    expect(decideOutcome('Glasper', 'artist', [cand('Robert Glasper'), cand('Robert Glasper Experiment')]).status).toBe('ambiguous');
    expect(decideOutcome('Robert Glasper Trio', 'artist', [cand('Robert Glasper')]).status).toBe('ambiguous');
  });

  it('not_found: no candidates', () => {
    expect(decideOutcome('zzzz', 'artist', [])).toEqual({ input: 'zzzz', type: 'artist', status: 'not_found', candidates: [] });
  });

  it('shows at most five candidates', () => {
    const many = Array.from({ length: 8 }, (_, i) => cand(`Name ${i}`, null, `id${i}`));
    const o = decideOutcome('Name', 'artist', many);
    expect(o.status === 'ambiguous' && o.candidates).toHaveLength(5);
  });
});

describe('questions', () => {
  it('use plain words and never URNs or ids', () => {
    const amb = issueFor(decideOutcome('Solaris', 'movie', SOLARIS));
    expect(amb).toMatchObject({ kind: 'ambiguous', question: 'Which film did you mean by “Solaris”?' });
    const missing = issueFor(decideOutcome('zzzz', 'artist', []));
    expect(missing?.question).toBe('We couldn’t find an artist called “zzzz” in Qloo. Skip it, or try a different name?');
    const urn = issueFor({ input: 'urn:entity:artist:abc', type: 'tv_show', status: 'not_found', candidates: [] });
    expect(urn?.question).toBe('We couldn’t find a TV show called “this anchor” in Qloo. Skip it, or try a different name?');
    expect(issueFor({ input: syntheticUuid('x'), type: 'brand', status: 'not_found', candidates: [] })?.question).not.toMatch(/5157E7C0/);
    expect(issueFor(decideOutcome('Beyonce', 'artist', [cand('Beyoncé')]))).toBeNull();
  });
});

describe('applyChoices', () => {
  const outcomes: ResolutionOutcome[] = [
    decideOutcome('Solaris', 'movie', SOLARIS),
    decideOutcome('Beyonce', 'artist', [cand('Beyoncé')]),
    decideOutcome('zzzz', 'artist', []),
  ];

  it('resolves a chosen candidate, drops null choices and recomputes the open questions', () => {
    const r = applyChoices(outcomes, [
      { input: 'Solaris', entityId: SOLARIS[1]!.id },
      { input: 'zzzz', entityId: null },
    ]);
    expect(r.outcomes).toHaveLength(2);
    expect(r.outcomes[0]).toMatchObject({ status: 'resolved', match: 'chosen', selected: { year: 2002 }, alternatives: [{ year: 1972 }] });
    expect(r.dropped).toEqual(['zzzz']);
    expect(r.issues).toEqual([]);
  });

  it('ignores ids that were never offered', () => {
    const r = applyChoices(outcomes, [{ input: 'Solaris', entityId: 'not-a-candidate' }]);
    expect(r.outcomes[0]?.status).toBe('ambiguous');
    expect(r.issues.map((i) => i.input)).toEqual(['Solaris', 'zzzz']);
  });
});

describe('resolveAnchors on the synthetic transport', () => {
  const setup = () => {
    const mock = createMockTransport({ grid: { cells: ['dr5ru7'] } });
    const { client } = makeClient(mock);
    return { mock, api: client.forRun(createRunCtx({ runId: 'resolve' })) };
  };

  it('resolves, asks about the planted Solaris ambiguity, skips zzzz and keeps input order', async () => {
    const { api } = setup();
    const r = await resolveAnchors(api, [
      { name: 'Solaris', type: 'movie' },
      { name: 'Beyonce', type: 'artist' },
      { name: 'Vampire Weekend', type: 'artist' },
      { name: 'zzzz', type: 'artist' },
      { name: 'Blue Note Jazz Club', type: 'place' },
    ]);
    expect(r.outcomes.map((o) => [o.input, o.status, o.status === 'resolved' ? o.match : null])).toEqual([
      ['Solaris', 'ambiguous', null],
      ['Beyonce', 'resolved', 'exact'],
      ['Vampire Weekend', 'resolved', 'exact'],
      ['zzzz', 'not_found', null],
      ['Blue Note Jazz Club', 'resolved', 'semantic'],
    ]);
    const solaris = r.outcomes[0];
    expect(solaris?.status === 'ambiguous' && solaris.candidates.map((c) => c.disambiguation)).toEqual([
      'Film · 1972 · Andrei Tarkovsky',
      'Film · 2002 · Steven Soderbergh',
    ]);
    expect(r.issues.map((i) => [i.input, i.kind])).toEqual([
      ['Solaris', 'ambiguous'],
      ['zzzz', 'not_found'],
    ]);
    expect(r.failures).toEqual([]);
  });

  it('caches outcomes under res:{type}:{name}, so a respelling makes no new search', async () => {
    const { api, mock } = setup();
    await resolveAnchors(api, [{ name: 'Beyoncé', type: 'artist' }]);
    const after = mock.requests;
    const again = await resolveAnchors(api, [{ name: 'beyonce', type: 'artist' }]);
    expect(mock.requests).toBe(after);
    expect(again.outcomes[0]).toMatchObject({ input: 'beyonce', status: 'resolved', selected: { name: 'Beyoncé' } });
    expect(resolutionKey({ name: 'Beyoncé', type: 'artist' })).toBe('res:artist:beyonce');
    expect(resolutionKey({ name: 'Solaris', type: 'movie', searchHint: '2002 Film' })).toBe('res:movie:solaris|2002 film');
  });

  it('uses the planner hint for the semantic match', async () => {
    const { api } = setup();
    const r = await resolveAnchors(api, [{ name: 'Solaris', type: 'movie', searchHint: 'Soderbergh 2002' }]);
    expect(r.outcomes[0]).toMatchObject({ status: 'resolved', match: 'semantic', selected: { id: plantedId('movie', 'Solaris', 2002) } });
  });

  it('resolves a Qloo id directly through /entities', async () => {
    const { api } = setup();
    const id = plantedId('movie', 'Solaris', 1972);
    const r = await resolveAnchors(api, [{ name: id, type: 'movie' }]);
    expect(r.outcomes[0]).toMatchObject({ status: 'resolved', match: 'identifier', selected: { id, name: 'Solaris' } });
  });

  it('reports failed lookups separately, without a question and without caching them', async () => {
    const { transport, calls } = scripted([{ status: 401 }, { status: 200, json: { results: [] } }]);
    const { client, clock } = makeClient(transport);
    const api = client.forRun(createRunCtx({ runId: 'f' }));
    const r = await resolveAnchors(api, [{ name: 'Sweetgreen', type: 'brand' }]);
    expect(r.outcomes[0]?.status).toBe('not_found');
    expect(r.issues).toEqual([]);
    expect(r.failures).toEqual([{ input: 'Sweetgreen', type: 'brand', code: 'AUTH', message: 'Qloo rejected the API key (401).', reason: undefined }]);
    clock.t += 600_001;
    await resolveAnchors(api, [{ name: 'Sweetgreen', type: 'brand' }]);
    expect(calls).toHaveLength(2); // the failure was not cached as "not found"
  });
});

describe('resolveStage', () => {
  it('returns the resolve_anchors envelope and resumes from stored outcomes without calling Qloo', async () => {
    const mock = createMockTransport({ grid: { cells: ['dr5ru7'] } });
    const { client } = makeClient(mock);
    const api = client.forRun(createRunCtx({ runId: 'stage' }));
    const anchors = [
      { name: 'Solaris', type: 'movie' as const, searchHint: null },
      { name: 'Vampire Weekend', type: 'artist' as const, searchHint: null },
    ];
    const first = await resolveStage(api, { anchors });
    expect(first.envelope).toMatchObject({
      operation: 'resolve_anchors',
      status: 'needs_input',
      result_count: 1,
      execution: { transport: 'mock', correlation_id: 'stage' },
      provenance: { source: 'Synthetic Qloo transport' },
    });
    expect(first.envelope.provenance.requests).toHaveLength(2);
    expect(first.envelope.interpretation).toBe('Matched 1 of 2 anchors in Qloo. “Solaris” could mean more than one thing.');

    const before = mock.requests;
    const resumed = await resolveStage(api, {
      anchors,
      previous: first.outcomes,
      choices: [{ input: 'Solaris', entityId: plantedId('movie', 'Solaris', 1972) }],
    });
    expect(mock.requests).toBe(before);
    expect(resumed.issues).toEqual([]);
    expect(resumed.envelope).toMatchObject({ status: 'ok', result_count: 2 });
    expect(resumed.outcomes[0]).toMatchObject({ match: 'chosen', selected: { year: 1972 } });
  });
});
