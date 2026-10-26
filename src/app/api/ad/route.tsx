import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { NextResponse } from 'next/server';
import { presetRun } from '@/server/agent/presets';
import { loadRun } from '@/server/store/runs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const W = 1080;
const H = 1920;
const FONTS = join(process.cwd(), 'src/assets/fonts');
const [bold, medium] = await Promise.all([
  readFile(join(FONTS, 'BarlowCondensed-Bold.ttf')),
  readFile(join(FONTS, 'BarlowCondensed-Medium.ttf')),
]);

// The "night" screen palette of the mockup (every text color ≥ 7:1 on the background).
const C = { screen: '#0b0c0e', headline: '#f2f0ea', hook: '#ffb547', body: '#d6d3cc', rule: '#2f3238', meta: '#c9c6bf' };

/**
 * One ad as a print-ready 1080×1920 PNG (the portrait street-screen format):
 * `?run=<id>|preset=<slug>&nta=<code>&v=A|B`. The copy is exactly what passed the copy rules.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const runId = url.searchParams.get('run');
  const slug = url.searchParams.get('preset');
  const nta = url.searchParams.get('nta');
  const v = url.searchParams.get('v') === 'B' ? 'B' : 'A';
  const state = runId ? await loadRun(runId) : slug ? await presetRun(slug) : null;
  const set = state?.creative.find((c) => c.nta === nta);
  const ad = set?.variants.find((x) => x.variant === v);
  if (!state || !ad) return NextResponse.json({ error: 'Ad not found' }, { status: 404 });

  const pack = state.evidence.find((p) => p.nta === nta);
  const labelOf = new Map((pack?.items ?? []).map((i) => [i.id, i.label]));
  const hook = [...new Set(ad.references.map((r) => labelOf.get(r.evidenceId)).filter((l): l is string => Boolean(l)))].slice(0, 3);
  const business = state.brief.business;
  const offer = state.brief.offer;
  const address = state.brief.address;
  const file = `${business}-${nta}-${v}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const image = new ImageResponse(
    (
      <div
        style={{
          width: W,
          height: H,
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: C.screen,
          padding: '120px 86px 96px',
          fontFamily: 'Barlow Condensed',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: 760, paddingBottom: 32 }}>
          <div style={{ display: 'flex', fontSize: 156, lineHeight: 0.9, fontWeight: 700, color: C.headline, textTransform: 'uppercase' }}>
            {ad.headline}
          </div>
        </div>
        {hook.length ? (
          <div
            style={{
              display: 'flex',
              borderTop: `8px solid ${C.rule}`,
              paddingTop: 30,
              fontSize: 44,
              fontWeight: 500,
              letterSpacing: 5,
              color: C.hook,
              textTransform: 'uppercase',
            }}
          >
            {hook.join(' · ')}
          </div>
        ) : null}
        <div style={{ display: 'flex', marginTop: 44, fontSize: 70, lineHeight: 1.22, fontWeight: 500, color: C.body }}>{ad.body}</div>
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 'auto', borderTop: `8px solid ${C.rule}`, paddingTop: 44 }}>
          <div style={{ display: 'flex', fontSize: 96, lineHeight: 1, fontWeight: 700, color: C.headline, textTransform: 'uppercase' }}>
            {business}
          </div>
          {offer ? <div style={{ display: 'flex', marginTop: 22, fontSize: 56, fontWeight: 500, color: C.meta }}>{offer}</div> : null}
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 40 }}>
            <div style={{ display: 'flex', maxWidth: 520, fontSize: 40, lineHeight: 1.2, fontWeight: 500, color: C.meta }}>{address ?? ''}</div>
            <div
              style={{
                display: 'flex',
                border: `8px solid ${C.hook}`,
                padding: '18px 30px',
                whiteSpace: 'nowrap',
                fontSize: 60,
                lineHeight: 1,
                fontWeight: 700,
                color: C.hook,
                textTransform: 'uppercase',
              }}
            >
              {`${ad.cta} →`}
            </div>
          </div>
        </div>
      </div>
    ),
    {
      width: W,
      height: H,
      fonts: [
        { name: 'Barlow Condensed', data: bold, weight: 700, style: 'normal' },
        { name: 'Barlow Condensed', data: medium, weight: 500, style: 'normal' },
      ],
    },
  );
  const headers = new Headers(image.headers);
  headers.set('Content-Disposition', `attachment; filename="${file}.png"`);
  headers.set('Cache-Control', 'no-store');
  return new Response(image.body, { status: 200, headers });
}
