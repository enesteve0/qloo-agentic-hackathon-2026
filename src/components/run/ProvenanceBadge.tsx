'use client';

import { useId, useState } from 'react';
import { cx } from '@/components/ui/cx';
import type { BadgeKind } from './model';

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

/** Tooltip copy from PRODUCT §3. */
export function badgeExplanation(kind: BadgeKind, detail?: string | null): string {
  switch (kind) {
    case 'live':
      return 'Computed just now: Qloo and the AI model were called for this run.';
    case 'cached':
      return `Qloo results reused from our private cache${detail ? ` (fetched ${detail})` : ''}; the plan was computed now.`;
    case 'recorded':
      return `A real live run recorded ${detail ?? 'earlier'}, replayed exactly. Press Run live to redo it.`;
    case 'template':
      return 'AI writers were busy, so this copy was assembled by rules from the same Qloo evidence.';
    case 'assumption':
      return 'Not data. A labelled estimate you can change.';
    case 'synthetic':
      return 'Demo data generated locally; not Qloo data (only before the Qloo key is active).';
    case 'qloo_only':
      return detail ?? 'AI writers were busy, so rules and templates built this from Qloo evidence only.';
  }
}

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
  const [open, setOpen] = useState(false);
  const showDetail = detail && (kind === 'live' || kind === 'cached' || kind === 'recorded');
  return (
    <span
      className={cx('relative inline-flex align-middle', className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-describedby={`${id}-tip`}
        onClick={() => setOpen((v) => !v)}
        onFocus={() => setOpen(true)}
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
      <span
        id={`${id}-tip`}
        role="tooltip"
        className={cx(
          'absolute top-full z-40 w-max max-w-[min(18rem,calc(100vw-2rem))] pt-1',
          align === 'end' ? 'right-0' : 'left-0',
          open ? 'visible opacity-100' : 'invisible opacity-0',
          'transition-opacity duration-[120ms] ease-sign',
        )}
      >
        <span className="block border-2 border-border bg-surface-2 px-2.5 py-2 text-left text-sm leading-snug font-normal tracking-normal text-text normal-case shadow-[0_8px_24px_rgba(0,0,0,0.45)]">
          <span className="mb-1 block font-display text-xs font-bold tracking-[0.08em] text-muted uppercase">{NAME[kind]}</span>
          {badgeExplanation(kind, detail)}
        </span>
      </span>
    </span>
  );
}
