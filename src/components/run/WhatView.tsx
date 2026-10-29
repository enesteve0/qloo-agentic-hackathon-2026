'use client';

import { Check, ChevronRight, Download, Pause, Play, ScrollText, TriangleAlert } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { CreativeVariant, EvidencePack, NtaScore, RunState } from '@/shared/types';
import { Segmented } from '@/components/ui/Segmented';
import { StreetPlate } from '@/components/ui/StreetPlate';
import { cx } from '@/components/ui/cx';
import { ConfidenceMeter } from './NeighborhoodList';
import { ProvenanceBadge } from './ProvenanceBadge';
import { MOCKUP_THEMES, ScreenMockup, type MockupTheme } from './ScreenMockup';
import { COPY_RULES, fmtMultiplier, ntaMap, ntaRanks, planNeighborhoods, tagTypeLabel } from './model';
import type { PlaceLookup, ScreenPlace } from './types';

export const approvalKey = (nta: string, variant: 'A' | 'B') => `${nta}:${variant}`;

/** Link to a print-ready PNG of one ad, or null when downloads are unavailable. */
export type AdHref = ((nta: string, variant: 'A' | 'B') => string) | null;

export interface WhatViewProps {
  state: RunState;
  places?: PlaceLookup;
  /** Neighborhood on screen (defaults to the strongest). */
  selectedNta: string | null;
  onSelectNta: (code: string) => void;
  /** Approved variants keyed by `approvalKey(nta, variant)`. */
  approvals: Record<string, boolean>;
  onApprove: (key: string, approved: boolean) => void;
  /** Open the provenance drawer at this neighborhood's evidence request. */
  onOpenEvidence?: (nta: string) => void;
  /** Print-ready PNG link per ad (1080×1920); hidden when null. */
  adHref?: AdHref;
  className?: string;
}

const VARIANT_NAME = { A: 'Taste-led', B: 'Offer-led' } as const;

/** The best planned screen in a neighborhood (for the mockup's street plates). */
function screenFor(state: RunState, nta: string, places: PlaceLookup): ScreenPlace | null {
  const planned = (state.plan?.screens ?? []).filter((s) => s.nta === nta).sort((a, b) => b.fit - a.fit);
  for (const s of planned) if (places[s.i]) return places[s.i]!;
  return Object.values(places).find((p) => p.nta === nta) ?? null;
}

function RuleCheck({ v }: { v: CreativeVariant }) {
  const g = v.grounding;
  if (v.source === 'template' || g.replacedByTemplate) {
    return (
      <div className="flex flex-col gap-1.5 text-sm">
        <p className="flex items-center gap-2">
          <ProvenanceBadge kind="template" />
          <span className="text-muted">Rebuilt by rules from the same evidence.</span>
        </p>
        {g.failed.length ? (
          <p className="text-muted">
            <span className="font-semibold text-text">Why: </span>
            {g.failed.map((f) => f.detail).join(' ')}
          </p>
        ) : null}
      </div>
    );
  }
  if (!g.ok) {
    return (
      <p className="flex items-start gap-2 text-sm text-danger">
        <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span>Failed copy rules: {g.failed.map((f) => f.detail).join(' ')}</span>
      </p>
    );
  }
  return (
    <details className="group text-sm">
      <summary className="flex min-h-6 cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="grid size-4 place-items-center bg-ok text-[#0e0f11]">
          <Check className="size-3" strokeWidth={3.5} />
        </span>
        <span>
          Passed all {COPY_RULES.length} copy rules
          <span className="text-muted"> · details</span>
        </span>
        <ChevronRight aria-hidden="true" className="size-4 text-muted transition-transform duration-[120ms] group-open:rotate-90" />
      </summary>
      <ul className="mt-2 grid grid-cols-1 gap-1 pl-6 text-muted sm:grid-cols-2">
        {COPY_RULES.map((r) => (
          <li key={r.rule} className="flex items-center gap-1.5">
            <Check aria-hidden="true" className="size-3.5 text-ok" />
            {r.label}
          </li>
        ))}
      </ul>
    </details>
  );
}

function VariantCard({
  v,
  pack,
  state,
  nta,
  place,
  theme,
  approved,
  onApprove,
  downloadHref,
  hidden,
  className,
}: {
  v: CreativeVariant;
  pack: EvidencePack | undefined;
  state: RunState;
  nta: NtaScore | undefined;
  place: ScreenPlace | null;
  theme: MockupTheme;
  approved: boolean;
  onApprove: (approved: boolean) => void;
  downloadHref?: string | null;
  hidden?: boolean;
  className?: string;
}) {
  const id = useId();
  const labels = v.references
    .map((r) => pack?.items.find((i) => i.id === r.evidenceId))
    .filter((i): i is NonNullable<typeof i> => Boolean(i));
  const short = nta?.short ?? pack?.shortName ?? v.nta;
  return (
    <article
      aria-labelledby={`${id}-t`}
      aria-hidden={hidden || undefined}
      inert={hidden || undefined}
      className={cx('flex min-w-0 flex-col gap-4', className)}
    >
      <header className="flex items-center justify-between gap-3 border-b-2 border-surface-2 pb-2">
        <h4 id={`${id}-t`} className="flex items-baseline gap-2">
          <span className="font-display text-[28px] leading-none font-bold">{v.variant}</span>
          <span className="font-display text-base font-bold tracking-[0.08em] text-muted uppercase">{VARIANT_NAME[v.variant]}</span>
        </h4>
        {v.source === 'template' ? <ProvenanceBadge kind="template" align="end" /> : null}
      </header>
      <ScreenMockup
        ad={v}
        business={state.brief.business}
        offer={state.brief.offer}
        address={state.brief.address}
        hook={labels.map((l) => l.label)}
        place={place}
        fallbackPlate={short}
        theme={theme}
        label={`Variant ${v.variant} for ${short}`}
        className="mx-auto max-w-[19rem] 2xl:max-w-[22rem]"
      />
      {downloadHref ? (
        <a
          href={downloadHref}
          download
          className="inline-flex min-h-8 items-center gap-1.5 self-center font-display text-sm font-bold tracking-[0.06em] uppercase underline-offset-4 hover:underline"
        >
          <Download aria-hidden="true" className="size-4" />
          Download ad {v.variant}
          <span className="sr-only"> for {short}</span>
          <span className="font-sans text-xs font-normal tracking-normal normal-case">(PNG, 1080×1920)</span>
        </a>
      ) : null}
      <div className="flex flex-col gap-3">
        <RuleCheck v={v} />
        {v.references.length ? (
          <div className="text-sm">
            <p className="font-mono text-xs tracking-[0.14em] text-muted uppercase">Grounded in</p>
            <ul className="mt-1 flex flex-col gap-1">
              {v.references.map((r) => {
                const item = pack?.items.find((i) => i.id === r.evidenceId);
                return (
                  <li key={r.evidenceId + r.phrase} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-semibold">“{r.phrase}”</span>
                    <span aria-hidden="true" className="text-muted">
                      ←
                    </span>
                    <span className="sr-only">from evidence</span>
                    <span className="text-muted">
                      {item ? `${item.label} · ${item.support} place${item.support === 1 ? '' : 's'}` : 'evidence item missing'}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
        <label
          className={cx(
            'flex min-h-11 cursor-pointer items-center justify-between gap-3 border-2 px-3 transition-colors duration-[120ms] ease-sign',
            'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus)]',
            approved ? 'border-ok bg-surface' : 'border-surface-2 hover:border-border',
          )}
        >
          <span className="font-display text-base font-bold tracking-[0.06em] uppercase">
            {approved ? `Approved: ${v.variant}` : `Approve ${v.variant}`}
            <span className="sr-only"> for {short}</span>
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={approved}
            onChange={(e) => onApprove(e.target.checked)}
            className="peer sr-only"
          />
          <span
            aria-hidden="true"
            className="relative h-6 w-11 shrink-0 border-2 border-border bg-bg transition-colors duration-[120ms] peer-checked:border-ok peer-checked:bg-ok"
          >
            <span
              className={cx(
                'absolute top-0.5 left-0.5 size-4 bg-text transition-transform duration-[120ms] ease-sign',
                approved && 'translate-x-5 bg-[#0e0f11]',
              )}
            />
          </span>
        </label>
        {v.rationale ? <p className="text-sm leading-snug text-muted">{v.rationale}</p> : null}
      </div>
    </article>
  );
}

function EvidencePanel({
  pack,
  nta,
  variants,
  onOpenEvidence,
  className,
}: {
  pack: EvidencePack | undefined;
  nta: NtaScore | undefined;
  variants: CreativeVariant[];
  onOpenEvidence?: (nta: string) => void;
  className?: string;
}) {
  const id = useId();
  const short = nta?.short ?? pack?.shortName ?? '';
  if (!pack) {
    return (
      <aside className={cx('border-2 border-dashed border-surface-2 p-4 text-sm text-muted', className)}>
        Reading {short || 'this neighborhood'}… the evidence appears here before the ads.
      </aside>
    );
  }
  const maxWeight = Math.max(...pack.items.map((i) => i.weight), 0.0001);
  return (
    <aside aria-labelledby={`${id}-h`} className={cx('flex flex-col gap-4 border-2 border-surface-2 bg-surface p-4', className)}>
      <div>
        <p className="font-mono text-xs tracking-[0.14em] text-muted uppercase">Qloo evidence</p>
        <h3 id={`${id}-h`} className="mt-1 font-display text-[28px] leading-none font-bold uppercase">
          What {short} loves
        </h3>
        <p className="mt-2 text-sm leading-snug text-muted">
          The most distinctive tags among local places that fit these anchors. Every local word in the ads points here.
        </p>
      </div>
      <ul className="flex flex-col gap-2">
        {pack.items.map((item) => {
          const usedIn = variants.filter((v) => v.references.some((r) => r.evidenceId === item.id)).map((v) => v.variant);
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onOpenEvidence?.(pack.nta)}
                disabled={!onOpenEvidence}
                className="group flex w-full flex-col gap-1.5 border-2 border-surface-2 bg-bg px-3 py-2 text-left transition-colors duration-[120ms] ease-sign enabled:hover:border-border disabled:cursor-default"
              >
                <span className="flex w-full items-baseline justify-between gap-2">
                  <span className="font-display text-xl leading-none font-bold uppercase">{item.label}</span>
                  <span className={cx('shrink-0 font-mono text-xs', usedIn.length ? 'text-amber-text' : 'text-muted')}>
                    {usedIn.length ? `used in ${usedIn.join(' · ')}` : 'not used'}
                  </span>
                </span>
                <span className="flex w-full items-center gap-2 text-xs text-muted">
                  <span>{tagTypeLabel(item.tagType)}</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {item.support} place{item.support === 1 ? '' : 's'}
                  </span>
                  <span aria-hidden="true" className="ml-auto h-1 w-16 bg-surface-2">
                    <span className="block h-full bg-text/70" style={{ width: `${Math.max(8, (item.weight / maxWeight) * 100)}%` }} />
                  </span>
                </span>
                {onOpenEvidence ? <span className="sr-only">Open the Qloo request behind this evidence</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
      {pack.places.length ? (
        <details className="group text-sm">
          <summary className="flex min-h-6 cursor-pointer list-none items-center gap-1.5 font-display font-bold tracking-[0.06em] uppercase [&::-webkit-details-marker]:hidden">
            <ChevronRight aria-hidden="true" className="size-4 transition-transform duration-[120ms] group-open:rotate-90" />
            Places behind it · {pack.places.length}
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5 pl-5">
            {pack.places.map((p) => (
              <li key={p.id}>
                <span className="font-semibold">{p.name}</span>
                {p.categories.length ? <span className="text-muted"> · {p.categories.join(', ')}</span> : null}
              </li>
            ))}
          </ul>
          <p className="mt-2 pl-5 text-xs text-muted">Place names stay in the app. They never appear in the ads.</p>
        </details>
      ) : null}
      {onOpenEvidence ? (
        <button
          type="button"
          onClick={() => onOpenEvidence(pack.nta)}
          className="inline-flex min-h-8 items-center gap-1.5 self-start font-display text-sm font-bold tracking-[0.06em] text-link uppercase underline-offset-4 hover:underline"
        >
          <ScrollText aria-hidden="true" className="size-4" />
          See the Qloo request
        </button>
      ) : null}
    </aside>
  );
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return reduced;
}

function useIsCarousel(): boolean {
  const [carousel, setCarousel] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)');
    const update = () => setCarousel(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return carousel;
}

/**
 * WHAT: per neighborhood, two ads (A taste-led, B offer-led) on portrait screen mockups with the Qloo
 * evidence beside them, the copy-rule check and an approve switch per variant. On small screens the
 * two ads become a carousel that cross-fades every 6 s, with buttons, swipe and a pause control.
 */
export function WhatView({
  state,
  places = {},
  selectedNta,
  onSelectNta,
  approvals,
  onApprove,
  onOpenEvidence,
  adHref = null,
  className,
}: WhatViewProps) {
  const codes = planNeighborhoods(state).filter((c) => state.creative.some((s) => s.nta === c) || state.evidence.some((e) => e.nta === c));
  const current = selectedNta && codes.includes(selectedNta) ? selectedNta : (codes[0] ?? null);
  const byCode = ntaMap(state);
  const ranks = ntaRanks(state);
  const [theme, setTheme] = useState<MockupTheme>('night');
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduced = usePrefersReducedMotion();
  const carousel = useIsCarousel();
  const tabsId = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const swipeX = useRef<number | null>(null);

  const set = state.creative.find((s) => s.nta === current);
  const variants = set?.variants ?? [];
  const autoplay = carousel && !paused && !reduced && variants.length > 1;

  useEffect(() => {
    if (!autoplay) return;
    const t = window.setInterval(() => setActive((a) => (a + 1) % variants.length), 6000);
    return () => window.clearInterval(t);
  }, [autoplay, variants.length, current]);

  if (!current) return null;
  const nta = byCode.get(current);
  const pack = state.evidence.find((e) => e.nta === current);
  const place = screenFor(state, current, places);
  const screens = state.plan?.byNta.find((b) => b.nta === current)?.screens;
  const shown = Math.min(active, Math.max(variants.length - 1, 0));

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, k: number) => {
    const next = e.key === 'ArrowRight' ? k + 1 : e.key === 'ArrowLeft' ? k - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? codes.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const n = (next + codes.length) % codes.length;
    onSelectNta(codes[n]!);
    setActive(0);
    tabRefs.current[n]?.focus();
  };

  return (
    <section aria-labelledby="what-title" className={cx('flex flex-col gap-6', className)}>
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="max-w-3xl">
          <p className="font-mono text-xs tracking-[0.14em] text-muted uppercase">04 · What</p>
          <h2 id="what-title" className="mt-1 font-display text-[40px] leading-[0.95] font-bold uppercase">
            An ad for each neighborhood
          </h2>
          <p className="mt-3 text-lg text-muted">
            Two variants per neighborhood, written only from that neighborhood’s Qloo evidence. Approve the ones you want to
            run.
          </p>
        </div>
        <Segmented label="Mockup style" value={theme} onChange={setTheme} options={MOCKUP_THEMES} />
      </header>

      {/* Padded so the focus ring is not clipped by the sideways scroller. */}
      <div role="tablist" aria-label="Neighborhoods" className="relative -m-1 flex gap-2 overflow-x-auto p-1 [scrollbar-width:thin]">
        {codes.map((code, k) => {
          const n = byCode.get(code);
          const on = code === current;
          return (
            <button
              key={code}
              ref={(el) => {
                tabRefs.current[k] = el;
              }}
              type="button"
              role="tab"
              id={`${tabsId}-tab-${code}`}
              aria-selected={on}
              aria-controls={`${tabsId}-panel`}
              tabIndex={on ? 0 : -1}
              onClick={() => {
                onSelectNta(code);
                setActive(0);
              }}
              onKeyDown={(e) => onTabKey(e, k)}
              className={cx(
                'flex min-h-12 shrink-0 items-center gap-2.5 border-2 px-3 transition-colors duration-[120ms] ease-sign',
                on ? 'border-text bg-surface' : 'border-surface-2 hover:border-border',
              )}
            >
              <span className="font-mono text-xs text-muted">{String(ranks.get(code) ?? k + 1).padStart(2, '0')}</span>
              <StreetPlate name={n?.short ?? code} size="xs" />
              {n ? <span className="font-display text-lg font-bold tabular-nums">{fmtMultiplier(n.multiplier)}</span> : null}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-tab-${current}`} className="flex flex-col gap-6">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3 border-b-2 border-surface-2 pb-4">
          <StreetPlate name={nta?.short ?? pack?.shortName ?? current} size="lg" as="p" />
          <div className="flex flex-col">
            <p className="font-semibold">{nta?.name ?? current}</p>
            <p className="text-sm text-muted">{nta?.boro}</p>
          </div>
          {nta ? (
            <dl className="flex flex-wrap items-end gap-x-6 gap-y-2">
              <div>
                <dt className="font-mono text-xs tracking-[0.12em] text-muted uppercase">Taste signal</dt>
                <dd className="font-display text-[40px] leading-none font-bold tabular-nums">{fmtMultiplier(nta.multiplier)}</dd>
              </div>
              <div>
                <dt className="font-mono text-xs tracking-[0.12em] text-muted uppercase">Confidence</dt>
                <dd className="mt-1 text-sm">
                  <ConfidenceMeter level={nta.confidence} />
                </dd>
              </div>
              {screens ? (
                <div>
                  <dt className="font-mono text-xs tracking-[0.12em] text-muted uppercase">Screens</dt>
                  <dd className="font-display text-[28px] leading-none font-bold tabular-nums">{screens}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
        </div>

        <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(17rem,20rem)]">
          <div className="flex min-w-0 flex-col gap-4">
            {variants.length === 0 ? (
              <div className="grid min-h-64 place-items-center border-2 border-dashed border-surface-2 p-6 text-center text-muted">
                Writing two ads for {nta?.short ?? 'this neighborhood'} from its evidence…
              </div>
            ) : (
              <>
                {variants.length > 1 ? (
                  <div className="flex items-center justify-between gap-3 lg:hidden">
                    <Segmented
                      label="Variant"
                      value={String(shown)}
                      onChange={(v) => {
                        setActive(Number(v));
                        setPaused(true);
                      }}
                      options={variants.map((v, k) => ({ value: String(k), label: `${v.variant} · ${VARIANT_NAME[v.variant]}` }))}
                    />
                    {!reduced ? (
                      <button
                        type="button"
                        onClick={() => setPaused((p) => !p)}
                        aria-label={paused ? 'Play the A/B rotation' : 'Pause the A/B rotation'}
                        className="grid size-9 shrink-0 place-items-center border-2 border-border hover:border-text"
                      >
                        {paused ? <Play aria-hidden="true" className="size-4" /> : <Pause aria-hidden="true" className="size-4" />}
                      </button>
                    ) : null}
                  </div>
                ) : null}
                <div
                  className="grid gap-8 lg:grid-cols-2"
                  onPointerDown={(e) => {
                    swipeX.current = e.clientX;
                  }}
                  onPointerUp={(e) => {
                    if (!carousel || swipeX.current === null) return;
                    const dx = e.clientX - swipeX.current;
                    swipeX.current = null;
                    if (Math.abs(dx) < 48) return;
                    setActive((a) => (a + (dx < 0 ? 1 : -1) + variants.length) % variants.length);
                    setPaused(true);
                  }}
                >
                  {variants.map((v, k) => {
                    const key = approvalKey(current, v.variant);
                    const hidden = carousel && k !== shown;
                    return (
                      <VariantCard
                        key={key}
                        v={v}
                        pack={pack}
                        state={state}
                        nta={nta}
                        place={place}
                        theme={theme}
                        approved={Boolean(approvals[key])}
                        onApprove={(on) => onApprove(key, on)}
                        downloadHref={adHref ? adHref(current, v.variant) : null}
                        hidden={hidden}
                        className={cx(
                          'transition-opacity duration-[240ms] ease-sign max-lg:col-start-1 max-lg:row-start-1',
                          k === shown ? 'opacity-100' : 'max-lg:pointer-events-none max-lg:opacity-0',
                        )}
                      />
                    );
                  })}
                </div>
              </>
            )}
          </div>
          <EvidencePanel pack={pack} nta={nta} variants={variants} onOpenEvidence={onOpenEvidence} className="xl:sticky xl:top-4 xl:self-start" />
        </div>
      </div>
    </section>
  );
}
