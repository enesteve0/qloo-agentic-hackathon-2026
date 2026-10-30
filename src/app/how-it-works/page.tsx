import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ProvenanceBadge } from '@/components/run/ProvenanceBadge';
import { badgeExplanation, type BadgeKind } from '@/components/run/model';
import { Footer } from '@/components/site/Footer';
import { Header } from '@/components/site/Header';
import { StreetPlate } from '@/components/ui/StreetPlate';
import meta from '@/data/meta.json';
import { getEnv } from '@/server/env';

export const metadata: Metadata = {
  title: 'How it works',
  description: 'The method, the data, privacy, limits, provenance labels and fairness behind Stoop’s street-screen plans.',
};

// Static, refreshed every few minutes so the current-mode note follows the deployment.
export const revalidate = 300;

const fmt = new Intl.NumberFormat('en-US');

const TOC = [
  { id: 'method', label: 'Method' },
  { id: 'data', label: 'Data' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'limits', label: 'Limits' },
  { id: 'labels', label: 'Labels' },
  { id: 'fairness', label: 'Fairness' },
] as const;

const STATIONS: { name: string; what: string; who: string }[] = [
  { name: 'Brief', what: 'Business, offer, budget, weeks and an optional address. The address only goes in the ad footer.', who: 'You' },
  {
    name: 'Taste',
    what: 'The agent proposes up to six taste anchors (artists, places, brands, films, shows) and matches them in Qloo. If a name is ambiguous, it asks you one question, once per run.',
    who: 'Model proposes, Qloo resolves',
  },
  {
    name: 'Where',
    what: `Qloo heatmaps for each anchor, compared with an NYC baseline and scored onto ${fmt.format(meta.counts.kiosks)} live ad-capable LinkNYC screens in ${fmt.format(meta.counts.eligibleNtas)} eligible neighborhoods.`,
    who: 'Qloo measures, code ranks',
  },
  {
    name: 'What',
    what: 'Local Qloo place evidence for the top neighborhoods, then two ads per neighborhood. Every ad cites that evidence and passes eight copy rules.',
    who: 'Model writes, code checks',
  },
  { name: 'Plan', what: 'The strongest screens per dollar under per-neighborhood caps. Every price and impression figure is a labelled assumption.', who: 'Code' },
  { name: 'Proof', what: 'The same brief planned without Qloo and scored on the same map, with the circularity stated.', who: 'Code' },
  { name: 'Send', what: 'A checklist, a CSV screen list and a booking email that opens only after you confirm you reviewed it.', who: 'You' },
];

const LABELS: { kind: BadgeKind; detail?: string; where: string }[] = [
  { kind: 'live', detail: 'model', where: 'A new plan made just now.' },
  { kind: 'cached', detail: 'time', where: 'An identical brief: the plan already made for it, shown again.' },
  { kind: 'recorded', detail: 'date', where: 'Sample plans, once recorded from real live runs.' },
  { kind: 'template', where: 'Any ad the rules rebuilt from evidence.' },
  { kind: 'qloo_only', where: 'A plan finished with rules and templates because every AI writer was busy.' },
  { kind: 'assumption', where: 'Prices, impressions and anything derived from them.' },
  { kind: 'synthetic', where: 'Every plan made before the Qloo key is active.' },
];

const MODE_NOTE: Record<'mock' | 'live' | 'cache-only' | 'off', string> = {
  mock: 'Right now Stoop runs in sample mode: the Qloo key is not active yet, so every plan uses synthetic taste data and says SYNTHETIC. Street screens and neighborhoods are real.',
  live: 'Right now new plans call Qloo live, within the fair-use limits below.',
  'cache-only': 'Right now Stoop answers from saved data only; new live plans resume when quota allows.',
  off: 'Right now live planning is off; saved and sample plans still open.',
};

function Section({ id, n, title, children }: { id: string; n: number; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-6 border-t-2 border-surface-2 pt-10">
      <p className="font-mono text-xs tracking-[0.14em] text-muted uppercase">
        {String(n).padStart(2, '0')} · {id}
      </p>
      <h2 id={`${id}-h`} className="mt-1 font-display text-[40px] leading-[0.95] font-bold uppercase">
        {title}
      </h2>
      <div className="mt-6 flex flex-col gap-5 text-[17px] leading-relaxed">{children}</div>
    </section>
  );
}

function Rows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="flex flex-col divide-y-2 divide-surface-2 border-y-2 border-surface-2">
      {rows.map(([k, v]) => (
        <div key={k} className="grid gap-1 py-3 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
          <dt className="font-display text-base font-bold tracking-[0.06em] uppercase">{k}</dt>
          <dd className="text-base text-muted">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const h3 = 'font-display text-xl font-bold tracking-[0.04em] uppercase';

export default function HowItWorksPage() {
  const mode = getEnv().QLOO_MODE;
  return (
    <div className="flex min-h-dvh flex-col">
      <Header current="how-it-works" narrow />
      <main id="main" className="flex-1">
        <header className="asphalt border-b-2 border-surface-2">
          <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
            <p className="font-mono text-xs tracking-[0.14em] text-muted uppercase">How it works</p>
            <h1 className="mt-2 max-w-4xl font-display text-5xl leading-[0.92] font-bold uppercase sm:text-[64px]">
              What neighborhoods love, never who people are
            </h1>
            <p className="mt-5 max-w-2xl text-lg text-muted">
              Stoop is an AI agent that plans ads on New York’s street screens. You describe the business; it finds where that
              taste over-indexes, writes an ad for each neighborhood from local evidence, fits the budget and drafts the booking.
              Here is the method, the data, what stays private, what it cannot do, and how every number is labelled.
            </p>
          </div>
        </header>

        <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
          <nav aria-label="On this page" className="lg:sticky lg:top-6 lg:self-start">
            <p className="font-display text-sm font-bold tracking-[0.12em] text-muted uppercase">On this page</p>
            <ol className="mt-3 flex flex-wrap gap-2 lg:flex-col lg:gap-0 lg:border-l-2 lg:border-surface-2">
              {TOC.map((t, k) => (
                <li key={t.id}>
                  <a
                    href={`#${t.id}`}
                    className="flex min-h-10 items-center gap-2 border-2 border-surface-2 px-3 font-display text-base font-bold tracking-[0.06em] text-text! uppercase hover:border-border lg:-ml-0.5 lg:border-0 lg:border-l-2 lg:border-transparent lg:px-4 lg:hover:border-amber"
                  >
                    <span className="font-mono text-xs font-normal text-muted">{String(k + 1).padStart(2, '0')}</span>
                    {t.label}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <div className="flex max-w-[70ch] min-w-0 flex-col gap-14">
            <Section id="method" n={1} title="Seven stations, one run">
              <p>
                A run moves through seven stations. The language model proposes and writes; Qloo measures taste; code ranks,
                checks and budgets; you approve and send.
              </p>
              <ol className="flex flex-col">
                {STATIONS.map((s, k) => (
                  <li key={s.name} className="relative border-l-2 border-surface-2 pb-6 pl-6 last:border-transparent last:pb-0">
                    <span aria-hidden="true" className="absolute top-2 -left-[7px] size-3 bg-text" />
                    <div>
                      <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <StreetPlate name={s.name} size="sm" prefix={String(k + 1).padStart(2, '0')} designation={false} />
                        <span className="font-mono text-xs tracking-[0.1em] text-muted uppercase">{s.who}</span>
                      </p>
                      <p className="mt-2 text-base">{s.what}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <h3 className={h3}>Why it is an agent</h3>
              <p>
                It plans its own taste anchors from plain language, calls Qloo, decides which maps to trust and says why in the
                agent log, asks you only when an ambiguous name would change the result, checks its own ads against the evidence
                and the copy rules, compares its plan with an AI that has no taste data, and drafts the booking for you to approve.
              </p>
              <details className="group border-2 border-surface-2 bg-surface">
                <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 font-display text-lg font-bold tracking-[0.04em] uppercase [&::-webkit-details-marker]:hidden">
                  The lift method, step by step
                  <span aria-hidden="true" className="font-mono text-xl transition-transform duration-[120ms] group-open:rotate-45">
                    +
                  </span>
                </summary>
                <div className="flex flex-col gap-4 border-t-2 border-surface-2 px-4 py-5 text-base">
                  <p>
                    A taste map on its own mostly shows where people are: busy places score high for nearly everything. Stoop asks a
                    narrower question: where does this taste rank higher than New York’s overall pattern?
                  </p>
                  <ol className="flex list-decimal flex-col gap-3 pl-5 marker:font-mono marker:text-muted">
                    <li>
                      Each anchor’s Qloo heatmap and a baseline map are placed on the same {fmt.format(meta.counts.gridCells)}{' '}
                      geohash cells covering the city.
                    </li>
                    <li>
                      Each map becomes ranks, then normal scores: <code className="font-mono text-sm">z = Φ⁻¹((rank − 0.5) / n)</code>.
                      Ranks make maps with different scales comparable.
                    </li>
                    <li>
                      Lift per anchor and cell: <code className="font-mono text-sm">lift = z(anchor taste rank) − z(NYC baseline)</code>.
                    </li>
                    <li>
                      Maps that only repeat overall density get half weight, thin maps get less, a map identical to another anchor’s
                      is counted once, and a map matching Qloo’s generic default map (once calibration has recorded it) is set aside.
                      Each of these decisions is written into the agent log.
                    </li>
                    <li>
                      Anchor lifts are averaged with those weights: <code className="font-mono text-sm">L = Σ wₐ·liftₐ / Σ wₐ</code>.
                    </li>
                    <li>
                      Each 2020 neighborhood averages its cells by land area. Neighborhoods with few cells are shrunk toward zero:{' '}
                      <code className="font-mono text-sm">L̂ = L · n_eff / (n_eff + κ)</code>, with κ = 1.5.
                    </li>
                    <li>
                      Confidence is high when L̂ is at least twice its standard error, most anchors agree and there are at least three
                      effective cells; medium at one standard error; low otherwise. Nearby cells are correlated, so the standard error
                      is on the optimistic side.
                    </li>
                    <li>
                      Screens are scored on a lightly smoothed version of the same surface, as a 0–100 fit percentile. The multiplier
                      you see, such as 2.3×, is <code className="font-mono text-sm">1.6^L̂</code>: 1.0× is the NYC baseline. It is a
                      display scale, not a ratio of visits.
                    </li>
                  </ol>
                  <p className="border-l-2 border-amber pl-3 text-muted">
                    What it supports: where your anchors’ Qloo signal ranks higher than New York’s overall signal. Not foot traffic,
                    population or visits, and nothing about any individual.
                  </p>
                </div>
              </details>
            </Section>

            <Section id="data" n={2} title="The data">
              <Rows
                rows={[
                  [
                    'Street screens',
                    <>
                      {fmt.format(meta.counts.kiosks)} live, ad-capable LinkNYC kiosks from NYC Open Data (LinkNYC Locations,
                      s4kf-3yrf), retrieved Oct 26, 2026. Each is placed in its 2020 neighborhood by its coordinates.
                    </>,
                  ],
                  [
                    'Neighborhoods',
                    <>
                      {fmt.format(meta.counts.ntas)} 2020 Neighborhood Tabulation Areas (9nt8-h7nd). The{' '}
                      {fmt.format(meta.counts.eligibleNtas)} residential ones with at least two ad screens can be planned.
                    </>,
                  ],
                  [
                    'Taste',
                    'The Qloo Insights API: entity search, heatmaps over New York and its neighborhoods, and local places with the tags that explain them. Answers are cached privately on the server; none are stored in the code repository.',
                  ],
                  ['Map', 'OpenFreeMap and OpenMapTiles, © OpenStreetMap contributors, restyled for night.'],
                  [
                    'AI writers',
                    'Free tiers only, in order: Groq, Google Gemini, Cloudflare Workers AI, SambaNova, OpenRouter (free models). When none is available, rules and templates take over and the plan says so.',
                  ],
                ]}
              />
            </Section>

            <Section id="privacy" n={3} title="Privacy">
              <p>Stoop plans from what neighborhoods like. It never learns who anyone is.</p>
              <h3 className={h3}>Where data goes</h3>
              <Rows
                rows={[
                  [
                    'Qloo',
                    'The names of the taste anchors to look up, Qloo entity IDs, tag types and public New York and neighborhood shapes. Never the brief, the business name, the address or anything about visitors.',
                  ],
                  [
                    'AI writers',
                    'The planner reads the business name, description, offer, budget, weeks and start date. The ad writer reads the business name, offer, tone, category, a trimmed description, neighborhood names and evidence tag labels. Emails, phone numbers and links are removed first. Never the address, Qloo place names or scores.',
                  ],
                  ['Stoop’s database', 'Saved plans, the private Qloo cache, rate-limit counters and AI cooldowns. Nothing is shared from it.'],
                  ['Your browser', 'The plan, the ads and the map. Downloads hold public screen data, assumptions and derived fit only.'],
                ]}
              />
              <h3 className={h3}>In your browser</h3>
              <ul className="flex list-disc flex-col gap-2 pl-5 marker:text-muted">
                <li>
                  One first-party cookie, <code className="font-mono text-sm">stoop_sid</code>: a signed random ID, kept 30 days,
                  used only for the fair-use limits.
                </li>
                <li>No analytics, no advertising cookies, no third-party trackers.</li>
                <li>Map tiles load from OpenFreeMap. Fonts ship with the site, so no font request goes to Google.</li>
              </ul>
              <h3 className={h3}>What is kept, and for how long</h3>
              <Rows
                rows={[
                  ['Saved plans', 'Up to 14 days, and never after Nov 7, 2026.'],
                  ['Sample plans', 'Until Nov 7, 2026.'],
                  ['Qloo answers', 'In a private cache until Nov 7, 2026. After the event Qloo is switched off and its cached data deleted.'],
                  ['Rate limits', 'For their window, at most a day.'],
                ]}
              />
              <h3 className={h3}>Fair use</h3>
              <p>
                New plans are live within limits that keep the event’s Qloo quota open for everyone: 3 live runs per visitor in 15
                minutes and 8 per day, 25 per network per day, plus hourly and daily caps. An identical brief returns the saved
                plan. When a limit is reached you get a labelled sample plan for a similar business, not an error page.
              </p>
            </Section>

            <Section id="limits" n={4} title="Limits">
              <p className="border-l-2 border-amber pl-3">{MODE_NOTE[mode]}</p>
              <ul className="flex list-disc flex-col gap-3 pl-5 marker:text-muted">
                <li>New York City only. Screen locations come from an open-data snapshot; whether a screen can be bought, and when, is up to the seller.</li>
                <li>
                  Taste maps are relative signals on city-grid cells of about 0.9 × 0.6 km. Thin anchors make noisy maps; Stoop flags
                  them and lowers their weight.
                </li>
                <li>The multiplier is a display scale. It is not visits, foot traffic or population.</li>
                <li>Copy checks catch rule breaks, not blandness.</li>
                <li>Free AI tiers run out. Templates then write the ads from the same evidence, and the plan says so.</li>
                <li>
                  The PROOF comparison is scored on the same maps Stoop optimizes, so it is partly circular. Stoop has not published
                  an independent validation yet.
                </li>
                <li>No campaign has run yet. Prices and impressions are assumptions, not quotes.</li>
              </ul>
            </Section>

            <Section id="labels" n={5} title="Labels on every result">
              <p>
                Each run carries a label in its header, each step in the agent log, and each estimated figure in the plan. Focus or
                hover a label for its meaning.
              </p>
              <ul className="flex flex-col divide-y-2 divide-surface-2 border-y-2 border-surface-2">
                {LABELS.map((l) => (
                  <li key={l.kind} className="grid gap-2 py-4 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
                    <span>
                      <ProvenanceBadge kind={l.kind} detail={l.detail} />
                    </span>
                    <span className="text-base">
                      {badgeExplanation(l.kind, l.detail === 'time' || l.detail === 'date' ? null : l.detail)}
                      <span className="mt-1 block text-muted">{l.where}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Section>

            <Section id="fairness" n={6} title="Fairness">
              <p>
                Taste correlates with culture, and culture with geography. So the business chooses the taste anchors, Stoop shows
                the evidence for every neighborhood it picks, and the categories where a choice of neighborhood would matter most are
                blocked.
              </p>
              <h3 className={h3}>What Stoop will not do</h3>
              <ul className="flex list-disc flex-col gap-3 pl-5 marker:text-muted">
                <li>Track people: no device IDs, location trails, ad cookies or third-party trackers.</li>
                <li>Send anything about you to Qloo. Qloo receives only taste anchors, entity IDs, tag types and New York shapes.</li>
                <li>
                  Infer race, ethnicity, religion, health, sexuality or politics, or use audience segments to choose neighborhoods. The
                  copy rules also reject demographic and sensitive wording.
                </li>
                <li>
                  Plan housing, job, credit, political, health-claim, tobacco, weapons, adult or gambling ads. Those briefs get an
                  explanation instead of a plan.
                </li>
                <li>Put a real person’s name or face, or another brand’s name or mark, in an ad.</li>
                <li>Buy media or send email by itself. The booking email is a draft you review and send.</li>
                <li>Promise sales. Every price and impression figure is a labelled assumption.</li>
              </ul>
              <p className="text-muted">
                Questions about a plan?{' '}
                <Link href="/judges" className="underline underline-offset-4">
                  The judges’ tour
                </Link>{' '}
                walks through one in a minute.
              </p>
            </Section>
          </div>
        </div>
      </main>
      <Footer narrow />
    </div>
  );
}
