import type { Metadata } from 'next';
import Link from 'next/link';
import { liveAvailability } from '@/server/agent/deps-live';
import { dataMeta } from '@/server/data';
import { getEnv } from '@/server/env';
import { getLlmStatus } from '@/server/llm/gateway';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Status', robots: { index: false } };

type Tone = 'ok' | 'warn' | 'off';

const DOT: Record<Tone, string> = { ok: 'bg-ok', warn: 'bg-amber', off: 'bg-danger' };
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
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-8 px-4 py-10 sm:px-6">
      <header className="flex items-center justify-between">
        <Link href="/" className="sign-plate px-2 py-0.5 text-xl text-sign-text no-underline">
          Stoop
        </Link>
        <p className="font-mono text-xs text-muted">build {process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local'}</p>
      </header>
      <h1 className="font-display text-5xl font-bold uppercase">Status</h1>
      <ul className="flex flex-col divide-y-2 divide-surface-2 border-y-2 border-surface-2">
        {rows.map((r) => (
          <li key={r.label} className="flex gap-4 py-4">
            <span aria-hidden className={`mt-2 size-3 shrink-0 rounded-full ${DOT[r.tone]}`} />
            <div>
              <h2 className="font-display text-xl font-bold uppercase">{r.label}</h2>
              <p className="text-muted">{r.text}</p>
            </div>
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted">
        Recorded plans and saved plans always open, even when live data is paused. Every result carries a badge saying where
        its data came from: LIVE, CACHED, RECORDED, TEMPLATE or SYNTHETIC.
      </p>
    </main>
  );
}
