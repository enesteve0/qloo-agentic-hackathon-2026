import { describe, expect, it } from 'vitest';
import { applyPart, emptyRunView, readUiMessageSse } from '@/shared/stream';

const sse = (events: string[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      // Split mid-event to prove the parser buffers across chunks.
      const text = events.join('');
      controller.enqueue(enc.encode(text.slice(0, 17)));
      controller.enqueue(enc.encode(text.slice(17)));
      controller.close();
    },
  });

describe('readUiMessageSse', () => {
  it('parses data events across chunk boundaries and stops at [DONE]', async () => {
    const body = sse([
      'data: {"type":"start"}\n\n',
      ': keep-alive\n\n',
      'data: {"type":"data-progress","data":{"text":"Mapping taste"}}\n\n',
      'data: [DONE]\n\n',
      'data: {"type":"never"}\n\n',
    ]);
    const out = [];
    for await (const chunk of readUiMessageSse(body)) out.push(chunk);
    expect(out).toEqual([{ type: 'start' }, { type: 'data-progress', data: { text: 'Mapping taste' } }]);
  });
});

describe('applyPart', () => {
  it('builds a run view from parts and replaces parts with the same key', () => {
    let v = emptyRunView();
    v = applyPart(v, { type: 'data-stage', data: { stage: 'plan', status: 'running', title: 'x', detail: null, ms: null } });
    expect(v.state).toBeNull(); // parts before `run` are ignored
    v = applyPart(v, {
      type: 'data-run',
      data: { runId: 'r1', mode: 'mock', startedAt: '2026-10-26T00:00:00Z', presetSlug: null, businessName: 'Halfnote' },
    });
    v = applyPart(v, { type: 'data-stage', data: { stage: 'plan', status: 'running', title: 'Planning', detail: null, ms: null } });
    v = applyPart(v, { type: 'data-stage', data: { stage: 'plan', status: 'done', title: 'Planning', detail: null, ms: 900 } });
    v = applyPart(v, { type: 'data-progress', data: { text: 'Scoring 2,183 street screens' } });
    expect(v.state?.stages).toHaveLength(1);
    expect(v.state?.stages[0]?.status).toBe('done');
    expect(v.progress).toBe('Scoring 2,183 street screens');
    v = applyPart(v, { type: 'data-done', data: { runId: 'r1', status: 'done', error: null } });
    expect(v.done).toBe(true);
    expect(v.progress).toBeNull();
    expect(v.state?.status).toBe('done');
    expect(applyPart(v, { type: 'text-delta' })).toBe(v);
  });

  it('loads a snapshot and keeps a resumed run when it announces itself again', () => {
    const run = { runId: 'r2', mode: 'mock' as const, startedAt: '2026-10-26T00:00:00Z', presetSlug: null, businessName: 'Halfnote' };
    const paused = applyPart(applyPart(emptyRunView(), { type: 'data-run', data: run }), {
      type: 'data-decision',
      data: { stage: 'plan', text: 'Anchors for this audience: Robert Glasper (artist).' },
    });
    const saved = { ...paused.state!, status: 'awaiting_input' as const };

    let v = applyPart(emptyRunView(), { type: 'data-fallback', data: { reason: 'limits', presetSlug: 'halfnote', message: 'Busy' } });
    v = applyPart(v, { type: 'data-snapshot', data: saved });
    expect(v.fallback?.reason).toBe('limits');
    expect(v.needsInput).toEqual([]);
    expect(v.done).toBe(false);
    expect(v.state?.decisions).toHaveLength(1);

    v = applyPart(v, { type: 'data-run', data: run });
    expect(v.state?.decisions).toHaveLength(1); // not reset to an empty skeleton
    expect(v.state?.status).toBe('running');
    expect(v.needsInput).toBeNull();

    v = applyPart(v, { type: 'data-run', data: { ...run, runId: 'r3' } });
    expect(v.state?.id).toBe('r3');
    expect(v.state?.decisions).toHaveLength(0);
  });
});
