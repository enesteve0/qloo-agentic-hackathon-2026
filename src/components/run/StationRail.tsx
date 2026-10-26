'use client';

import { Check } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { cx } from '@/components/ui/cx';
import { STATION_BLURB, STATION_LABEL } from './model';
import { STATIONS, isRunTab, type RunTab, type StationId, type StationStatus } from './types';

const STATUS_TEXT: Record<StationStatus, string> = {
  pending: 'not started',
  active: 'in progress',
  done: 'done',
  needs_input: 'needs your answer',
  degraded: 'done with a fallback',
  error: 'stopped',
};

export interface StationRailProps {
  statuses: Record<StationId, StationStatus>;
  /** The view on screen. */
  current: RunTab | null;
  /** Views that have data and can be opened. */
  available: Record<RunTab, boolean>;
  onSelect: (tab: RunTab) => void;
  /** Real link for each view (`?view=…`) so the rail works as plain links too. */
  hrefFor: (tab: RunTab) => string;
  /** In-page targets for BRIEF and TASTE, which are panels rather than views. */
  anchorFor?: Partial<Record<'brief' | 'taste', string>>;
  className?: string;
}

function Glyph({ status }: { status: StationStatus }) {
  if (status === 'done' || status === 'degraded') {
    return (
      <span
        aria-hidden="true"
        className={cx('grid size-4 place-items-center', status === 'done' ? 'bg-ok text-[#0e0f11]' : 'bg-amber text-[#0e0f11]')}
      >
        <Check className="size-3" strokeWidth={3.5} />
      </span>
    );
  }
  if (status === 'active') return <span aria-hidden="true" className="size-4 bg-amber motion-safe:led-pulse" />;
  if (status === 'needs_input') {
    return (
      <span aria-hidden="true" className="grid size-4 place-items-center bg-amber font-display text-[13px] leading-none font-bold text-[#0e0f11]">
        ?
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span aria-hidden="true" className="grid size-4 place-items-center bg-danger font-display text-[13px] leading-none font-bold text-[#0e0f11]">
        !
      </span>
    );
  }
  return <span aria-hidden="true" className="size-4 border-2 border-border" />;
}

/**
 * BRIEF → TASTE → WHERE → WHAT → PLAN → PROOF → SEND as a line of station chips: progress and
 * navigation in one. Status is carried by a glyph and screen-reader text, never by color alone.
 */
export function StationRail({ statuses, current, available, onSelect, hrefFor, anchorFor, className }: StationRailProps) {
  const listRef = useRef<HTMLOListElement>(null);

  // Keep the selected chip in view when the rail scrolls sideways on small screens.
  useEffect(() => {
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!list || !el) return;
    const target = el.offsetLeft - (list.clientWidth - el.offsetWidth) / 2;
    list.scrollTo({ left: Math.max(0, target), behavior: 'auto' });
  }, [current]);

  return (
    <nav aria-label="Plan stations" className={className}>
      <ol ref={listRef} className="relative flex snap-x items-stretch gap-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {STATIONS.map((station, k) => {
          const status = statuses[station];
          const tab = isRunTab(station) ? station : null;
          const selected = tab !== null && tab === current;
          const canOpen = tab !== null && available[tab];
          const inner = (
            <>
              <span className="font-mono text-[11px] text-muted group-aria-[current=page]:text-bg/70">{String(k + 1).padStart(2, '0')}</span>
              <span className="font-display text-base leading-none font-bold tracking-[0.08em] uppercase sm:text-lg">{STATION_LABEL[station]}</span>
              <Glyph status={status} />
              <span className="sr-only">
                {`, ${STATUS_TEXT[status]}`}
                {selected ? ', on screen' : ''}
              </span>
            </>
          );
          // Colors carry `!` because globals.css styles `a` outside Tailwind's layers.
          const chip = cx(
            'group flex h-11 shrink-0 snap-start items-center gap-2 border-2 px-3 transition-colors duration-[120ms] ease-sign lg:flex-1 lg:justify-center',
            selected ? 'border-text bg-text text-bg!' : 'border-surface-2 bg-surface text-text!',
            status === 'pending' && !selected && 'text-muted!',
            status === 'needs_input' && !selected && 'border-amber',
            status === 'error' && !selected && 'border-danger',
          );
          return (
            <li key={station} className={cx('flex shrink-0 items-center', k > 0 ? 'lg:flex-[1.35_1_0%]' : 'lg:flex-1')}>
              {k > 0 ? (
                <span
                  aria-hidden="true"
                  className={cx('h-0.5 w-3 shrink-0 sm:w-5 lg:w-auto lg:min-w-6 lg:flex-[0.35_1_0%]', status === 'pending' ? 'bg-surface-2' : 'bg-border')}
                />
              ) : null}
              {tab && canOpen ? (
                <a
                  href={hrefFor(tab)}
                  aria-current={selected ? 'page' : undefined}
                  title={STATION_BLURB[station]}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                    e.preventDefault();
                    onSelect(tab);
                  }}
                  className={cx(chip, !selected && 'hover:border-border hover:text-text!')}
                >
                  {inner}
                </a>
              ) : !tab && anchorFor?.[station as 'brief' | 'taste'] ? (
                <a
                  href={anchorFor[station as 'brief' | 'taste']}
                  title={STATION_BLURB[station]}
                  className={cx(chip, 'hover:border-border hover:text-text!')}
                >
                  {inner}
                </a>
              ) : (
                <span className={cx(chip, tab && 'cursor-not-allowed')} title={STATION_BLURB[station]}>
                  {inner}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
