import { describe, expect, it } from 'vitest';
import { WHAT_THIS_SUPPORTS, buildEnvelope, mapTasteLiftEnvelope, neighborhoodEvidenceEnvelope, resolveAnchorsEnvelope } from '@/server/qloo/envelope';
import type { ProvenanceRequest } from '@/shared/types';

const req: ProvenanceRequest = {
  method: 'GET',
  path: '/v2/insights',
  query: 'filter.type=urn:heatmap&filter.location=POLYGON(NYC study)',
  status: 200,
  cache: 'miss',
  ms: 812,
  attempt: 1,
  purpose: 'heatmap',
};

describe('stage envelopes', () => {
  it('label the transport and source honestly', () => {
    const live = buildEnvelope({ operation: 'map_taste_lift', status: 'ok', synthetic: false, correlationId: 'r1', durationMs: 1234.4, requests: [req], interpretation: 'x', resultCount: 3 });
    expect(live.execution).toEqual({ transport: 'direct-rest', correlation_id: 'r1', duration_ms: 1234 });
    expect(live.provenance).toEqual({ source: 'Qloo API', requests: [req] });
    const mock = buildEnvelope({ operation: 'map_taste_lift', status: 'ok', synthetic: true, correlationId: 'r1', durationMs: 1, requests: [], interpretation: 'x', resultCount: 0 });
    expect(mock.execution.transport).toBe('mock');
    expect(mock.provenance.source).toBe('Synthetic Qloo transport');
  });

  it('say what the heatmap result supports and what it does not', () => {
    const env = mapTasteLiftEnvelope({
      synthetic: false,
      correlationId: 'r',
      durationMs: 10,
      requests: [req],
      anchors: [{ name: 'Robert Glasper' }, { name: 'Esperanza Spalding' }],
      baseline: 'each anchor’s own popularity map (B4)',
      location: 'NYC study polygon',
      cells: 1436,
    });
    expect(env.what_this_supports).toBe(
      "Where your anchor audience's Qloo signal ranks higher than NYC's overall signal. Not foot traffic, population or visits; says nothing about any individual.",
    );
    expect(env.interpretation).toBe(
      'Compared where the Qloo signal for “Robert Glasper” and “Esperanza Spalding” ranks against each anchor’s own popularity map (B4) across 1,436 NYC grid cells.',
    );
    expect(env.query_intent.filters).toEqual(['location: NYC study polygon']);
    expect(env.result_count).toBe(1436);
  });

  it('build the resolution and evidence envelopes', () => {
    const resolve = resolveAnchorsEnvelope({
      synthetic: false,
      correlationId: 'r',
      durationMs: 5,
      requests: [],
      anchors: [{ name: 'Sweetgreen', type: 'brand' }, { name: 'Pod', type: 'podcast' }],
      outcomes: [
        { input: 'Sweetgreen', type: 'brand', status: 'not_found', candidates: [] },
        { input: 'Pod', type: 'podcast', status: 'not_found', candidates: [] },
      ],
      issues: [],
      failures: [
        { input: 'Sweetgreen', message: 'Qloo rejected the API key (401).' },
        { input: 'Pod', message: 'Qloo rejected the API key (401).' },
      ],
    });
    expect(resolve.status).toBe('error');
    expect(resolve.what_this_supports).toBe(WHAT_THIS_SUPPORTS.resolve_anchors);
    expect(resolve.warnings).toEqual(['Sweetgreen: Qloo rejected the API key (401).', 'Pod: Qloo rejected the API key (401).']);
    expect(resolve.query_intent.signals).toEqual(['Sweetgreen (brand)', 'Pod (podcast)']);

    const evidence = neighborhoodEvidenceEnvelope({
      synthetic: true,
      correlationId: 'r',
      durationMs: 5,
      requests: [],
      neighborhoods: [{ code: 'BK0102', short: 'Williamsburg' }],
      anchors: [{ name: 'Sweetgreen' }],
      places: 15,
    });
    expect(evidence.interpretation).toBe('Read 15 local places Qloo ranks for “Sweetgreen” in “Williamsburg”.');
    expect(evidence.query_intent.filters[0]).toBe('location: POLYGON(NTA BK0102)');
    expect(evidence.what_this_supports).toMatch(/says nothing about any individual/);
  });
});
