'use client';

import { useId, useRef, useState } from 'react';
import { cx } from '@/components/ui/cx';
import { badgeExplanation, type BadgeKind } from './model';

export type { BadgeKind } from './model';

const NAME: Record<BadgeKind, string> = {
  live: 'Live',
  cached: 'Cached',
  recorded: 'Recorded',
  template: 'Template',
  assumption: 'Assumption',
  synthetic: 'Synthetic',
  qloo_only: 'Qloo only',
};

const SWATCH: Record<BadgeKind, string> = {
  live: 'bg-ok motion-safe:led-pulse',
  cached: 'bg-link',
  recorded: 'bg-amber',
  template: 'bg-muted',
  assumption: 'border-2 border-dashed border-amber',
  synthetic: 'hazard',
  qloo_only: 'bg-muted',
};

export interface ProvenanceBadgeProps {
  kind: BadgeKind;
  /** Model (LIVE), fetch time (CACHED) or recording date (RECORDED). */
  detail?: string | null;
  /** Which edge the explanation aligns to; use "end" near the right edge of a layout. */
  align?: 'start' | 'end';
  className?: string;
}

/**
 * A transit service-status style chip that says where a number or run came from. The explanation
 * shows on hover, focus or tap and closes with Escape (WCAG 1.4.13).
 */
export function ProvenanceBadge({ kind, detail, align = 'start', className }: ProvenanceBadgeProps) {
  const id = useId();
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState(align);
  const showDetail = detail && (kind === 'live' || kind === 'cached' || kind === 'recorded');

  // Open toward the side with room, so the explanation never runs off a narrow screen.
  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setSide(window.innerWidth - r.left >= 300 ? 'start' : r.right >= 300 ? 'end' : align);
    setOpen(true);
  };

  return (
    <span className={cx('relative inline-flex align-middle', className)} onMouseEnter={show} onMouseLeave={() => setOpen(false)}>
      <button
        ref={ref}
        type="button"
        aria-describedby={`${id}-tip`}
        onClick={() => (open ? setOpen(false) : show())}
        onFocus={(e) => {
          // Keyboard focus shows the tip; focus moved by a click or a dialog opening does not.
          if (e.currentTarget.matches(':focus-visible')) show();
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && open) {
            e.stopPropagation();
            setOpen(false);
          }
        }}
        className={cx(
          'inline-flex h-6 items-center gap-1.5 border-2 bg-surface px-1.5 font-display text-[13px] leading-none font-bold tracking-[0.07em] text-text uppercase',
          kind === 'assumption' ? 'border-dashed border-amber' : 'border-border',
        )}
      >
        <span aria-hidden="true" className={cx('size-2.5 shrink-0', SWATCH[kind])} />
        <span>{NAME[kind]}</span>
        {showDetail ? (
          <>
            <span aria-hidden="true" className="text-muted">
              ·
            </span>
            <span className="max-w-[16ch] truncate font-mono text-[11px] font-normal tracking-normal normal-case">{detail}</span>
          </>
        ) : null}
      </button>
      {/* display:none while closed: a hidden-but-laid-out tip could widen the page near the right edge. */}
      <span
        id={`${id}-tip`}
        role="tooltip"
        className={cx('absolute top-full z-40 w-max max-w-[min(18rem,calc(100vw-2rem))] pt-1', side === 'end' ? 'right-0' : 'left-0', open ? 'block' : 'hidden')}
      >
        <span className="block border-2 border-border bg-surface-2 px-2.5 py-2 text-left text-sm leading-snug font-normal tracking-normal text-text normal-case shadow-[0_8px_24px_rgba(0,0,0,0.45)]">
          <span className="mb-1 block font-display text-xs font-bold tracking-[0.08em] text-muted uppercase">{NAME[kind]}</span>
          {badgeExplanation(kind, detail)}
        </span>
      </span>
    </span>
  );
}
