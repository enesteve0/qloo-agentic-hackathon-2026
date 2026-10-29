import type { Metadata } from 'next';
import { Footer } from '@/components/site/Footer';
import { Header } from '@/components/site/Header';
import { cx } from '@/components/ui/cx';
import { liveAvailability } from '@/server/agent/deps-live';
import { dataMeta } from '@/server/data';
import { getEnv } from '@/server/env';
import { getLlmStatus } from '@/server/llm/gateway';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Status', robots: { index: false } };

type Tone = 'ok' | 'warn' | 'off';

// The marker repeats the word, so the color is never the only cue.
const TONE: Record<Tone, { label: string; marker: string; text: string }> = {
  ok: { label: 'Normal', marker: 'bg-ok', text: 'text-ok' },
  warn: { label: 'Limited', marker: 'bg-amber', text: 'text-amber-text' },
  off: { label: 'Paused', marker: 'bg-danger', text: 'text-danger' },
};
const fmtDate = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'America/New_York' });

async function qlooLine(): Promise<{ tone: Tone; text: string }> {
  const mode = getEnv().QLOO_MODE;
  if (mode === 'mock') return { tone: 'warn', text: 'Demo mode: plans use synthetic taste data and are labelled SYNTHETIC.' };
  const blocked = await liveAvailability();
  if (!blocked) return { tone: 'ok', text: 'Live. New briefs are planned with fresh Qloo taste data.' };
  if (blocked === 'qloo_reserve') return { tone: 'warn', text: 'Saving quota. Saved and recorded plans open normally; new briefs get a labelled sample plan.' };
  return { tone: 'off', text: 'Paused. Saved and recorded plans open normally; new briefs get a labelled sample plan.' };
}

async function writerLine(): Promise<{ tone: Tone; text: string }> {
  const s = await getLlmStatus();
  if (s.mode === 'mock') return { tone: 'warn', text: 'Demo mode: ads come from Stoop’s rule-based writer.' };
  const ready = s.slots.filter((slot) => !slot.disabled && slot.cooldownMs === 0 && slot.usedToday < slot.dailySoftCap).length;
  const total = s.slots.length;
  if (ready === 0) return { tone: 'off', text: 'All free AI writers are busy. Plans still finish, with labelled template copy.' };
  return { tone: ready === total ? 'ok' : 'warn', text: `${ready} of ${total} free AI writers ready. If all are busy, ads fall back to labelled templates.` };
}

/** Public status: plain-language availability only (no quotas, keys or internal numbers). */
export default async function StatusPage() {
  const [qloo, writer] = await Promise.all([qlooLine(), writerLine()]);
  const rows = [
    { label: 'Qloo taste data', ...qloo },
    { label: 'AI writers', ...writer },
    {
      label: 'Street-screen data',
      tone: 'ok' as Tone,
      text: `${dataMeta.counts.kiosks.toLocaleString('en-US')} live ad-capable LinkNYC screens from NYC Open Data, retrieved ${fmtDate.format(new Date(dataMeta.retrievedAt))}.`,
    },
  ];
  return (
    <div className="flex min-h-dvh flex-col">
      <Header current="status" narrow />
      <main id="main" className="flex-1">
        <header className="asphalt border-b-2 border-surface-2">
          <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
            <p className="font-mono text-xs tracking-[0.14em] text-muted uppercase">
              Build {process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local'}
            </p>
            <h1 className="mt-2 font-display text-5xl leading-[0.92] font-bold uppercase sm:text-[64px]">Status</h1>
            <p className="mt-5 max-w-2xl text-lg text-muted">
              What works right now, in plain language. Recorded and saved plans always open, even when live data is paused.
            </p>
          </div>
        </header>
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6">
          <ul className="flex max-w-3xl flex-col divide-y-2 divide-surface-2 border-y-2 border-surface-2">
            {rows.map((r) => (
              <li key={r.label} className="py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h2 className="font-display text-xl leading-tight font-bold uppercase">{r.label}</h2>
                  <p className={cx('flex items-center gap-2 font-display text-base font-bold tracking-[0.06em] uppercase', TONE[r.tone].text)}>
                    <span aria-hidden="true" className={cx('size-3 shrink-0', TONE[r.tone].marker)} />
                    {TONE[r.tone].label}
                  </p>
                </div>
                <p className="mt-1 max-w-2xl text-muted">{r.text}</p>
              </li>
            ))}
          </ul>
          <p className="max-w-3xl text-sm text-muted">
            Every result carries a badge saying where its data came from: LIVE, CACHED, RECORDED, TEMPLATE, QLOO ONLY or SYNTHETIC.
            Prices and impressions are always labelled ASSUMPTION.
          </p>
        </div>
      </main>
      <Footer narrow />
    </div>
  );
}
