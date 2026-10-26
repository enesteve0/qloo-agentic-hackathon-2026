import { zodSchema } from 'ai';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import {
  createPlannerValidator,
  creativeSchema,
  finalizePlannerOutput,
  normalizeName,
  plannerSchema,
  toPlannerModelOutput,
  type CreativeModelOutput,
  type PlannerModelOutput,
} from '@/server/llm/schemas';
import type { AdVariant, PlannerOutput } from '@/shared/types';
import { NEIGHBORHOODS, validPlan } from './helpers';

type Node = Record<string, unknown>;

/** Visits every schema node, tracking how many objects deep it sits. */
function walk(node: unknown, visit: (n: Node, objectDepth: number) => void, depth = 0): void {
  if (typeof node !== 'object' || node === null) return;
  const n = node as Node;
  const isObject = n.type === 'object' || (Array.isArray(n.type) && n.type.includes('object'));
  const nextDepth = isObject ? depth + 1 : depth;
  visit(n, nextDepth);
  for (const value of Object.values(n)) {
    if (Array.isArray(value)) value.forEach((v) => walk(v, visit, nextDepth));
    else if (typeof value === 'object') walk(value, visit, nextDepth);
  }
}

function assertStrict(json: unknown) {
  let maxDepth = 0;
  walk(json, (n, depth) => {
    maxDepth = Math.max(maxDepth, depth);
    for (const banned of ['default', '$ref', 'minItems', 'maxItems', 'minLength', 'maxLength', 'minimum', 'maximum', 'pattern', 'format']) {
      expect(n, `no "${banned}" keyword`).not.toHaveProperty(banned);
    }
    if (n.type === 'object') {
      expect(n.additionalProperties).toBe(false);
      const props = Object.keys((n.properties ?? {}) as Node).sort();
      expect([...((n.required ?? []) as string[])].sort()).toEqual(props);
    }
    if (Array.isArray(n.enum)) expect(n.enum.length).toBeLessThanOrEqual(8);
  });
  expect(maxDepth).toBeLessThanOrEqual(3);
}

describe.each<[string, z.ZodType]>([
  ['plannerSchema', plannerSchema],
  ['creativeSchema', creativeSchema],
])('%s strictness', (_name, schema) => {
  it('z.toJSONSchema: additionalProperties false on every object, every property required, depth ≤ 3', () => {
    assertStrict(z.toJSONSchema(schema));
  });

  it('the JSON Schema the AI SDK actually sends (draft-7, input) is strict too', async () => {
    assertStrict(await zodSchema(schema).jsonSchema);
    assertStrict(z.toJSONSchema(schema, { target: 'draft-7', io: 'input' }));
  });
});

describe('schema ↔ shared contract', () => {
  it('planner schema output is PlannerOutput without `fallback`', () => {
    expectTypeOf<PlannerModelOutput>().toEqualTypeOf<Omit<PlannerOutput, 'fallback'>>();
  });

  it('creative variants are AdVariant', () => {
    expectTypeOf<CreativeModelOutput['variants'][number]>().toEqualTypeOf<AdVariant>();
  });

  it('accepts a valid plan and rejects stray keys or missing fields', () => {
    expect(plannerSchema.safeParse(validPlan()).success).toBe(true);
    expect(plannerSchema.safeParse({ ...validPlan(), extra: 1 }).success).toBe(false);
    const missing: Partial<ReturnType<typeof validPlan>> = validPlan();
    delete missing.weeks;
    expect(plannerSchema.safeParse(missing).success).toBe(false);
  });
});

describe('finalizePlannerOutput', () => {
  const codes = NEIGHBORHOODS.map((n) => n.code);

  it('dedupes anchors, drops the business itself and caps at 6', () => {
    const raw = plannerSchema.parse({
      ...validPlan(),
      anchors: [
        { name: '  Robert   Glasper ', type: 'artist', searchHint: ' ', why: 'a' },
        { name: 'robert glasper', type: 'artist', searchHint: null, why: 'dup' },
        { name: 'Halfnote', type: 'place', searchHint: null, why: 'the business itself' },
        ...['A', 'B', 'C', 'D', 'E', 'F'].map((n) => ({ name: `Anchor ${n}`, type: 'brand', searchHint: null, why: 'x' })),
        { name: '', type: 'movie', searchHint: null, why: 'empty' },
      ],
    });
    const out = finalizePlannerOutput(raw, { eligibleCodes: codes });
    expect(out.anchors).toHaveLength(6);
    expect(out.anchors[0]).toEqual({ name: 'Robert Glasper', type: 'artist', searchHint: null, why: 'a' });
    expect(out.anchors.map((a) => a.name)).not.toContain('Halfnote');
    expect(out.fallback).toBe(false);
  });

  it('keeps only eligible, distinct neighborhood codes (max 5)', () => {
    const raw = plannerSchema.parse({
      ...validPlan(),
      llmOnlyNeighborhoods: [
        { ntaCode: 'mn0502 ', reason: 'a' },
        { ntaCode: 'MN0502', reason: 'dup' },
        { ntaCode: 'XX9999', reason: 'invented' },
        ...['BK0301', 'BK0102', 'MN0201', 'MN0303', 'QN0103'].map((ntaCode) => ({ ntaCode, reason: 'r' })),
      ],
    });
    const out = finalizePlannerOutput(raw, { eligibleCodes: codes });
    expect(out.llmOnlyNeighborhoods.map((n) => n.ntaCode)).toEqual(['MN0502', 'BK0301', 'BK0102', 'MN0201', 'MN0303']);
  });

  it('nulls non-positive numbers and rounds weeks', () => {
    const out = finalizePlannerOutput(plannerSchema.parse({ ...validPlan(), budgetUsd: -5, weeks: 2.6 }));
    expect(out.budgetUsd).toBeNull();
    expect(out.weeks).toBe(3);
  });

  it('round-trips through toPlannerModelOutput', () => {
    const out = finalizePlannerOutput(plannerSchema.parse(validPlan()), { eligibleCodes: codes });
    expect(plannerSchema.parse(toPlannerModelOutput(out))).toEqual(toPlannerModelOutput(out));
  });

  it('normalizes names like the resolver', () => {
    expect(normalizeName('  The Marías & Friends!')).toBe('marias and friends');
  });
});

describe('createPlannerValidator', () => {
  const validate = createPlannerValidator(NEIGHBORHOODS.map((n) => n.code));

  it('passes a good plan', () => {
    expect(validate(plannerSchema.parse(validPlan()))).toEqual([]);
  });

  it('rejects too few anchors or invented neighborhood codes', () => {
    const raw = plannerSchema.parse({
      ...validPlan(),
      anchors: [validPlan().anchors[0]],
      llmOnlyNeighborhoods: [{ ntaCode: 'ZZ0001', reason: 'x' }],
    });
    const problems = validate(raw);
    expect(problems).toHaveLength(2);
    expect(problems.join(' ')).toMatch(/anchors/);
    expect(problems.join(' ')).toMatch(/neighborhood codes/);
  });

  it('skips the neighborhood check without an eligible list', () => {
    const raw = plannerSchema.parse({ ...validPlan(), llmOnlyNeighborhoods: [] });
    expect(createPlannerValidator()(raw)).toEqual([]);
  });
});
