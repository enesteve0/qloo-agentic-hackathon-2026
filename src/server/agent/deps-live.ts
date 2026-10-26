import 'server-only';
import { finalizeCreative } from '@/server/creative/apply';
import { buildLexicon } from '@/server/creative/lexicon';
import type { CreativeContext } from '@/server/creative/validate';
import { eligibleNtas, getNta, gridSpec, kiosks, ntas, nycStudyWkt } from '@/server/data';
import { getEnv } from '@/server/env';
import { buildEvidencePacks } from '@/server/evidence/build';
import { computeWhere, DEFAULT_LIFT_CONFIG } from '@/server/geo';
import { kv } from '@/server/kv';
import { createFakeGateway } from '@/server/llm/fake';
import { getLlmGateway, type AttemptEvent as ModelAttempt, type LlmGateway } from '@/server/llm/gateway';
import { runPlanner } from '@/server/llm/planner';
import { buildCreativeInstructions, buildCreativePrompt } from '@/server/llm/prompts';
import { creativeSchema } from '@/server/llm/schemas';
import { DEFAULT_ASSUMPTIONS } from '@/server/plan/assumptions';
import { buildMediaPlan } from '@/server/plan/optimizer';
import { computeProof } from '@/server/proof/baseline';
import {
  createDefaultMockTransport,
  createQlooClient,
  failureKind,
  getQlooClient,
  mapTasteLiftEnvelope,
  neighborhoodEvidenceEnvelope,
  resolveStage,
  runCtxFor,
  type HeatmapSignals,
  type QlooApi,
  type QlooClient,
  type QlooFailure,
  type QlooMode,
} from '@/server/qloo';
import type { FallbackReason, StoopDataParts } from '@/shared/stream';
import type { LiftConfig, ResolutionOutcome } from '@/shared/types';
import type { RunDeps, StepCtx } from './deps';
import { UserFacingError } from './errors';

export interface DepsOptions {
  /** Qloo source: the configured mode, or `mock` for synthetic sample plans. */
  qloo: QlooMode;
  /** `mock` uses the deterministic writer (no model calls). */
  llm: 'live' | 'mock';
  country: string | null;
}

/** Stage budgets (ARCHITECTURE §12); each is also cut short by the run deadline. */
const PLANNER_BUDGET_MS = 25_000;
const CREATIVE_BUDGET_MS = 45_000;
/** Fresh Qloo calls one run may need; live runs start only if this much quota is above the reserve. */
const RUN_CALL_MARGIN = 20;
const PLACES_PER_NTA = 15;

const NEIGHBORHOODS = eligibleNtas.map((n) => ({ code: n.code, name: n.name }));
const ELIGIBLE = eligibleNtas.map((n) => ({ code: n.code, name: n.name, short: n.short }));
const LEXICON = buildLexicon(ntas);

const BASELINE_TEXT: Record<LiftConfig['baseline'], string> = {
  B0: 'Qloo’s own affinity rank for each anchor (B0)',
  B1: 'NYC’s all-ages Qloo signal (B1)',
  B2: 'NYC’s restaurant-going Qloo signal (B2)',
  B3: 'a panel of mass-market brands (B3)',
  B4: 'each anchor’s own popularity map (B4)',
};

// ---------------------------------------------------------------------------------------------
// Calibration record (written by `pnpm qloo:smoke --confirm`; no Qloo response data inside)
// ---------------------------------------------------------------------------------------------

export interface CalibrationRecord {
  config: LiftConfig;
  location: 'wkt' | 'query';
  baselineSignals: HeatmapSignals[];
  fingerprintSignals: HeatmapSignals | null;
  decidedAt: string | null;
}

const DEFAULT_CALIBRATION: CalibrationRecord = {
  config: DEFAULT_LIFT_CONFIG,
  location: 'wkt',
  baselineSignals: [],
  fingerprintSignals: null,
  decidedAt: null,
};
const CALIBRATION_TTL_MS = 60_000;
let calibrationCache: { at: number; value: CalibrationRecord } | null = null;

export async function loadCalibration(now = Date.now()): Promise<CalibrationRecord> {
  if (calibrationCache && now - calibrationCache.at < CALIBRATION_TTL_MS) return calibrationCache.value;
  let value = DEFAULT_CALIBRATION;
  try {
    const stored = await kv().get<Partial<CalibrationRecord>>('cfg:calibration');
    if (stored?.config && typeof stored.config.baseline === 'string') {
      value = {
        config: { ...DEFAULT_LIFT_CONFIG, ...stored.config, thresholds: { ...DEFAULT_LIFT_CONFIG.thresholds, ...stored.config.thresholds } },
        location: stored.location === 'query' ? 'query' : 'wkt',
        baselineSignals: Array.isArray(stored.baselineSignals) ? stored.baselineSignals : [],
        fingerprintSignals: stored.fingerprintSignals ?? null,
        decidedAt: stored.decidedAt ?? null,
      };
    }
  } catch {
    // KV unavailable: the default configuration still produces a valid plan.
  }
  calibrationCache = { at: now, value };
  return value;
}

// ---------------------------------------------------------------------------------------------
// Availability (checked before a live run starts)
// ---------------------------------------------------------------------------------------------

/** Why a new live run should be served a sample plan instead, or null when it can start. */
export async function liveAvailability(now = Date.now()): Promise<FallbackReason | null> {
  const mode = getEnv().QLOO_MODE;
  if (mode === 'mock') return null;
  if (mode === 'off') return 'qloo_unavailable';
  if (mode === 'cache-only') return 'qloo_reserve';
  try {
    const s = await getQlooClient().ledger();
    if (s.cfgMode === 'off') return 'qloo_unavailable';
    if (s.cfgMode === 'cache-only') return 'qloo_reserve';
    if (s.authFailUntil && Date.parse(s.authFailUntil) > now) return 'qloo_unavailable';
    if (s.exhaustedUntil && Date.parse(s.exhaustedUntil) > now) return 'qloo_reserve';
    if (s.attemptsToday + RUN_CALL_MARGIN > s.phase.dailyCap) return 'qloo_reserve';
    if (s.effectiveRemaining - RUN_CALL_MARGIN <= (s.phase.floor ?? 0)) return 'qloo_reserve';
    return null;
  } catch {
    return 'qloo_unavailable';
  }
}

// ---------------------------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------------------------

let syntheticClient: QlooClient | undefined;

function qlooClient(mode: QlooMode): QlooClient {
  if (mode === 'mock' && getEnv().QLOO_MODE !== 'mock') {
    syntheticClient ??= createQlooClient({ transport: createDefaultMockTransport(), kv: kv() });
    return syntheticClient;
  }
  return getQlooClient();
}

const toAttempt = (e: ModelAttempt): StoopDataParts['attempt'] => {
  const ok = e.outcome === 'ok' || e.outcome === 'repaired';
  return { kind: e.kind, slot: e.slot, ok, reason: ok ? null : (e.detail ?? e.outcome), ms: e.ms };
};

const viaLabel = (slot: string, model: string) => `${model} via ${slot}`;

function qlooError(f: QlooFailure | undefined, signal: AbortSignal): Error {
  if (signal.aborted) return new Error('run deadline'); // reported as the time-limit message
  if (!f) return new UserFacingError('Qloo returned no data for these anchors.', 'no_signal');
  switch (failureKind(f)) {
    case 'quota':
      return new UserFacingError('Stoop has used its Qloo budget for now. Open a recorded plan, or try again later.', 'qloo_quota');
    case 'unavailable':
      return new UserFacingError('Qloo couldn’t be reached just now. Try again in a minute, or open a recorded plan.', 'qloo_unavailable');
    default:
      return new UserFacingError('Qloo couldn’t answer this request. Try naming different artists, places or brands.', 'other');
  }
}

/** With one question per run, anything the owner left unanswered takes its first candidate. */
function settleUnanswered(outcomes: ResolutionOutcome[]): ResolutionOutcome[] {
  return outcomes.map((o) =>
    o.status === 'ambiguous' && o.candidates[0]
      ? {
          input: o.input,
          type: o.type,
          status: 'resolved',
          match: 'semantic',
          selected: o.candidates[0],
          alternatives: o.candidates.slice(1),
          warnings: [`Used the first match for “${o.input}” because the question was left open.`],
        }
      : o,
  );
}

/**
 * Production wiring of the agent's steps: Qloo client (live, cache-only or synthetic), lift engine,
 * model chain (or the deterministic writer), grounding validator, optimizer and LLM-only proof.
 */
export function createRunDeps(o: DepsOptions): RunDeps {
  const client = qlooClient(o.qloo);
  const gateway: LlmGateway = o.llm === 'live' ? getLlmGateway() : createFakeGateway();
  const api = (ctx: StepCtx): QlooApi => client.forRun(runCtxFor(ctx));

  return {
    mode: client.synthetic ? 'mock' : 'live',
    now: () => new Date(),
    eligibleNtas: ELIGIBLE,

    async planner({ brief, country, signal, onAttempt }) {
      const r = await runPlanner({
        brief,
        neighborhoods: NEIGHBORHOODS,
        country,
        signal: AbortSignal.any([signal, AbortSignal.timeout(PLANNER_BUDGET_MS)]),
        onAttempt: (e) => onAttempt(toAttempt(e)),
        gateway,
      });
      return { output: r.plan, via: r.via && r.model ? viaLabel(r.via, r.model) : 'rules', attempts: r.attempts.length };
    },

    async resolve({ anchors, choices, previous, ctx }) {
      const q = api(ctx);
      const resuming = Boolean(previous && previous.length);
      const r = await resolveStage(q, { anchors, choices, previous: resuming ? previous : null });
      if (r.failures.length > 0 && r.failures.length === anchors.length) throw qlooError(r.failures[0] as QlooFailure | undefined, ctx.signal);
      if (!resuming) return { outcomes: r.outcomes, issues: r.issues, envelope: r.envelope };
      const outcomes = settleUnanswered(r.outcomes);
      return { outcomes, issues: r.issues.filter((i) => i.kind !== 'ambiguous'), envelope: { ...r.envelope, status: 'ok' } };
    },

    async where({ anchors, ctx }) {
      const q = api(ctx);
      const started = Date.now();
      const first = q.ctx.requests.length;
      const cal = await loadCalibration();
      const location = cal.location === 'query' ? { query: 'New York City' } : { wkt: nycStudyWkt, label: 'NYC study area' };
      const usesBaselineMaps = cal.config.baseline === 'B1' || cal.config.baseline === 'B2' || cal.config.baseline === 'B3';
      const [anchorMaps, baselineMaps, fingerprint] = await Promise.all([
        Promise.all(anchors.map((a) => q.heatmap({ signals: { entities: [a.id] }, location, purpose: 'heatmap' }))),
        Promise.all((usesBaselineMaps ? cal.baselineSignals : []).map((s) => q.heatmap({ signals: s, location, purpose: 'baseline' }))),
        cal.fingerprintSignals ? q.heatmap({ signals: cal.fingerprintSignals, location, purpose: 'baseline' }) : Promise.resolve(null),
      ]);

      const warnings: string[] = [];
      const maps = anchors.flatMap((a, i) => {
        const r = anchorMaps[i]!;
        if (r.ok) return [{ id: a.id, name: a.name, heatmap: r.data, userWeight: 1 }];
        warnings.push(`${a.name}: ${r.message}`);
        return [];
      });
      if (maps.length === 0) throw qlooError(anchorMaps.find((r) => !r.ok) as QlooFailure | undefined, ctx.signal);

      const { result, narration } = computeWhere({
        anchors: maps,
        baselines: baselineMaps.flatMap((r) => (r.ok ? [r.data] : [])),
        defaultFingerprint: fingerprint?.ok ? fingerprint.data : null,
        config: cal.config,
        grid: gridSpec,
        kiosks,
        ntas,
      });
      const envelope = mapTasteLiftEnvelope({
        synthetic: q.synthetic,
        correlationId: ctx.runId,
        durationMs: Date.now() - started,
        requests: q.ctx.requests.slice(first),
        anchors: maps,
        baseline: BASELINE_TEXT[result.config.baseline],
        location: cal.location === 'query' ? 'New York City (Qloo locality)' : 'NYC study polygon',
        cells: result.grid.covered,
        warnings,
      });
      return { result, narration, envelope };
    },

    async evidence({ ntas: top, anchors, ctx }) {
      const q = api(ctx);
      const started = Date.now();
      const first = q.ctx.requests.length;
      const entityIds = anchors.map((a) => a.id);
      const results = await Promise.all(
        top.map((n) =>
          q.places({ wkt: getNta(n.code)!.wkt, label: `NTA ${n.code}`, entityIds, take: PLACES_PER_NTA, explain: true, purpose: 'evidence' }),
        ),
      );
      const warnings: string[] = [];
      const input = top.map((n, i) => {
        const r = results[i]!;
        if (!r.ok) warnings.push(`${n.short}: ${r.message}`);
        return {
          nta: n.code,
          shortName: n.short,
          places: r.ok ? r.data.map((p) => ({ id: p.id, name: p.name, tags: p.tags, explain: p.explain })) : [],
        };
      });
      if (results.every((r) => !r.ok)) throw qlooError(results[0] as QlooFailure | undefined, ctx.signal);
      const packs = buildEvidencePacks(input);
      const envelope = neighborhoodEvidenceEnvelope({
        synthetic: q.synthetic,
        correlationId: ctx.runId,
        durationMs: Date.now() - started,
        requests: q.ctx.requests.slice(first),
        neighborhoods: top.map((n) => ({ code: n.code, short: n.short })),
        anchors,
        places: input.reduce((sum, n) => sum + n.places.length, 0),
        warnings,
      });
      return { packs, envelope };
    },

    async creative({ brief, planner, packs, country, signal, onAttempt }) {
      const contexts: Record<string, CreativeContext> = {};
      for (const pack of packs) {
        const nta = getNta(pack.nta);
        if (!nta) continue;
        contexts[pack.nta] = {
          pack,
          nta,
          brief,
          businessName: brief.business,
          lexicon: LEXICON,
          blockedNames: planner.anchors.map((a) => a.name),
        };
      }
      const tone = planner.tone;
      const r = await gateway.run({
        kind: 'creative',
        schema: creativeSchema,
        name: 'stoop_ads',
        instructions: buildCreativeInstructions(),
        prompt: buildCreativePrompt({
          business: brief.business,
          offer: brief.offer ?? planner.business.offer,
          tone,
          category: planner.business.category,
          about: brief.description,
          packs,
        }),
        country,
        signal: AbortSignal.any([signal, AbortSignal.timeout(CREATIVE_BUDGET_MS)]),
        maxAttempts: 3,
        validate: (out) =>
          finalizeCreative(out.variants, contexts, { via: 'check', tone }).failover ? ['Fewer than half of the ads passed the copy rules'] : [],
        onAttempt: (e) => onAttempt(toAttempt(e)),
      });
      if (r.ok) {
        const via = viaLabel(r.via, r.model);
        return { sets: finalizeCreative(r.data.variants, contexts, { via, tone }).sets, via, attempts: r.attempts.length };
      }
      return { sets: finalizeCreative([], contexts, { via: 'template', tone }).sets, via: 'template', attempts: r.attempts.length };
    },

    release: (ctx) => client.releaseRun(runCtxFor(ctx)),

    plan({ where, topNtas, brief }) {
      return buildMediaPlan({
        kiosks,
        kioskFit: where.kioskFit,
        topNtas,
        budgetUsd: brief.budgetUsd,
        weeks: brief.weeks,
        assumptions: DEFAULT_ASSUMPTIONS,
      });
    },

    proof({ where, llmPicks, plan, brief, packs }) {
      return computeProof({
        where,
        llmPicks,
        plan,
        kiosks,
        kioskFit: where.kioskFit,
        budgetUsd: brief.budgetUsd,
        weeks: brief.weeks,
        assumptions: DEFAULT_ASSUMPTIONS,
        evidenceByNta: Object.fromEntries(packs.map((p) => [p.nta, p.items.map((i) => i.label)])),
      });
    },
  };
}
