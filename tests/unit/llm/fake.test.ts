import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetEnvForTests } from '@/server/env';
import { createFakeGateway, FAKE_MODEL, FAKE_SLOT, fakeCreativeOutput } from '@/server/llm/fake';
import { getLlmGateway, getLlmStatus, setLlmGatewayForTests, type LlmGateway } from '@/server/llm/gateway';
import { runPlanner } from '@/server/llm/planner';
import { buildCreativeInstructions, buildCreativePrompt, COPY_LIMITS, type CreativePromptInput } from '@/server/llm/prompts';
import { creativeSchema, plannerSchema } from '@/server/llm/schemas';
import { SLOT_IDS } from '@/server/llm/slots';
import { HALFNOTE, NEIGHBORHOODS, PACKS, useFakeKv } from './helpers';

const KEY_VARS = ['GROQ_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'SAMBANOVA_API_KEY', 'OPENROUTER_API_KEY', 'LLM_MODE'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  // Never let a developer's real keys reach a test: no network, ever.
  for (const key of KEY_VARS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  process.env.LLM_MODE = 'mock';
  resetEnvForTests();
  setLlmGatewayForTests(undefined);
  useFakeKv();
});

afterEach(() => {
  for (const key of KEY_VARS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  resetEnvForTests();
  setLlmGatewayForTests(undefined);
});

const signal = () => new AbortController().signal;

describe('getLlmGateway', () => {
  it('returns the deterministic fake when LLM_MODE=mock', async () => {
    const result = await runPlanner({ brief: HALFNOTE, neighborhoods: NEIGHBORHOODS, country: null, signal: signal(), gateway: getLlmGateway() });
    expect(result.via).toBe(FAKE_SLOT);
    expect(result.model).toBe(FAKE_MODEL);
    expect(getLlmGateway()).toBe(getLlmGateway());
  });

  it('returns the provider chain when LLM_MODE=live (no keys → no slots, no network)', async () => {
    process.env.LLM_MODE = 'live';
    resetEnvForTests();
    const result = await getLlmGateway().run({
      kind: 'planner',
      schema: plannerSchema,
      name: 'stoop_plan',
      instructions: 'x',
      prompt: 'y',
      country: 'US',
      signal: signal(),
      maxAttempts: 2,
    });
    expect(result).toMatchObject({ ok: false, reason: 'no_slots', attempts: [] });
  });

  it('reports slot status without calling any model', async () => {
    process.env.GROQ_API_KEY = 'test-key';
    resetEnvForTests();
    const status = await getLlmStatus();
    expect(status.mode).toBe('mock');
    expect(status.slots.map((s) => s.id)).toEqual(['groq']);
    expect(status.slots[0]).toMatchObject({ disabled: false, cooldownMs: 0, usedToday: 0, geoGated: false });
    expect(status.unconfigured).toEqual(SLOT_IDS.filter((id) => id !== 'groq'));
  });
});

describe('runPlanner', () => {
  it('uses the model plan (finalized, brief numbers authoritative) when the gateway succeeds', async () => {
    const events: string[] = [];
    const result = await runPlanner({
      brief: { ...HALFNOTE, budgetUsd: 2500 },
      neighborhoods: NEIGHBORHOODS,
      country: null,
      signal: signal(),
      gateway: createFakeGateway(),
      onAttempt: (e) => events.push(e.outcome),
    });
    expect(result.fallbackReason).toBeNull();
    expect(result.plan.fallback).toBe(false);
    expect(result.plan.anchors.map((a) => a.name)).toEqual(['Robert Glasper', 'Esperanza Spalding', 'Kamasi Washington']);
    expect(result.plan.llmOnlyNeighborhoods).toHaveLength(5);
    expect(result.plan.llmOnlyNeighborhoods.every((n) => NEIGHBORHOODS.some((h) => h.code === n.ntaCode))).toBe(true);
    expect(result.plan.budgetUsd).toBe(2500);
    expect(result.plan.weeks).toBe(3);
    expect(events).toEqual(['ok']);
  });

  it('falls back to the deterministic planner when every slot fails', async () => {
    const failing: LlmGateway = { run: async () => ({ ok: false, reason: 'exhausted', attempts: [], skipped: [] }) };
    const result = await runPlanner({ brief: HALFNOTE, neighborhoods: NEIGHBORHOODS, busyNtaCodes: ['BK0102'], country: 'US', signal: signal(), gateway: failing });
    expect(result).toMatchObject({ via: null, model: null, fallbackReason: 'exhausted' });
    expect(result.plan.fallback).toBe(true);
    expect(result.plan.llmOnlyNeighborhoods[0]?.ntaCode).toBe('BK0102');
  });

  it('degrades to the fallback on abort', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runPlanner({ brief: HALFNOTE, neighborhoods: NEIGHBORHOODS, country: null, signal: controller.signal, gateway: createFakeGateway() });
    expect(result).toMatchObject({ fallbackReason: 'aborted', via: null });
    expect(result.plan.fallback).toBe(true);
  });
});

describe('fake creative writer', () => {
  const input: CreativePromptInput = { business: 'Halfnote', offer: 'Half-price first round on Tuesdays', tone: 'warm', category: 'jazz supper club', packs: PACKS };
  const allNames = PACKS.map((p) => p.shortName);

  async function write(overrides: Partial<CreativePromptInput> = {}) {
    const result = await createFakeGateway().run({
      kind: 'creative',
      schema: creativeSchema,
      name: 'stoop_ads',
      instructions: buildCreativeInstructions(),
      prompt: buildCreativePrompt({ ...input, ...overrides }),
      country: null,
      signal: signal(),
      maxAttempts: 3,
    });
    if (!result.ok) throw new Error('fake creative failed');
    return result.data.variants;
  }

  it('writes variants A and B for every neighborhood', async () => {
    const variants = await write();
    expect(variants.map((v) => `${v.nta}:${v.variant}`)).toEqual(['BK0301:A', 'BK0301:B', 'BK0102:A', 'BK0102:B']);
  });

  it.each([
    ['with an offer', {}],
    ['without an offer', { offer: null }],
    ['with a long business name and offer', { business: 'The Extremely Long Named Neighborhood Supper Club', offer: 'Half-price first round of drinks every single Tuesday night all season long' }],
  ] as const)('follows the copy rules %s', async (_label, overrides) => {
    const business = 'business' in overrides ? overrides.business : input.business;
    const offer = 'offer' in overrides ? overrides.offer : input.offer;
    for (const v of await write(overrides)) {
      const copy = `${v.headline} ${v.body} ${v.cta}`;
      expect(v.headline.length).toBeLessThanOrEqual(COPY_LIMITS.headline);
      expect(v.headline.split(' ').length).toBeLessThanOrEqual(COPY_LIMITS.headlineWords);
      expect(v.body.length).toBeLessThanOrEqual(COPY_LIMITS.body);
      expect(v.cta.length).toBeLessThanOrEqual(COPY_LIMITS.cta);
      expect(copy).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(copy).toContain(business);
      expect(v.references.length).toBeGreaterThan(0);
      const pack = PACKS.find((p) => p.nta === v.nta);
      for (const ref of v.references) {
        expect(pack?.items.map((i) => i.id)).toContain(ref.evidenceId);
        expect(copy).toContain(ref.phrase);
      }
      for (const other of allNames.filter((n) => n !== pack?.shortName)) expect(copy).not.toContain(other);
      for (const digits of copy.match(/\d+/g) ?? []) expect(offer ?? '').toContain(digits);
    }
  });

  it('is deterministic and skips labels with invented numbers', () => {
    const prompt = buildCreativePrompt({
      ...input,
      offer: null,
      packs: [{ nta: 'BK0301', shortName: 'Bed-Stuy', items: [{ id: 'ev:1', kind: 'tag', label: '24 Hour', tagType: 'x', weight: 1, support: 3 }, { id: 'ev:2', kind: 'tag', label: 'Late Night', tagType: 'x', weight: 1, support: 3 }] }],
    });
    expect(fakeCreativeOutput(prompt)).toEqual(fakeCreativeOutput(prompt));
    const refs = fakeCreativeOutput(prompt).variants.flatMap((v) => v.references.map((r) => r.evidenceId));
    expect(refs).not.toContain('ev:1');
    expect(refs).toContain('ev:2');
  });
});
