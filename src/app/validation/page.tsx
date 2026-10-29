import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { Footer } from '@/components/site/Footer';
import { GITHUB_URL, Header } from '@/components/site/Header';
import { cx } from '@/components/ui/cx';
import type { ValidationReport } from '../../../scripts/backtest/report';

export const metadata: Metadata = {
  title: 'Validation',
  description:
    'Do Qloo taste maps rank New York neighborhoods the way real chain stores over-index? A backtest declared before any Qloo call, against OpenStreetMap store locations, failures included.',
};

// Built once from the committed report; without one the page does not exist.
export const dynamic = 'force-static';

function loadReport(): ValidationReport | null {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), 'src/content/validation.json'), 'utf8')) as ValidationReport;
  } catch {
    return null;
  }
}

type Universe = ValidationReport['primary'];
type Brand = ValidationReport['brands'][number];

/** 0.312 → "+0.31", −0.05 → "−0.05" (a real minus sign), null → "—". */
function rho(x: number | null | undefined): string {
  if (x === null || x === undefined) return '—';
  const s = Math.abs(x).toFixed(2);
  return x > 0 ? `+${s}` : x < 0 ? `−${s}` : s;
}

function pValue(p: number | null | undefined): string {
  if (p === null || p === undefined) return '—';
  return p < 0.001 ? '< 0.001' : p.toFixed(3);
}

const int = (n: number) => n.toLocaleString('en-US');

function Stat({ label, value, sub }: { label: ReactNode; value: string; sub: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-2 border-surface-2 p-4">
      <p className="font-mono text-xs tracking-[0.14em] text-muted uppercase">{label}</p>
      <p className="font-display text-[56px] leading-none font-bold tabular-nums">{value}</p>
      <p className="text-sm text-muted">{sub}</p>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-6 border-t-2 border-surface-2 pt-10">
      <h2 id={`${id}-h`} className="font-display text-[40px] leading-[0.95] font-bold uppercase">
        {title}
      </h2>
      <div className="mt-6 flex flex-col gap-5 text-[17px] leading-relaxed">{children}</div>
    </section>
  );
}

function UniverseLine({ u }: { u: Universe }) {
  if (!u.chains || u.medianRho === null) return <p className="text-muted">Too few chains had usable maps in these neighborhoods.</p>;
  return (
    <p>
      Median ρ <strong className="tabular-nums">{rho(u.medianRho)}</strong>
      {u.ci95 ? ` (95% interval ${rho(u.ci95[0])} to ${rho(u.ci95[1])})` : ''} across {u.chains} chains and {int(u.neighborhoods)}{' '}
      neighborhoods; {u.positive} of {u.chains} chains above zero (p {pValue(u.pPositive)}).
      {u.specificity
        ? ` Own map against other chains’ maps: mean ρ ${rho(u.specificity.meanOwnRho)} vs ${rho(u.specificity.meanOtherRho)}, placebo p ${pValue(u.specificity.p)}.`
        : ''}
    </p>
  );
}

const TH = 'py-2 px-3 font-normal';

function ChainTable({ brands, chains }: { brands: Brand[]; chains: number }) {
  const ok = brands.filter((b) => b.primary && !('skipped' in b.primary && b.primary.skipped));
  const rhoOf = (b: Brand) => (b.primary && 'rho' in b.primary ? (b.primary.rho ?? -Infinity) : -Infinity);
  const rows = [...ok.sort((a, b) => rhoOf(b) - rhoOf(a)), ...brands.filter((b) => !ok.includes(b))];
  return (
    <div className="overflow-x-auto border-2 border-surface-2">
      <table className="w-full min-w-[44rem] border-collapse text-left text-sm">
        <caption className="sr-only">Per chain: rank correlation between Qloo taste lift and store over-index, with tests</caption>
        <thead className="border-b-2 border-surface-2 font-mono text-xs tracking-[0.1em] text-muted uppercase">
          <tr>
            <th scope="col" className={TH}>
              Chain
            </th>
            <th scope="col" className={cx(TH, 'text-right')}>
              NYC stores
            </th>
            <th scope="col" className={cx(TH, 'text-right normal-case')}>
              ρ
            </th>
            <th scope="col" className={cx(TH, 'text-right normal-case')}>
              p
            </th>
            <th scope="col" className={cx(TH, 'text-right')}>
              Own map rank
            </th>
            <th scope="col" className={TH}>
              Note
            </th>
          </tr>
        </thead>
        <tbody className="divide-y-2 divide-surface-2">
          {rows.map((b) => {
            const cell = b.primary;
            const scored = cell && 'rho' in cell ? cell : null;
            const note =
              b.reason ?? (cell && 'skipped' in cell ? cell.skipped : null) ?? (b.flags.length ? `Flags: ${b.flags.join(', ')}` : null);
            return (
              <tr key={b.qid}>
                <th scope="row" className="px-3 py-2 font-sans font-normal">
                  <span className="font-bold">{b.name}</span>
                  <span className="block text-xs text-muted">{b.category.replaceAll('_', ' ')}</span>
                </th>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{int(b.stores)}</td>
                <td className={cx('px-3 py-2 text-right font-mono font-bold tabular-nums', scored && (scored.rho ?? 0) > 0 && 'text-amber-text')}>
                  {rho(scored?.rho)}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{pValue(scored?.p)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {scored?.ownMapRank ? `${scored.ownMapRank} of ${chains}` : '—'}
                </td>
                <td className="px-3 py-2 text-xs text-muted">{note ?? ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function ValidationPage() {
  const report = loadReport();
  if (!report) notFound();
  const p = report.primary;
  const s = p.specificity;
  const calls = report.sources.qloo.calls;
  const methodRows: [string, string][] = [
    ['Stores', report.method.stores],
    ['Target', report.method.target],
    ['Taste lift', report.method.lift],
    ['Statistic', report.method.statistic],
    ['Null', report.method.null],
    ['Interval', report.method.interval],
    ['Placebo', report.method.specificity],
  ];
  return (
    <div className="flex min-h-dvh flex-col">
      <Header current="validation" narrow />
      <main id="main" className="flex-1">
        <header className="asphalt border-b-2 border-surface-2">
          <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
            <p className="font-mono text-xs tracking-[0.14em] text-muted uppercase">Validation · declared before any Qloo call</p>
            <h1 className="mt-2 max-w-4xl font-display text-5xl leading-[0.92] font-bold uppercase sm:text-[64px]">
              Do Qloo taste maps know where chains open stores?
            </h1>
            <p className="mt-5 max-w-2xl text-lg text-muted">
              Stoop ranks neighborhoods by where a taste over-indexes on Qloo’s maps. To check that against something real, this test
              sends {report.brands.length} chains to Qloo, runs each chain’s New York taste map through Stoop’s own lift engine and
              compares the ranking with where the chain actually has more stores than the neighborhood’s commerce predicts. The analysis
              was committed before the first Qloo call, and the result is published as it came out.
            </p>
            {report.synthetic ? (
              <p className="mt-5 max-w-2xl border-2 border-amber p-3 font-display text-base font-bold tracking-[0.06em] uppercase">
                {report.label}
              </p>
            ) : null}
          </div>
        </header>

        <div className="mx-auto flex w-full max-w-6xl flex-col gap-14 px-4 py-10 sm:px-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label={<>Median <span className="normal-case">ρ</span></>}
              value={rho(p.medianRho)}
              sub={p.ci95 ? `95% interval ${rho(p.ci95[0])} to ${rho(p.ci95[1])} · ${p.chains} chains` : `${p.chains} chains`}
            />
            <Stat label="Chains above zero" value={`${p.positive}/${p.chains}`} sub={`p ${pValue(p.pPositive)} against the shuffled null`} />
            <Stat
              label="Own map ranked first"
              value={s ? `${s.ownMapBest}/${p.chains}` : '—'}
              sub={s ? `mean ρ ${rho(s.meanOwnRho)} for a chain’s own map vs ${rho(s.meanOtherRho)} for other chains’ maps · placebo p ${pValue(s.p)}` : 'not enough chains'}
            />
            <Stat label="Qloo calls" value={int(calls.fresh + calls.cached)} sub={`${int(p.neighborhoods)} neighborhoods · one map per chain`} />
          </div>

          <Section id="reading" title="How to read it">
            <p>
              ρ is a rank correlation across neighborhoods: +1 means Qloo orders the neighborhoods exactly as the chain’s stores do, 0
              means no relation. Store networks follow rent, traffic and years of strategy, not taste alone, so even a good taste map
              should land well short of 1.
            </p>
            <p>
              The placebo is the robust test. Neighboring blocks look alike, which flatters any map, so each chain’s own map is
              compared with every other chain’s map on the same stores. A chain’s own map should predict its stores better than a
              different chain’s map does.
            </p>
          </Section>

          <Section id="chains" title="Chain by chain">
            <p className="text-muted">{p.description}</p>
            <ChainTable brands={report.brands} chains={p.chains} />
            <p className="text-sm text-muted">
              Own map rank: where the chain’s own map places among all {p.chains} chains’ maps at predicting its stores (1 is best).
              Per-chain p-values are one-sided and unadjusted.
            </p>
          </Section>

          <Section id="sensitivity" title="All residential neighborhoods">
            <p className="text-muted">{report.sensitivity.description}</p>
            <UniverseLine u={report.sensitivity} />
            <p className="text-sm text-muted">The main result above covers {p.description.charAt(0).toLowerCase() + p.description.slice(1)}</p>
          </Section>

          {report.excluded.length ? (
            <Section id="excluded" title="Left out before the run">
              <ul className="flex list-disc flex-col gap-2 pl-5 marker:text-muted">
                {report.excluded.map((e) => (
                  <li key={e.qid}>
                    <span className="font-bold">{e.name}</span> <span className="text-muted">— {e.reason}</span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          <Section id="method" title="Method">
            <dl className="flex flex-col divide-y-2 divide-surface-2 border-y-2 border-surface-2">
              {methodRows.map(([k, v]) => (
                <div key={k} className="grid gap-1 py-3 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
                  <dt className="font-display text-base font-bold tracking-[0.06em] uppercase">{k}</dt>
                  <dd className="text-base text-muted">{v}</dd>
                </div>
              ))}
            </dl>
          </Section>

          <Section id="caveats" title="Caveats">
            <ul className="flex list-disc flex-col gap-3 pl-5 marker:text-muted">
              {report.caveats.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </Section>

          <Section id="sources" title="Sources">
            <p className="border-l-2 border-amber pl-3">{report.notice}</p>
            <ul className="flex list-disc flex-col gap-2 pl-5 text-base marker:text-muted">
              <li>
                OpenStreetMap via Overpass, snapshot {report.sources.osm.snapshot ?? 'unknown'}: <code className="font-mono text-sm">{report.sources.osm.query}</code>
              </li>
              <li>Neighborhoods: {report.sources.neighborhoods}.</li>
              <li>
                Qloo: {report.sources.qloo.transport}, {int(calls.fresh)} fresh and {int(calls.cached)} cached calls
                {report.sources.qloo.calibratedAt ? `; lift settings calibrated ${report.sources.qloo.calibratedAt.slice(0, 10)}` : ''}. Only
                these summary statistics are published: no Qloo scores and no store lists.
              </li>
              <li>
                Generated {report.generatedAt.slice(0, 10)} by{' '}
                <a href={`${GITHUB_URL}/tree/master/scripts/backtest`} rel="noreferrer" target="_blank">
                  scripts/backtest
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>{' '}
                ({report.methodVersion}). To rerun: <code className="font-mono text-sm">pnpm backtest:osm</code>, then{' '}
                <code className="font-mono text-sm">pnpm backtest:run --confirm</code> with a Qloo key.
              </li>
            </ul>
            <p>
              <Link href="/how-it-works#limits">What Stoop can and cannot claim</Link>
            </p>
          </Section>
        </div>
      </main>
      <Footer narrow />
    </div>
  );
}
