'use client';

import { ArrowRight, List, Map as MapIcon, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import MapClient from '@/components/map/MapClient';
import type { RunState } from '@/shared/types';
import { Segmented } from '@/components/ui/Segmented';
import { StreetPlate } from '@/components/ui/StreetPlate';
import { cx } from '@/components/ui/cx';
import { ConfidenceMeter, NeighborhoodList } from './NeighborhoodList';
import { HEAT_GRADIENT, fmtCount, fmtInt, fmtMultiplier, planNeighborhoods } from './model';

export interface WhereViewProps {
  /** A run with `where` set. */
  state: RunState;
  /** Jump to a neighborhood's ads (WHAT). */
  onOpenAds: (code: string) => void;
  className?: string;
}

export function TasteLegend({ showLlm, selectedCount, className }: { showLlm: boolean; selectedCount: number; className?: string }) {
  return (
    <div className={cx('flex flex-wrap items-center gap-x-6 gap-y-2 bg-bg px-3 py-2.5', className)}>
      <div className="flex min-w-0 items-center gap-3">
        <p className="font-display text-xs leading-tight font-bold tracking-[0.1em] text-text uppercase">
          Taste signal
          <span className="block text-muted">vs NYC baseline</span>
        </p>
        <div className="w-36 shrink-0 sm:w-44">
          <div aria-hidden="true" className="h-2.5 w-full" style={{ background: HEAT_GRADIENT }} />
          <div aria-hidden="true" className="relative mt-1 h-3.5 font-mono text-xs leading-none text-muted">
            <span className="absolute left-0">1×</span>
            <span className="absolute left-1/4 -translate-x-1/2">1.5×</span>
            <span className="absolute left-1/2 -translate-x-1/2">2×</span>
            <span className="absolute right-0">3×+</span>
          </div>
        </div>
        <p className="sr-only">Color scale from 1 times to 3 or more times the NYC baseline: 1×, 1.5×, 2×, 3×+.</p>
      </div>
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-3 border-2 border-[#0e0f11] bg-amber outline-1 outline-amber outline-solid" />
          Plan screen{selectedCount ? ` (${fmtInt(selectedCount)})` : ''}
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-1.5 bg-[#a6a9ae]" />
          Other screen
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-3 border-2 border-[#3d424a]" />
          Below baseline: no color
        </li>
        {showLlm ? (
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-3 w-4 border-[1.5px] border-dashed border-text" />
            AI-only pick
          </li>
        ) : null}
      </ul>
    </div>
  );
}

/**
 * WHERE: the night map of taste lift with the plan's screens (60%) beside the ranked neighborhood list
 * (40%). On small screens the map sits above the list at 45% of the viewport, with a Map/List toggle.
 */
export function WhereView({ state, onOpenAds, className }: WhereViewProps) {
  const where = state.where;
  const [focusNta, setFocusNta] = useState<string | null>(null);
  const [hoverNta, setHoverNta] = useState<string | null>(null);
  const [showLlm, setShowLlm] = useState(false);
  const [mobileMode, setMobileMode] = useState<'map' | 'list'>('map');
  const [listEl, setListEl] = useState<HTMLDivElement | null>(null);

  // Before a plan exists, the strongest three stand in for "in the plan".
  const planCodes = useMemo(() => {
    const picked = planNeighborhoods(state).filter((c) => state.plan?.byNta.some((b) => b.nta === c) ?? true);
    return picked.length ? picked : (state.where?.ntas.slice(0, 3).map((n) => n.code) ?? []);
  }, [state]);
  const ntaDisplay = useMemo(
    () => Object.fromEntries((where?.ntas ?? []).map((n, k) => [n.code, { multiplier: n.multiplier, rank: k + 1 }])),
    [where],
  );
  const selected = useMemo(() => (state.plan?.screens ?? []).map((s, k) => ({ i: s.i, rank: k + 1 })), [state.plan]);
  const llmPicks = useMemo(() => (showLlm ? (state.proof?.llmPicks.map((p) => p.nta) ?? []) : []), [showLlm, state.proof]);

  if (!where) return null;
  const lead = where.ntas[0];
  const focused = focusNta ? where.ntas.find((n) => n.code === focusNta) : undefined;
  const focusedInPlan = focused ? planCodes.includes(focused.code) : false;
  const screens = state.plan?.totals.screens ?? 0;
  const supports = state.envelopes.find((e) => e.operation === 'map_taste_lift')?.what_this_supports;

  return (
    <section aria-labelledby="where-title" className={cx('flex flex-col gap-5', className)}>
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="max-w-3xl">
          <p className="font-mono text-xs tracking-[0.14em] text-muted uppercase">03 · Where</p>
          <h2 id="where-title" className="mt-1 font-display text-[40px] leading-[0.95] font-bold uppercase">
            Where this taste over-indexes
          </h2>
          {lead ? (
            <p className="mt-3 text-lg text-muted">
              <span className="font-semibold text-text">{lead.short}</span> leads at{' '}
              <span className="font-semibold text-text">{fmtMultiplier(lead.multiplier)}</span> the NYC baseline.
              {screens ? (
                <>
                  {' '}
                  The plan buys <span className="font-semibold text-text">{fmtCount(screens, 'screen')}</span> in{' '}
                  {fmtCount(planCodes.length, 'neighborhood')}.
                </>
              ) : null}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {state.proof?.available ? (
            <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 border-2 border-surface-2 px-3 text-sm has-[:checked]:border-text has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus)]">
              <input type="checkbox" checked={showLlm} onChange={(e) => setShowLlm(e.target.checked)} className="size-4 accent-[var(--amber)]" />
              Outline the AI-only picks
            </label>
          ) : null}
          <Segmented
            label="Show"
            className="xl:hidden"
            value={mobileMode}
            onChange={setMobileMode}
            options={[
              { value: 'map', label: 'Map', icon: <MapIcon aria-hidden="true" className="size-4" /> },
              { value: 'list', label: 'List', icon: <List aria-hidden="true" className="size-4" /> },
            ]}
          />
        </div>
      </header>

      <div className="grid border-2 border-surface-2 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className={cx('flex min-w-0 flex-col', mobileMode === 'list' && 'max-xl:hidden')}>
          <TasteLegend showLlm={showLlm} selectedCount={screens} className="border-b-2 border-surface-2" />
          <div className="relative h-[45vh] min-h-[280px] bg-surface xl:h-[min(70vh,740px)]">
            <MapClient
              className="h-full w-full"
              heat={where.heat}
              ntas={ntaDisplay}
              selected={selected}
              llmPicks={llmPicks}
              focusNta={focusNta}
              highlightNta={hoverNta}
              onNtaClick={setFocusNta}
              ariaLabel={`Night map of New York: taste signal by neighborhood and the plan’s ${fmtInt(screens)} street screens. The neighborhood list has the same information.`}
            />
          </div>
        </div>

        {/* On wide screens the list fills the map's row height and scrolls on its own. */}
        <div className="relative min-w-0 border-surface-2 max-xl:border-t-2 xl:border-l-2">
          <div ref={setListEl} className="xl:absolute xl:inset-0 xl:overflow-y-auto">
            {focused ? (
              <div data-sticky-top className="sticky top-0 z-10 flex flex-wrap items-center gap-x-3 gap-y-2 border-b-2 border-surface-2 bg-bg px-4 py-3">
                <span className="font-mono text-xs tracking-[0.14em] text-muted uppercase">On the map</span>
                <StreetPlate name={focused.short} size="xs" />
                <span className="font-display text-xl font-bold tabular-nums">{fmtMultiplier(focused.multiplier)}</span>
                <ConfidenceMeter level={focused.confidence} className="text-sm text-muted" />
                <span className="ml-auto flex items-center gap-2">
                  {focusedInPlan ? (
                    <button
                      type="button"
                      onClick={() => onOpenAds(focused.code)}
                      className="inline-flex min-h-8 items-center gap-1 font-display text-sm font-bold tracking-[0.06em] text-link uppercase underline-offset-4 hover:underline"
                    >
                      Ads
                      <ArrowRight aria-hidden="true" className="size-4" />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setFocusNta(null)}
                    aria-label="Clear map focus"
                    className="grid size-8 place-items-center border-2 border-surface-2 hover:border-border"
                  >
                    <X aria-hidden="true" className="size-4" />
                  </button>
                </span>
              </div>
            ) : null}
            <NeighborhoodList
              className="p-4"
              leadTitle={state.plan ? undefined : 'Strongest fit'}
              ntas={where.ntas}
              planCodes={planCodes}
              plan={state.plan}
              evidence={state.evidence}
              focused={focusNta}
              onFocus={(code) => setFocusNta((cur) => (cur === code ? null : code))}
              onHover={setHoverNta}
              onOpenAds={onOpenAds}
              scrollRoot={listEl}
            />
          </div>
        </div>
      </div>

      {supports ? (
        <p className="max-w-3xl border-l-2 border-amber pl-3 text-sm text-muted">
          <span className="font-semibold text-text">What this map shows. </span>
          {supports}
        </p>
      ) : null}
    </section>
  );
}
