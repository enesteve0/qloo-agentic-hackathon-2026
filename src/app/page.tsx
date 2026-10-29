import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import MapClient from '@/components/map/MapClient';
import { Footer } from '@/components/site/Footer';
import { Header } from '@/components/site/Header';
import { buttonClass } from '@/components/ui/button';
import { StreetPlate } from '@/components/ui/StreetPlate';
import { PRESETS } from '@/content/presets';
import meta from '@/data/meta.json';
import { getEnv } from '@/server/env';

// Static, refreshed every few minutes so the status line follows the deployment's Qloo mode.
export const revalidate = 300;

const fmt = new Intl.NumberFormat('en-US');
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const STATUS: Record<'mock' | 'live' | 'cache-only' | 'off', string> = {
  mock: 'Sample mode: plans use labelled synthetic taste data until the Qloo key is live',
  live: 'Live: new plans use fresh Qloo taste data',
  'cache-only': 'Saved and sample plans open now; new live plans resume soon',
  off: 'Saved and sample plans open now; live planning is paused',
};

const STEPS: { plate: string; title: string; text: string }[] = [
  { plate: 'Brief', title: 'Tell it about the business', text: 'The offer, the budget, the dates. Your words never go to Qloo.' },
  {
    plate: 'Taste',
    title: 'It names what your customers love',
    text: 'Artists, places, brands, films. Qloo maps where that taste over-indexes across the city.',
  },
  {
    plate: 'Where · What',
    title: 'It picks screens and writes the ads',
    text: 'Street screens ranked by taste fit, and an ad for each neighborhood built from local evidence.',
  },
  { plate: 'Send', title: 'You approve and send', text: 'A budget plan with labelled assumptions and a booking email. Stoop never buys anything.' },
];

export default function Home() {
  const { counts } = meta;
  const mode = getEnv().QLOO_MODE;
  return (
    <div className="flex min-h-dvh flex-col">
      <Header current="home" narrow />

      <main id="main" className="flex flex-1 flex-col">
        <section className="asphalt">
          <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-10 sm:px-6 lg:grid-cols-[1.2fr_1fr] lg:py-16">
            <div className="flex flex-col gap-5">
              <h1 className="font-display text-5xl leading-[0.95] font-bold uppercase sm:text-6xl lg:text-7xl">
                Most ad tech knows where phones go.
                <span className="mt-2 block text-amber">Stoop knows what neighborhoods love.</span>
              </h1>
              <p className="max-w-xl text-lg text-muted">
                The AI media planner for New York&apos;s street screens. Describe your business and budget. In about a minute,
                Stoop picks the screens, writes an ad for each neighborhood, and shows the Qloo taste evidence behind every
                choice.
              </p>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Link href="/plan/new" className={buttonClass('primary', 'lg')}>
                  Plan my campaign
                  <ArrowRight aria-hidden="true" className="size-5" />
                </Link>
                <Link href="/p/halfnote" className={buttonClass('secondary', 'lg')}>
                  Open a sample plan
                </Link>
              </div>
              <p className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <Link
                  href="/judges"
                  className="inline-flex min-h-8 items-center gap-1.5 font-display text-base font-bold tracking-[0.06em] uppercase underline-offset-4 hover:underline"
                >
                  Judging? 60-second tour
                  <ArrowRight aria-hidden="true" className="size-4" />
                </Link>
                <Link href="/status" className="ticker inline-flex min-h-8 items-center gap-2 text-sm hover:underline">
                  <span aria-hidden="true" className="size-2 shrink-0 bg-amber" />
                  {STATUS[mode]}
                </Link>
              </p>
            </div>
            <dl className="grid grid-cols-2 gap-px self-end border-2 border-surface-2 bg-surface-2">
              {[
                [fmt.format(counts.kiosks), 'live ad-capable street screens'],
                [fmt.format(counts.eligibleNtas), 'neighborhoods with 2+ screens'],
                [fmt.format(counts.gridCells), 'taste-map cells over the city'],
                ['0', 'phones tracked'],
              ].map(([value, label]) => (
                // Numbers sit on one line across a row, however the labels above them wrap.
                <div key={label} className="flex flex-col justify-between gap-1 bg-bg p-4">
                  <dt className="text-sm text-muted">{label}</dt>
                  <dd className="font-display text-4xl font-bold text-text tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section aria-labelledby="map-heading" className="border-y-2 border-surface-2">
          <h2 id="map-heading" className="sr-only">
            Every live LinkNYC street screen in New York City
          </h2>
          <div className="h-[62vh] min-h-[420px] w-full">
            <MapClient
              className="h-full w-full"
              ariaLabel={`Night map of New York City showing ${fmt.format(counts.kiosks)} live ad-capable LinkNYC street screens`}
            />
          </div>
        </section>

        <section aria-labelledby="how-heading" className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h2 id="how-heading" className="font-display text-[40px] leading-none font-bold uppercase">
              How it works
            </h2>
            <Link
              href="/how-it-works"
              className="inline-flex min-h-8 items-center gap-1.5 font-display text-base font-bold tracking-[0.06em] uppercase underline-offset-4 hover:underline"
            >
              The method, data and limits
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </div>
          <ol className="relative mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
            <span aria-hidden="true" className="absolute top-5 right-0 left-0 hidden h-0.5 bg-surface-2 lg:block" />
            {STEPS.map((step, k) => (
              <li key={step.plate} className="relative flex flex-col gap-3">
                <span className="flex items-center gap-3">
                  <StreetPlate name={step.plate} size="md" prefix={String(k + 1).padStart(2, '0')} designation={false} />
                </span>
                <p className="font-display text-xl leading-tight font-bold uppercase">{step.title}</p>
                <p className="text-muted">{step.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="samples-heading" className="border-t-2 border-surface-2">
          <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
            <h2 id="samples-heading" className="font-display text-[40px] leading-none font-bold uppercase">
              Sample plans
            </h2>
            <p className="mt-3 max-w-2xl text-muted">
              Fictional businesses with real taste anchors. Each opens a full plan: map, ads, budget, proof and the booking email.
            </p>
            <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {PRESETS.map((p) => (
                <li key={p.slug} className="flex">
                  <Link
                    href={`/p/${p.slug}`}
                    className="group flex w-full flex-col gap-3 border-2 border-surface-2 bg-surface p-5 text-text! no-underline transition-colors duration-[120ms] ease-sign hover:border-amber"
                  >
                    <span className="flex items-baseline justify-between gap-3 font-mono text-xs tracking-[0.12em] text-muted uppercase">
                      <span>{p.buyer}</span>
                      <span className="tabular-nums">
                        {usd.format(p.brief.budgetUsd)} · {p.brief.weeks} wk
                      </span>
                    </span>
                    <span className="font-display text-[28px] leading-[0.95] font-bold uppercase">{p.brief.business}</span>
                    <span className="text-sm text-muted">{p.title}</span>
                    {/* Two lines reserved so the rules line up across a row of cards. */}
                    <span className="mt-auto min-h-[calc(2lh_+_0.75rem_+_2px)] border-t-2 border-surface-2 pt-3 text-sm">
                      <span className="sr-only">Taste anchors: </span>
                      {p.anchors.map((a) => a.name).join(' · ')}
                    </span>
                    <span className="inline-flex items-center gap-1.5 font-display text-sm font-bold tracking-[0.06em] text-amber-text uppercase">
                      Open the plan
                      <ArrowRight aria-hidden="true" className="size-4 transition-transform duration-[120ms] ease-sign group-hover:translate-x-0.5" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <Footer narrow />
    </div>
  );
}
