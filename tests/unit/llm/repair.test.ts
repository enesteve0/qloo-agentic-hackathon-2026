import { describe, expect, it } from 'vitest';
import { extractJsonText, repairJson } from '@/server/llm/repair';
import { creativeSchema, plannerSchema } from '@/server/llm/schemas';
import { validPlan } from './helpers';

const plan = validPlan();
const json = JSON.stringify(plan);

describe('extractJsonText', () => {
  it('strips code fences, think blocks and surrounding prose', () => {
    expect(extractJsonText('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJsonText('<think>plan {x}</think>Sure! Here it is: {"a":1} Hope this helps.')).toBe('{"a":1}');
    expect(extractJsonText('```\n{"a":{"b":2}}')).toBe('{"a":{"b":2}}');
  });
});

describe('repairJson', () => {
  it('repairs fenced output with trailing commas and single quotes', () => {
    const broken = '```json\n' + json.replace('"tone":"warm"', "'tone':'warm'").replace(/}$/, ',}') + '\n```';
    const out = repairJson(broken, plannerSchema);
    expect(out).toEqual({ ok: true, data: plan });
  });

  it('drops keys the schema does not know', () => {
    const out = repairJson(JSON.stringify({ ...plan, confidence: 0.9, business: { ...plan.business, website: null } }), plannerSchema);
    expect(out).toEqual({ ok: true, data: plan });
  });

  it('fills missing nullable fields with null but not required strings', () => {
    const without = (key: keyof typeof plan) => JSON.stringify({ ...plan, [key]: undefined });
    expect(repairJson(without('budgetUsd'), plannerSchema)).toEqual({ ok: true, data: { ...plan, budgetUsd: null } });
    const out = repairJson(without('audienceSummary'), plannerSchema);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/audienceSummary/);
  });

  it('turns numeric strings into numbers where the schema wants a number', () => {
    expect(repairJson(JSON.stringify({ ...plan, budgetUsd: ' 2000 ', weeks: '3' }), plannerSchema)).toEqual({ ok: true, data: plan });
    expect(repairJson(JSON.stringify({ ...plan, budgetUsd: 'two grand' }), plannerSchema).ok).toBe(false);
  });

  it('unwraps a single-key envelope', () => {
    expect(repairJson(JSON.stringify({ plan }), plannerSchema)).toEqual({ ok: true, data: plan });
    const creative = { variants: [] };
    expect(repairJson(JSON.stringify({ response: creative }), creativeSchema)).toEqual({ ok: true, data: creative });
  });

  it('reports empty and hopeless output', () => {
    expect(repairJson('', plannerSchema)).toEqual({ ok: false, error: 'empty output' });
    expect(repairJson(undefined, plannerSchema)).toEqual({ ok: false, error: 'empty output' });
    expect(repairJson('I cannot help with that.', plannerSchema).ok).toBe(false);
    expect(repairJson('{"anchors": "none"}', plannerSchema).ok).toBe(false);
  });
});
