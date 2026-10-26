import { ArrowRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ProvenanceBadge } from '@/components/run/ProvenanceBadge';
import { badgeExplanation, type BadgeKind } from '@/components/run/model';
import { Footer } from '@/components/site/Footer';
import { Header } from '@/components/site/Header';
import { buttonClass } from '@/components/ui/button';
import { PRESETS } from '@/content/presets';
import meta from '@/data/meta.json';
import { getEnv } from '@/server/env';

export const metadata: Metadata = {
  title: 'For judges',
  description: 'A 60-second tour of Stoop: what to click, what each label means, and what is live, recorded or synthetic.',
};

// Static, refreshed every few minutes so the "right now" box follows the deployment's mode.
export const revalidate = 300;

const TOUR: { title: string; text: string; href?: string; cta?: string }[] = [
  {
    title: 'Open the sample plan',
    text: 'WHERE: the night map of taste lift, the plan’s screens and the neighborhoods ranked by their multiplier. Scroll the list to “Busy, but off-taste: skipped”.',
    href: '/p/halfnote',
    cta: 'Halfnote, WHERE',
  },
  {
    title: 'See the ads',
    text: 'WHAT: two ads per neighborhood on a street-screen mockup under the real cross streets, the Qloo evidence each phrase comes from, and the copy-rule check.',
    href: '/p/halfnote?view=what',
    cta: 'Halfnote, WHAT',
  },
  {
    title: 'Check the proof',
    text: 'PROOF: the same brief planned without Qloo and scored on the same map, with the circularity said out loud.',
    href: '/p/halfnote?view=proof',
    cta: 'Halfnote, PROOF',
  },
  {
    title: 'Open the agent log',
    text: 'The Agent log button in any plan’s header: every step and decision, and every Qloo request with keys removed. “Copy redacted trace” copies it all.',
  },
  {
    title: 'Plan your own',
    text: 'Type a brief, for example “Ramen counter in Astoria, $1,000, 2 weeks”, answer the one question if it asks, and watch the stations fill in.',
    href: '/plan/new',
    cta: 'Plan a campaign',
  },
];

const BADGES: { kind: BadgeKind; detail?: string }[] = [
  { kind: 'synthetic' },
  { kind: 'live', detail: 'model' },
  { kind: 'recorded', detail: 'date' },
  { kind: 'cached', detail: 'time' },
  { kind: 'template' },
  { kind: 'qloo_only' },
  { kind: 'assumption' },
];

const NOW: Record<'mock' | 'live' | 'cache-only' | 'off', { title: string; text: string }> = {
  mock: {
    title: 'Sample mode',
    text: 'The Qloo key is not active yet, so every plan you open or make is labelled SYNTHETIC: synthetic taste data on the real street screens and neighborhoods. When the key is active, sample plans become RECORDED live runs and new briefs run LIVE.',
  },
  live: {
    title: 'Live',
    text: 'New briefs call Qloo and the AI writers live and are labelled LIVE. Sample plans replay recorded live runs and are labelled RECORDED.',
  },
  'cache-only': {
    title: 'Saved data only',
    text: 'Sample and saved plans open normally. New briefs are answered from saved Qloo data where it exists; otherwise you get a labelled sample plan.',
  },
  off: {
    title: 'Live planning paused',
    text: 'Sample and saved plans open normally; new briefs get a labelled sample plan.',
  },
};

const linkCls = 'underline underline-offset-4';

export default function JudgesPage() {
  const env = getEnv();
  const now = NOW[env.QLOO_MODE];
  return (
    <div className="flex min-h-dvh flex-col">
      <Header current="judges" />
      <main id="main" className="flex-1">
        <header className="asphalt border-b-2 border-surface-2">
          <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-end">
            <div>
              <p className="font-mono text-xs tracking-[0.14em] text-muted uppercase">For judges</p>
              <h1 className="mt-2 font-display text-5xl leading-[0.92] font-bold uppercase sm:text-[64px]">The 60-second tour</h1>
              <p className="mt-5 max-w-2xl text-lg text-muted">
                What to click, what each label means, and what is live, recorded or synthetic. No login and nothing to install.
              </p>
            </div>
            <div className="led-panel border-2 border-[#1d1f23] p-4">
              <p className="font-mono text-[11px] tracking-[0.14em] text-[#d9a24a] uppercase">Right now</p>
              <p className="led-glow mt-2 font-display text-[28px] leading-none font-bold tracking-[0.05em] text-[#ffb547] uppercase">
                {now.title}
              </p>
              <p className="mt-3 text-sm leading-relaxed text-[#e6dcc8]">{now.text}</p>
              <Link href="/status" className="mt-3 inline-flex min-h-8 items-center gap-1 text-sm text-[#ffd391]! underline underline-offset-4">
                Live status
              </Link>
            </div>
          </div>
        </header>

        <div className="mx-auto flex w-full max-w-6xl flex-col gap-16 px-4 py-12 sm:px-6">
          <section aria-labelledby="tour-h">
            <h2 id="tour-h" className="font-display text-[40px] leading-none font-bold uppercase">
              Five stops
            </h2>
            <ol className="mt-6 flex flex-col border-t-2 border-surface-2">
              {TOUR.map((step, k) => (
                <li
                  key={step.title}
                  className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-4 gap-y-3 border-b-2 border-surface-2 py-5 sm:grid-cols-[5rem_minmax(0,1fr)_auto] sm:items-center"
                >
                  <span aria-hidden="true" className="font-display text-[64px] leading-[0.8] font-bold text-amber tabular-nums">
                    {k + 1}
                  </span>
                  <div className="min-w-0">
                    <h3 className="font-display text-[28px] leading-none font-bold uppercase">
                      <span className="sr-only">Stop {k + 1}: </span>
                      {step.title}
                    </h3>
                    <p className="mt-2 max-w-2xl text-muted">{step.text}</p>
                  </div>
                  {step.href ? (
                    <Link href={step.href} className={buttonClass('secondary', 'md', 'col-start-2 justify-self-start sm:col-start-3')}>
                      {step.cta}
                      <ArrowRight aria-hidden="true" className="size-4" />
                    </Link>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>

          <div className="grid gap-12 lg:grid-cols-2">
            <section aria-labelledby="two-h">
              <h2 id="two-h" className="font-display text-[28px] leading-none font-bold uppercase">
                Check it in two minutes
              </h2>
              <ul className="mt-5 flex list-disc flex-col gap-3 pl-5 marker:text-muted">
                <li>
                  Open{' '}
                  <Link href="/p/halfnote" className={linkCls}>
                    the Halfnote sample plan
                  </Link>{' '}
                  and click the strongest neighborhood: the map flies there.
                </li>
                <li>On WHAT, click an evidence chip: it opens the Qloo request behind that evidence.</li>
                <li>On PROOF, compare the two columns and read the circularity note.</li>
                <li>
                  <Link href="/plan/new" className={linkCls}>
                    Type your own brief
                  </Link>{' '}
                  and answer the one question if the agent asks.
                </li>
                <li>Open the agent log on any plan and copy the redacted trace.</li>
                <li>
                  Read the{' '}
                  <Link href="/how-it-works#limits" className={linkCls}>
                    limits
                  </Link>{' '}
                  and{' '}
                  <Link href="/how-it-works#privacy" className={linkCls}>
                    privacy
                  </Link>{' '}
                  notes, then the{' '}
                  <Link href="/status" className={linkCls}>
                    status page
                  </Link>
                  .
                </li>
              </ul>
            </section>

            <section aria-labelledby="real-h">
              <h2 id="real-h" className="font-display text-[28px] leading-none font-bold uppercase">
                What is real
              </h2>
              <dl className="mt-5 flex flex-col divide-y-2 divide-surface-2 border-y-2 border-surface-2">
                <div className="grid gap-1 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
                  <dt className="font-display font-bold tracking-[0.06em] uppercase">Always real</dt>
                  <dd className="text-muted">
                    The {meta.counts.kiosks.toLocaleString('en-US')} street screens, their cross streets and the 2020
                    neighborhoods (NYC Open Data), and the map (OpenStreetMap).
                  </dd>
                </div>
                <div className="grid gap-1 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
                  <dt className="font-display font-bold tracking-[0.06em] uppercase">Taste data</dt>
                  <dd className="text-muted">
                    {env.QLOO_MODE === 'mock'
                      ? 'Synthetic for now, labelled SYNTHETIC on every plan.'
                      : 'From the Qloo Insights API: LIVE for new plans, RECORDED for sample plans.'}
                  </dd>
                </div>
                <div className="grid gap-1 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
                  <dt className="font-display font-bold tracking-[0.06em] uppercase">AI writers</dt>
                  <dd className="text-muted">
                    {env.LLM_MODE === 'mock'
                      ? 'A deterministic stand-in writer for now; free-tier models once their keys are set.'
                      : 'Free-tier models. When all are busy, rules and templates write from the same evidence, labelled TEMPLATE.'}
                  </dd>
                </div>
                <div className="grid gap-1 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
                  <dt className="font-display font-bold tracking-[0.06em] uppercase">Prices</dt>
                  <dd className="text-muted">Assumptions, labelled ASSUMPTION. No campaign has run.</dd>
                </div>
              </dl>
            </section>
          </div>

          <section aria-labelledby="badges-h">
            <h2 id="badges-h" className="font-display text-[28px] leading-none font-bold uppercase">
              What each label means
            </h2>
            <ul className="mt-5 grid gap-x-8 gap-y-0 border-t-2 border-surface-2 md:grid-cols-2">
              {BADGES.map((b) => (
                <li key={b.kind} className="flex flex-col gap-2 border-b-2 border-surface-2 py-4">
                  <span>
                    <ProvenanceBadge kind={b.kind} detail={b.detail} />
                  </span>
                  <span className="text-muted">{badgeExplanation(b.kind, b.detail === 'model' ? b.detail : null)}</span>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="samples-h">
            <h2 id="samples-h" className="font-display text-[28px] leading-none font-bold uppercase">
              All sample plans
            </h2>
            <ul className="mt-5 flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <li key={p.slug}>
                  <Link href={`/p/${p.slug}`} className={buttonClass('outline', 'md')}>
                    {p.brief.business}
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="fair-h" className="border-2 border-amber p-5">
            <h2 id="fair-h" className="font-display text-[28px] leading-none font-bold uppercase">
              Fair use
            </h2>
            <p className="mt-3 max-w-3xl">
              Live runs spend the event’s shared Qloo quota and free AI capacity, so each visitor gets 3 live runs in 15 minutes and
              8 a day. Sample plans cost nothing; open as many as you like. If a limit is reached you get a banner and a labelled
              sample plan, never an error page.
            </p>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}
