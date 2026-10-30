'use client';

import { ChevronDown, Info, Minus, Plus } from 'lucide-react';
import { Fragment, useId, useState } from 'react';
import type { MediaPlan, PlannedScreen, RunState } from '@/shared/types';
import { StreetPlate } from '@/components/ui/StreetPlate';
import { buttonClass } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { ProvenanceBadge } from './ProvenanceBadge';
import { fmtCompact, fmtDateRange, fmtInt, fmtMultiplier, fmtPct, fmtUsd, fmtWeeks, leftoverNote, ntaMap } from './model';
import { titleStreet } from './streets';
import type { PlaceLookup } from './types';

export interface PlanViewProps {
  state: RunState;
  places?: PlaceLookup;
  /** Budget and weeks controls appear only when these are provided; recalculation is the caller's job. */
  onChangeBudget?: (usd: number) => void;
  onChangeWeeks?: (weeks: number) => void;
  /** True while the caller recalculates after a control change. */
  recalculating?: boolean;
  /** Suggested fixes for an infeasible budget (e.g. jump to the brief). */
  onEditBrief?: () => void;
  /** The six best free screens under LinkNYC's LinkLocal program (server-picked); hidden when absent. */
  linkLocal?: PlannedScreen[] | null;
  className?: string;
}

const LINKLOCAL_SOURCE =
  'https://www.intersection.com/announcement/intersection-launches-linknyc-self-service-portal-to-expand-free-and-low-cost-advertising-opportunities-for-businesses-of-all-sizes/';

/** The free path: LinkNYC's LinkLocal program shows eligible small businesses' ads on six screens at no cost. */
function LinkLocalCard({ picks, places }: { picks: PlannedScreen[]; places: PlaceLookup }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="border-2 border-sign p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 id={id} className="font-display text-base font-bold tracking-[0.08em] uppercase">
          Free option: LinkLocal · {picks.length} screens · $0
        </h3>
        <a href={LINKLOCAL_SOURCE} target="_blank" rel="noreferrer" className="text-sm underline underline-offset-4">
          About LinkLocal<span className="sr-only"> (opens in a new tab)</span>
        </a>
      </div>
      <p className="mt-1 max-w-3xl text-sm text-muted">
        LinkNYC&apos;s LinkLocal program lets eligible New York small businesses and community organizations run ads on six
        screens at a time at no cost. If you qualify, these are the six Stoop would pick: the best fits across your top
        neighborhoods, never two on one block. LinkNYC decides eligibility; Stoop doesn&apos;t apply for you.
      </p>
      <ScreenRows screens={picks} places={places} numberOf={(s) => picks.indexOf(s) + 1} />
    </section>
  );
}

function Tile({
  label,
  value,
  sub,
  badge,
  hero,
  className,
}: {
  label: string;
  value: string;
  sub?: string;
  badge?: React.ReactNode;
  hero?: boolean;
  className?: string;
}) {
  return (
    <div className={cx('flex min-w-0 flex-col gap-2 bg-bg p-4', className)}>
      <dt className="font-mono text-xs tracking-[0.14em] text-muted uppercase">{label}</dt>
      <dd className="flex min-w-0 flex-col items-start gap-1">
        <span className={cx('block font-display leading-none font-bold tabular-nums', hero ? 'text-[64px]' : 'text-[40px]')}>{value}</span>
        {sub ? <span className="block text-sm text-muted">{sub}</span> : null}
        {badge ? <span className="mt-1 block">{badge}</span> : null}
      </dd>
    </div>
  );
}

function Stepper({
  label,
  value,
  display,
  step,
  min,
  max,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  display: string;
  step: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-3">
      <span className="font-mono text-xs tracking-[0.14em] text-muted uppercase">{label}</span>
      <span className="inline-flex items-stretch border-2 border-border">
        <button
          type="button"
          aria-label={`Lower ${label.toLowerCase()}`}
          disabled={disabled || value - step < min}
          onClick={() => onChange(value - step)}
          className="grid size-9 place-items-center hover:bg-surface-2 disabled:opacity-40"
        >
          <Minus aria-hidden="true" className="size-4" />
        </button>
        <output aria-live="off" className="grid min-w-20 place-items-center border-x-2 border-border px-2 font-display text-lg font-bold tabular-nums">
          {display}
        </output>
        <button
          type="button"
          aria-label={`Raise ${label.toLowerCase()}`}
          disabled={disabled || value + step > max}
          onClick={() => onChange(value + step)}
          className="grid size-9 place-items-center hover:bg-surface-2 disabled:opacity-40"
        >
          <Plus aria-hidden="true" className="size-4" />
        </button>
      </span>
    </div>
  );
}

function Assumptions({ plan }: { plan: MediaPlan }) {
  const id = useId();
  const a = plan.assumptions;
  return (
    <>
      <button
        type="button"
        popoverTarget={`${id}-pop`}
        className="inline-flex min-h-8 items-center gap-1.5 font-display text-sm font-bold tracking-[0.06em] text-link uppercase underline-offset-4 hover:underline"
      >
        <Info aria-hidden="true" className="size-4" />
        How these are estimated
      </button>
      <div
        id={`${id}-pop`}
        popover="auto"
        className="m-auto w-[min(30rem,calc(100vw-2rem))] border-2 border-amber bg-surface p-5 text-text backdrop:bg-[rgba(5,6,8,0.6)]"
      >
        <div className="flex items-start justify-between gap-4">
          <h3 className="font-display text-[28px] leading-none font-bold uppercase">Assumptions</h3>
          <ProvenanceBadge kind="assumption" align="end" />
        </div>
        <p className="mt-3 text-sm text-muted">
          Prices and impressions are labelled estimates, not quotes or data. The seller’s real rates decide the final cost. Change
          them with the seller before you book.
        </p>
        <table className="mt-4 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-surface-2 text-left align-bottom font-mono text-xs tracking-[0.1em] text-muted uppercase">
              <th scope="col" className="py-2 pr-3 font-normal">
                Per screen, per week
              </th>
              <th scope="col" className="py-2 pl-3 text-right font-normal">
                Manhattan
              </th>
              <th scope="col" className="py-2 pl-3 text-right font-normal">
                Other boroughs
              </th>
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            <tr className="border-b-2 border-surface-2">
              <th scope="row" className="py-2 text-left font-sans font-normal">
                Price
              </th>
              <td className="py-2 pl-3 text-right">{fmtUsd(a.pricePerKioskWeek.manhattan)}</td>
              <td className="py-2 pl-3 text-right">{fmtUsd(a.pricePerKioskWeek.outer)}</td>
            </tr>
            <tr>
              <th scope="row" className="py-2 text-left font-sans font-normal">
                Impressions
              </th>
              <td className="py-2 pl-3 text-right">{fmtInt(a.impressionsPerKioskWeek.manhattan)}</td>
              <td className="py-2 pl-3 text-right">{fmtInt(a.impressionsPerKioskWeek.outer)}</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-4 text-sm text-muted">
          <span className="font-semibold text-text">Taste-weighted impressions</span> multiply each screen’s estimated
          impressions by how strongly its spot over-indexes for your taste anchors. Areas below the NYC baseline count for
          zero.
        </p>
        <button
          type="button"
          popoverTarget={`${id}-pop`}
          popoverTargetAction="hide"
          className="mt-5 inline-flex h-9 items-center border-2 border-text px-3 font-display text-sm font-bold tracking-[0.06em] uppercase hover:bg-surface-2"
        >
          Close
        </button>
      </div>
    </>
  );
}

function ScreenRows({ screens, places, numberOf }: { screens: PlannedScreen[]; places: PlaceLookup; numberOf: (s: PlannedScreen) => number }) {
  return (
    <ul className="flex flex-col divide-y-2 divide-surface-2">
      {screens.map((s) => {
        const p = places[s.i];
        const cross = p ? [p.cross1, p.cross2].filter((c): c is string => Boolean(c)).map((c) => titleStreet(c)) : [];
        return (
          <li key={s.i} className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-0.5 py-2 text-sm">
            <span className="font-mono text-xs text-muted">#{String(numberOf(s)).padStart(2, '0')}</span>
            <span className="min-w-0">
              <span className="block truncate font-semibold">{p ? titleStreet(p.address) : s.siteId}</span>
              <span className="block truncate text-muted">
                {cross.length ? `between ${cross.join(' & ')}` : s.siteId}
                {p?.type === 'LINK5G_AD' ? ' · Link5G' : ''}
              </span>
            </span>
            <span className="text-right font-mono text-xs text-muted tabular-nums">
              fit {s.fit} · {fmtUsd(s.cost)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * PLAN: the deterministic budget plan. Summary tiles, a neighborhood table that expands to screen
 * addresses, labelled assumptions and the next-best screens. No AI or Qloo call happens here.
 */
export function PlanView({ state, places = {}, onChangeBudget, onChangeWeeks, recalculating, onEditBrief, linkLocal, className }: PlanViewProps) {
  const plan = state.plan;
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (!plan) return null;
  const ntas = ntaMap(state);
  const range = fmtDateRange(state.brief.startDate, plan.weeks);
  const order = new Map(plan.screens.map((s, k) => [s.i, k + 1]));
  const numberOf = (s: PlannedScreen) => order.get(s.i) ?? 0;
  // The cheapest eligible screen for the whole flight (null: none is eligible, so money won't help).
  // Runs saved before the optimizer reported it fall back to the cheaper price tier.
  const minimum =
    plan.cheapestScreenUsd !== undefined
      ? plan.cheapestScreenUsd
      : Math.min(plan.assumptions.pricePerKioskWeek.outer, plan.assumptions.pricePerKioskWeek.manhattan) * plan.weeks;

  if (plan.infeasibleReason || plan.screens.length === 0) {
    return (
      <section aria-labelledby="plan-title" className={cx('flex flex-col gap-6', className)}>
        <div>
          <p className="font-mono text-xs tracking-[0.14em] text-muted uppercase">05 · Plan</p>
          <h2 id="plan-title" className="mt-1 font-display text-[40px] leading-[0.95] font-bold uppercase">
            No screens fit this budget yet
          </h2>
        </div>
        <div className="flex max-w-2xl flex-col gap-4 border-2 border-amber bg-surface p-5">
          <p className="text-lg">{plan.infeasibleReason ?? 'The budget does not cover a single screen-week.'}</p>
          {minimum === null && !onEditBrief ? null : (
            <>
              <p className="text-muted">Ways to fix it:</p>
              <ul className="flex flex-col gap-2">
                {minimum === null ? null : onChangeBudget ? (
                  <li>
                    <button
                      type="button"
                      onClick={() => onChangeBudget(Math.max(plan.budgetUsd, minimum))}
                      className="font-display text-lg font-bold tracking-[0.04em] text-link uppercase underline-offset-4 hover:underline"
                    >
                      Raise the budget to {fmtUsd(minimum)}
                    </button>
                  </li>
                ) : (
                  <li className="text-muted">
                    Raise the budget to at least {fmtUsd(minimum)} for {fmtWeeks(plan.weeks)}.
                  </li>
                )}
                {minimum === null || plan.weeks <= 1 ? null : onChangeWeeks ? (
                  <li>
                    <button
                      type="button"
                      onClick={() => onChangeWeeks(1)}
                      className="font-display text-lg font-bold tracking-[0.04em] text-link uppercase underline-offset-4 hover:underline"
                    >
                      Run for one week instead
                    </button>
                  </li>
                ) : (
                  <li className="text-muted">Run for fewer weeks: one screen-week costs about {fmtUsd(minimum / plan.weeks)}.</li>
                )}
                {onEditBrief ? (
                  <li>
                    <button
                      type="button"
                      onClick={onEditBrief}
                      className="font-display text-lg font-bold tracking-[0.04em] text-link uppercase underline-offset-4 hover:underline"
                    >
                      Edit the brief
                    </button>
                  </li>
                ) : null}
              </ul>
            </>
          )}
          {onEditBrief ? null : (
            // Full page loads: a live run rewrites the URL with history.replaceState, so the router can
            // still think it is on /plan/new (or the sample) and would keep the old run on screen.
            <div className="flex flex-wrap gap-3 pt-1">
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a full page load (see above) */}
              <a href="/plan/new" className={buttonClass('primary', 'md')}>
                Start a new brief
              </a>
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a full page load (see above) */}
              <a href="/p/halfnote" className={buttonClass('outline', 'md')}>
                Open a sample plan
              </a>
            </div>
          )}
        </div>
        {linkLocal?.length ? <LinkLocalCard picks={linkLocal} places={places} /> : null}
      </section>
    );
  }

  return (
    <section aria-labelledby="plan-title" className={cx('flex flex-col gap-6', className)}>
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="max-w-3xl">
          <p className="font-mono text-xs tracking-[0.14em] text-muted uppercase">05 · Plan</p>
          <h2 id="plan-title" className="mt-1 font-display text-[40px] leading-[0.95] font-bold uppercase">
            {/* Each sentence wraps as a unit. */}
            {[
              `${plan.totals.screens} screen${plan.totals.screens === 1 ? '' : 's'}.`,
              `${plan.byNta.length} neighborhood${plan.byNta.length === 1 ? '' : 's'}.`,
              `${fmtUsd(plan.totals.spend)}.`,
            ].map((t) => (
              <span key={t} className="inline-block pr-[0.25em]">
                {t}
              </span>
            ))}
          </h2>
          <p className="mt-3 text-lg text-muted">
            Fit to your budget by rules, not by the AI: the strongest screens per dollar, capped so no neighborhood gets more
            than about half the screens the budget buys.{range ? ` Runs ${range}.` : ''}
          </p>
        </div>
        <Assumptions plan={plan} />
      </header>

      {onChangeBudget || onChangeWeeks ? (
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3 border-2 border-surface-2 p-3" aria-busy={recalculating || undefined}>
          {onChangeBudget ? (
            <Stepper
              label="Budget"
              value={plan.budgetUsd}
              display={fmtUsd(plan.budgetUsd)}
              step={250}
              min={250}
              max={50000}
              onChange={onChangeBudget}
              disabled={recalculating}
            />
          ) : null}
          {onChangeWeeks ? (
            <Stepper
              label="Weeks"
              value={plan.weeks}
              display={`${plan.weeks} wk`}
              step={1}
              min={1}
              max={12}
              onChange={onChangeWeeks}
              disabled={recalculating}
            />
          ) : null}
          <p className="text-sm text-muted">{recalculating ? 'Recalculating…' : 'Recalculates instantly. No AI or Qloo call.'}</p>
        </div>
      ) : null}

      <dl className="grid grid-cols-2 gap-0.5 border-2 border-surface-2 bg-surface-2 sm:grid-cols-3 xl:grid-cols-5">
        <Tile
          className="col-span-2 sm:col-span-1"
          label="Total"
          value={fmtUsd(plan.totals.spend)}
          sub={`of ${fmtUsd(plan.budgetUsd)} · ${fmtUsd(plan.leftoverUsd)} left`}
          hero
        />
        <Tile label="Screens" value={fmtInt(plan.totals.screens)} />
        <Tile label="Neighborhoods" value={fmtInt(plan.byNta.length)} />
        <Tile label="Weeks" value={fmtInt(plan.weeks)} sub={range ?? undefined} />
        <Tile
          label="Est. impressions"
          value={fmtCompact(plan.totals.impressions)}
          sub={`${fmtCompact(plan.totals.tasteWeightedImpressions)} taste-weighted`}
          badge={<ProvenanceBadge kind="assumption" align="end" />}
        />
      </dl>

      {/* On phones the cells run tighter, the money is a size smaller and a long plate truncates, so the
          four columns fit a 360 px screen without a sideways scroll. */}
      <div className="relative overflow-x-auto border-2 border-surface-2">
        <table className="w-full border-collapse text-left sm:min-w-[34rem]">
          <caption className="sr-only">Spend and estimated taste-weighted impressions by neighborhood. Expand a row for its screens.</caption>
          <thead>
            <tr className="border-b-2 border-surface-2 bg-surface align-bottom font-mono text-[11px] tracking-[0.08em] text-muted uppercase sm:text-xs sm:tracking-[0.12em]">
              <th scope="col" className="py-3 pr-1 pl-3 font-normal sm:px-4">
                Neighborhood
              </th>
              <th scope="col" className="px-1.5 py-3 text-right font-normal sm:px-3">
                Screens
              </th>
              <th scope="col" className="px-1.5 py-3 text-right font-normal sm:px-3">
                Spend
              </th>
              <th scope="col" className="hidden px-3 py-3 text-right font-normal sm:table-cell">
                Share
              </th>
              <th scope="col" className="py-3 pr-3 pl-1.5 text-right font-normal sm:px-4">
                <span className="sm:hidden">Taste-wtd</span>
                <span className="hidden sm:inline">Taste-weighted impr.</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {plan.byNta.map((row) => {
              const n = ntas.get(row.nta);
              const screens = plan.screens.filter((s) => s.nta === row.nta);
              const isOpen = Boolean(open[row.nta]);
              const panel = `plan-rows-${row.nta}`;
              return (
                <Fragment key={row.nta}>
                  <tr className="border-b-2 border-surface-2">
                    <th scope="row" className="py-3 pr-1 pl-3 font-normal sm:px-4">
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        aria-controls={panel}
                        onClick={() => setOpen((o) => ({ ...o, [row.nta]: !isOpen }))}
                        className="flex min-h-10 items-center gap-2 text-left sm:gap-3"
                      >
                        <ChevronDown
                          aria-hidden="true"
                          className={cx('size-4 shrink-0 text-muted transition-transform duration-[120ms]', isOpen && 'rotate-180')}
                        />
                        <span className="flex flex-col items-start gap-1">
                          <span className="block max-w-[7rem] sm:max-w-none">
                            <StreetPlate name={n?.short ?? row.nta} size="xs" />
                          </span>
                          <span className="text-xs text-muted">
                            {n ? `${fmtMultiplier(n.multiplier)} taste signal` : row.nta}
                            <span className="sr-only">. {isOpen ? 'Hide' : 'Show'} its screens</span>
                          </span>
                        </span>
                      </button>
                    </th>
                    <td className="px-1.5 py-3 text-right font-display text-2xl font-bold tabular-nums sm:px-3">{row.screens}</td>
                    <td className="px-1.5 py-3 text-right font-mono text-sm tabular-nums sm:px-3 sm:text-base">{fmtUsd(row.spend)}</td>
                    <td className="hidden px-3 py-3 text-right font-mono text-muted tabular-nums sm:table-cell">
                      {plan.totals.spend ? fmtPct(row.spend / plan.totals.spend) : '—'}
                    </td>
                    <td className="py-3 pr-3 pl-1.5 text-right font-mono text-sm tabular-nums sm:px-4 sm:text-base">
                      <span className="sm:hidden">{fmtCompact(row.tasteWeightedImpressions)}</span>
                      <span className="hidden sm:inline">{fmtInt(row.tasteWeightedImpressions)}</span>
                    </td>
                  </tr>
                  <tr id={panel} hidden={!isOpen} className="border-b-2 border-surface-2 bg-surface">
                    <td colSpan={5} className="px-3 py-2 sm:px-4">
                      <ScreenRows screens={screens} places={places} numberOf={numberOf} />
                    </td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-surface font-semibold">
              <th scope="row" className="py-3 pr-1 pl-3 text-left font-display text-base tracking-[0.06em] uppercase sm:px-4">
                Total
              </th>
              <td className="px-1.5 py-3 text-right font-display text-2xl font-bold tabular-nums sm:px-3">{plan.totals.screens}</td>
              <td className="px-1.5 py-3 text-right font-mono text-sm tabular-nums sm:px-3 sm:text-base">{fmtUsd(plan.totals.spend)}</td>
              <td className="hidden px-3 py-3 text-right font-mono tabular-nums sm:table-cell">100%</td>
              <td className="py-3 pr-3 pl-1.5 text-right font-mono text-sm tabular-nums sm:px-4 sm:text-base">
                <span className="sm:hidden">{fmtCompact(plan.totals.tasteWeightedImpressions)}</span>
                <span className="hidden sm:inline">{fmtInt(plan.totals.tasteWeightedImpressions)}</span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="border-2 border-surface-2 p-4">
          <h3 className="font-display text-base font-bold tracking-[0.08em] uppercase">Left over: {fmtUsd(plan.leftoverUsd)}</h3>
          <p className="mt-1 text-sm text-muted">{leftoverNote(plan)}</p>
        </div>
        {plan.nextBest.length ? (
          <div className="border-2 border-surface-2 p-4">
            <h3 className="font-display text-base font-bold tracking-[0.08em] uppercase">Next best if you add budget</h3>
            <ScreenRows screens={plan.nextBest} places={places} numberOf={(s) => plan.screens.length + plan.nextBest.indexOf(s) + 1} />
          </div>
        ) : null}
      </div>
      {linkLocal?.length ? <LinkLocalCard picks={linkLocal} places={places} /> : null}
    </section>
  );
}
