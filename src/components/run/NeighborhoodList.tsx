'use client';

import { ArrowRight, ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Confidence, EvidencePack, MediaPlan, NtaScore } from '@/shared/types';
import { StreetPlate } from '@/components/ui/StreetPlate';
import { cx } from '@/components/ui/cx';
import { CONFIDENCE_LABEL, evidenceLabels, fmtInt, fmtMultiplier, fmtPct, heatColor } from './model';

export interface NeighborhoodListProps {
  /** Every scored neighborhood, ranked (WhereResult.ntas). */
  ntas: NtaScore[];
  /** Neighborhoods the plan buys, strongest first. */
  planCodes: string[];
  plan: MediaPlan | null;
  evidence: EvidencePack[];
  /** Neighborhood highlighted on the map. */
  focused: string | null;
  /** "Show on map": the parent flies the map there. */
  onFocus: (code: string) => void;
  /** Pointer hover or keyboard focus, for a lighter map highlight. */
  onHover?: (code: string | null) => void;
  /** Jump to this neighborhood's ads (WHAT). */
  onOpenAds?: (code: string) => void;
  /** Scroll container to keep the focused card in view (desktop column). */
  scrollRoot?: HTMLElement | null;
  /** Heading for the lead group (defaults to "In the plan"). */
  leadTitle?: string;
  className?: string;
}

const LEVEL: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };

export function ConfidenceMeter({ level, className }: { level: Confidence; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5', className)}>
      <span aria-hidden="true" className="inline-flex items-end gap-0.5">
        {[1, 2, 3].map((k) => (
          <span key={k} className={cx('w-1', k === 1 ? 'h-1.5' : k === 2 ? 'h-2.5' : 'h-3.5', k <= LEVEL[level] ? 'bg-text' : 'bg-surface-2')} />
        ))}
      </span>
      <span>{CONFIDENCE_LABEL[level].replace(' confidence', '')}</span>
    </span>
  );
}

function Swatch({ m }: { m: number }) {
  const c = heatColor(m);
  return (
    <span
      aria-hidden="true"
      className={cx('inline-block size-3 shrink-0 border-2', c ? 'border-transparent' : 'border-border')}
      style={c ? { background: c } : undefined}
    />
  );
}

/**
 * Ranked neighborhoods: the plan's picks as street-sign cards, then the rest, then busy-but-off-taste
 * areas the plan skipped. It is the accessible equivalent of the map: every value is printed.
 */
export function NeighborhoodList({
  ntas,
  planCodes,
  plan,
  evidence,
  focused,
  onFocus,
  onHover,
  onOpenAds,
  scrollRoot,
  leadTitle,
  className,
}: NeighborhoodListProps) {
  const [showAllPicked, setShowAll] = useState(false);
  const refs = useRef(new Map<string, HTMLElement>());
  const rank = new Map(ntas.map((n, k) => [n.code, k + 1]));
  const inPlan = planCodes.map((c) => ntas.find((n) => n.code === c)).filter((n): n is NtaScore => Boolean(n));
  const rest = ntas.filter((n) => !planCodes.includes(n.code));
  const top = rest.filter((n) => n.multiplier >= 1).slice(0, 6);
  const skipped = rest
    .filter((n) => n.multiplier < 1)
    .sort((a, b) => b.adKiosks - a.adKiosks)
    .slice(0, 3);
  // A neighborhood picked on the map that is not listed yet opens the full list.
  const hiddenFocus =
    focused !== null && rest.some((n) => n.code === focused) && !top.some((n) => n.code === focused) && !skipped.some((n) => n.code === focused);
  const showAll = showAllPicked || hiddenFocus;
  const visibleRest = showAll ? rest : top;
  const spend = plan?.totals.spend ?? 0;

  // Keep the focused card in view inside the scrolling column, clear of a sticky bar at its top.
  useEffect(() => {
    if (!focused || !scrollRoot) return;
    const el = refs.current.get(focused);
    if (!el) return;
    const covered = scrollRoot.querySelector<HTMLElement>('[data-sticky-top]')?.offsetHeight ?? 0;
    const y = el.getBoundingClientRect().top - scrollRoot.getBoundingClientRect().top + scrollRoot.scrollTop;
    if (y < scrollRoot.scrollTop + covered || y + el.offsetHeight > scrollRoot.scrollTop + scrollRoot.clientHeight) {
      scrollRoot.scrollTo({ top: Math.max(0, y - covered - 16), behavior: 'smooth' });
    }
  }, [focused, showAll, scrollRoot]);

  const setRef = (code: string) => (el: HTMLElement | null) => {
    if (el) refs.current.set(code, el);
    else refs.current.delete(code);
  };

  const renderRow = (n: NtaScore) => (
    <li key={n.code} ref={setRef(n.code)}>
      <button
        type="button"
        aria-pressed={focused === n.code}
        onClick={() => onFocus(n.code)}
        onMouseEnter={() => onHover?.(n.code)}
        onMouseLeave={() => onHover?.(null)}
        onFocus={() => onHover?.(n.code)}
        onBlur={() => onHover?.(null)}
        className={cx(
          'flex min-h-11 w-full items-center gap-3 border-2 px-3 py-2 text-left transition-colors duration-[120ms] ease-sign',
          focused === n.code ? 'border-amber bg-surface' : 'border-transparent hover:border-surface-2 hover:bg-surface',
        )}
      >
        <span className="w-7 shrink-0 font-mono text-xs text-muted">{String(rank.get(n.code)).padStart(2, '0')}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{n.name}</span>
          <span className="block text-xs text-muted">
            {n.boro} · {n.adKiosks} screens · {CONFIDENCE_LABEL[n.confidence].toLowerCase()}
          </span>
        </span>
        <Swatch m={n.multiplier} />
        <span className="w-14 shrink-0 text-right font-display text-xl font-bold tabular-nums">{fmtMultiplier(n.multiplier)}</span>
      </button>
    </li>
  );

  return (
    <div className={cx('flex flex-col gap-8', className)}>
      <section aria-labelledby="nl-plan">
        <h3 id="nl-plan" className="mb-3 font-display text-sm font-bold tracking-[0.12em] text-muted uppercase">
          {leadTitle ?? 'In the plan'} · {inPlan.length} neighborhood{inPlan.length === 1 ? '' : 's'}
        </h3>
        <ol className="flex flex-col gap-3">
          {inPlan.map((n) => {
            const r = rank.get(n.code) ?? 0;
            const by = plan?.byNta.find((b) => b.nta === n.code);
            const pack = evidence.find((e) => e.nta === n.code);
            const isFocused = focused === n.code;
            return (
              <li
                key={n.code}
                ref={setRef(n.code)}
                className={cx('border-2 bg-surface transition-colors duration-[120ms] ease-sign', isFocused ? 'border-amber' : 'border-surface-2')}
              >
                <button
                  type="button"
                  aria-pressed={isFocused}
                  onClick={() => onFocus(n.code)}
                  onMouseEnter={() => onHover?.(n.code)}
                  onMouseLeave={() => onHover?.(null)}
                  onFocus={() => onHover?.(n.code)}
                  onBlur={() => onHover?.(null)}
                  className="flex w-full items-start gap-3 p-4 text-left hover:bg-surface-2/40"
                >
                  <span className="pt-1 font-mono text-sm text-muted">{String(r).padStart(2, '0')}</span>
                  <span className="min-w-0 flex-1">
                    <StreetPlate name={n.short} size="sm" />
                    <span className="mt-2 block text-sm leading-snug text-muted">
                      {n.name} · {n.boro}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end">
                    <span className="flex items-center gap-2">
                      <Swatch m={n.multiplier} />
                      <span className="font-display text-[40px] leading-none font-bold tabular-nums">{fmtMultiplier(n.multiplier)}</span>
                    </span>
                    <span className="mt-1 font-mono text-xs tracking-[0.12em] text-muted uppercase">taste signal</span>
                    <span className="sr-only">{`, ${CONFIDENCE_LABEL[n.confidence]}. Show on map.`}</span>
                  </span>
                </button>
                <div className="flex flex-col gap-3 px-4 pb-4">
                  <dl className="grid grid-cols-3 gap-2 border-t-2 border-surface-2 pt-3 text-sm">
                    <div>
                      <dt className="font-mono text-xs tracking-[0.12em] text-muted uppercase">Confidence</dt>
                      <dd className="mt-1">
                        <ConfidenceMeter level={n.confidence} />
                      </dd>
                    </div>
                    <div>
                      <dt className="font-mono text-xs tracking-[0.12em] text-muted uppercase">Screens</dt>
                      <dd className="mt-1 tabular-nums">
                        <span className="font-semibold">{by?.screens ?? 0}</span>
                        <span className="text-muted"> of {n.adKiosks}</span>
                      </dd>
                    </div>
                    <div>
                      <dt className="font-mono text-xs tracking-[0.12em] text-muted uppercase">Budget</dt>
                      <dd className="mt-1 font-semibold tabular-nums">{by && spend ? fmtPct(by.spend / spend) : '—'}</dd>
                    </div>
                  </dl>
                  {pack?.items.length ? (
                    <ul aria-label={`Qloo evidence in ${n.short}`} className="flex flex-wrap gap-1.5">
                      {evidenceLabels(pack, 4).map((label) => (
                        <li key={label} className="border-2 border-surface-2 px-2 py-0.5 text-[13px]">
                          {label}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {onOpenAds ? (
                    <button
                      type="button"
                      onClick={() => onOpenAds(n.code)}
                      className="inline-flex min-h-8 items-center gap-1.5 self-start font-display text-sm font-bold tracking-[0.06em] text-link uppercase underline-offset-4 hover:underline"
                    >
                      See the ads for {n.short}
                      <ArrowRight aria-hidden="true" className="size-4" />
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      {rest.length ? (
        <section aria-labelledby="nl-rest">
          <h3 id="nl-rest" className="mb-2 font-display text-sm font-bold tracking-[0.12em] text-muted uppercase">
            {showAll ? `All other neighborhoods · ${rest.length}` : 'Next strongest'}
          </h3>
          <ol className="flex flex-col">
            {visibleRest.map(renderRow)}
          </ol>
          <button
            type="button"
            aria-expanded={showAll}
            onClick={() => setShowAll(!showAll)}
            className="mt-2 inline-flex min-h-8 items-center gap-1.5 font-display text-sm font-bold tracking-[0.06em] text-link uppercase underline-offset-4 hover:underline"
          >
            <ChevronDown aria-hidden="true" className={cx('size-4 transition-transform duration-[120ms]', showAll && 'rotate-180')} />
            {showAll ? 'Show fewer' : `Show all ${fmtInt(rest.length)} neighborhoods`}
          </button>
        </section>
      ) : null}

      {skipped.length && !showAll ? (
        <section aria-labelledby="nl-skip">
          <h3 id="nl-skip" className="font-display text-sm font-bold tracking-[0.12em] text-muted uppercase">
            Busy, but off-taste: skipped
          </h3>
          <p className="mt-1 mb-2 text-sm text-muted">Lots of screens, weak taste signal. A plan by traffic alone would buy these.</p>
          <ol className="flex flex-col">
            {skipped.map(renderRow)}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
