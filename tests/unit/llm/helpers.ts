import { APICallError } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { MemoryKV, setKvForTests } from '@/server/kv';
import type { LlmKind } from '@/server/llm/gateway';
import type { NeighborhoodRef } from '@/server/llm/prompts';
import type { LlmSlot } from '@/server/llm/slots';
import type { Brief, EvidencePack } from '@/shared/types';

type DoGenerate = MockLanguageModelV4['doGenerate'];
type GenerateResult = Awaited<ReturnType<DoGenerate>>;

export const T0 = Date.parse('2026-10-26T12:00:00Z');

/** Fake clock shared by MemoryKV and the chain. */
export function useFakeKv(start = T0) {
  const clock = { now: start };
  const store = new MemoryKV(() => clock.now);
  setKvForTests(store);
  return { clock, store, now: () => clock.now };
}

export function textResult(text: string, finish: 'stop' | 'length' = 'stop'): GenerateResult {
  return {
    content: [{ type: 'text', text }],
    finishReason: { unified: finish, raw: finish },
    usage: {
      inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 20, text: 20, reasoning: undefined },
    },
    warnings: [],
  };
}

export function jsonResult(value: unknown): GenerateResult {
  return textResult(JSON.stringify(value));
}

export function apiError(statusCode: number | undefined, extra: Partial<ConstructorParameters<typeof APICallError>[0]> = {}) {
  return new APICallError({
    message: `HTTP ${statusCode ?? 'network'}`,
    url: 'https://example.invalid/v1/chat/completions',
    requestBodyValues: {},
    statusCode,
    ...extra,
  });
}

/** A model whose every call runs `behavior`; calls are recorded in `doGenerateCalls`. */
export function mockModel(modelId: string, behavior: DoGenerate) {
  return new MockLanguageModelV4({ provider: 'mock', modelId, doGenerate: behavior });
}

export interface MockSlotOptions {
  /** Behavior per kind (defaults to the same behavior for both). */
  behavior: DoGenerate | Partial<Record<LlmKind, DoGenerate>>;
  models?: Partial<Record<LlmKind, string>>;
  geoGated?: boolean;
  dailySoftCap?: number;
  jsonSkeleton?: boolean;
}

export function mockSlot(id: string, opts: MockSlotOptions): LlmSlot & { mocks: Record<LlmKind, MockLanguageModelV4> } {
  const ids = { planner: opts.models?.planner ?? `${id}-planner-model`, creative: opts.models?.creative ?? `${id}-creative-model` };
  const pick = (kind: LlmKind): DoGenerate => {
    const b = opts.behavior;
    if (typeof b === 'function') return b;
    return b[kind] ?? (async () => textResult('{}'));
  };
  const mocks = { planner: mockModel(ids.planner, pick('planner')), creative: mockModel(ids.creative, pick('creative')) };
  return {
    id,
    label: id,
    models: mocks,
    modelIds: ids,
    callOptions: {},
    jsonSkeleton: opts.jsonSkeleton ?? false,
    geoGated: opts.geoGated ?? false,
    dailySoftCap: opts.dailySoftCap ?? 1000,
    mocks,
  };
}

/** Rejects when the call's abort signal fires (never resolves otherwise). */
export const hangUntilAborted: DoGenerate = (options) =>
  new Promise((_, reject) => {
    const signal = options.abortSignal;
    if (signal?.aborted) reject(signal.reason);
    signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
  });

export const NEIGHBORHOODS: NeighborhoodRef[] = [
  { code: 'MN0502', name: 'Midtown-Times Square' },
  { code: 'BK0301', name: 'Bedford-Stuyvesant (West)' },
  { code: 'BK0102', name: 'Williamsburg' },
  { code: 'MN0201', name: 'SoHo-Little Italy-Hudson Square' },
  { code: 'MN0303', name: 'East Village' },
  { code: 'QN0103', name: 'Astoria (Central)' },
  { code: 'BK0601', name: 'Park Slope' },
  { code: 'BX0101', name: 'Mott Haven-Port Morris' },
];

export const HALFNOTE: Brief = {
  business: 'Halfnote',
  description: 'A 48-seat jazz supper club opening on Nostrand Ave in Bed-Stuy; Tuesday jam nights, soul-food menu.',
  offer: 'Half-price first round on Tuesdays',
  budgetUsd: 2000,
  weeks: 3,
  startDate: '2026-11-16',
  address: '1 Example Ave, Brooklyn, NY',
};

export const PACKS: Pick<EvidencePack, 'nta' | 'shortName' | 'items'>[] = [
  {
    nta: 'BK0301',
    shortName: 'Bed-Stuy',
    items: [
      { id: 'ev:BK0301:live_music', kind: 'tag', label: 'Live Music', tagType: 'ambience', weight: 0.4, support: 6 },
      { id: 'ev:BK0301:soul_food', kind: 'category', label: 'Soul Food', tagType: 'cuisine', weight: 0.3, support: 4 },
    ],
  },
  {
    nta: 'BK0102',
    shortName: 'Williamsburg',
    items: [{ id: 'ev:BK0102:cocktails', kind: 'tag', label: 'Craft Cocktails', tagType: 'good_for', weight: 0.5, support: 7 }],
  },
];

/** A schema-valid planner answer for the sample neighborhoods. */
export function validPlan() {
  return {
    business: { name: 'Halfnote', category: 'jazz supper club', offer: 'Half-price first round on Tuesdays' },
    audienceSummary: 'A taste for modern jazz and soul.',
    anchors: [
      { name: 'Robert Glasper', type: 'artist', searchHint: 'jazz pianist', why: 'Modern jazz with soul.' },
      { name: 'Soul', type: 'movie', searchHint: '2020', why: 'Jazz-loving animated film.' },
      { name: 'Blue Note Jazz Club', type: 'place', searchHint: 'New York, NY', why: 'Landmark jazz room.' },
    ],
    tone: 'warm',
    llmOnlyNeighborhoods: [
      { ntaCode: 'MN0502', reason: 'Busy.' },
      { ntaCode: 'BK0301', reason: 'Close by.' },
      { ntaCode: 'BK0102', reason: 'Nightlife.' },
      { ntaCode: 'MN0201', reason: 'Shopping.' },
      { ntaCode: 'MN0303', reason: 'Bars.' },
    ],
    budgetUsd: 2000,
    weeks: 3,
  };
}
