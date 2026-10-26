import { BookOpen, Film, MapPin, Mic, Music, Tag, Tv, User } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AnchorFlag, AnchorMapInfo, EntityType, ResolutionOutcome } from '@/shared/types';
import { cx } from '@/components/ui/cx';
import { ENTITY_LABEL } from './model';

export const ENTITY_ICON: Record<EntityType, LucideIcon> = {
  artist: Music,
  book: BookOpen,
  brand: Tag,
  movie: Film,
  person: User,
  place: MapPin,
  podcast: Mic,
  tv_show: Tv,
};

const FLAG_TEXT: Record<AnchorFlag, { label: string; detail: string }> = {
  DEFAULT_MAP: { label: 'Set aside', detail: 'Its NYC map matches Qloo’s default map, which is just overall density.' },
  IDENTICAL_PAIR: { label: 'Merged', detail: 'Its map is identical to another anchor’s, so it is counted once.' },
  DENSITY_ONLY: { label: 'Half weight', detail: 'Its map mostly follows where people are, not what they love.' },
  THIN: { label: 'Thin map', detail: 'Too few cells or too little overlap; its weight was reduced.' },
};

const MATCH_TEXT = {
  exact: 'Exact match',
  semantic: 'Matched by meaning',
  identifier: 'Matched by ID',
  chosen: 'You chose',
} as const;

export interface AnchorListProps {
  outcomes: ResolutionOutcome[];
  /** Per-anchor map flags and weights from WHERE, when available. */
  maps?: AnchorMapInfo[];
  className?: string;
}

/** The taste anchors and how each was matched in Qloo (the TASTE station). */
export function AnchorList({ outcomes, maps = [], className }: AnchorListProps) {
  if (outcomes.length === 0) return <p className={cx('text-sm text-muted', className)}>No anchors yet.</p>;
  return (
    <ul className={cx('flex flex-col divide-y-2 divide-surface-2 border-y-2 border-surface-2', className)}>
      {outcomes.map((o) => {
        const Icon = ENTITY_ICON[o.type];
        const resolved = o.status === 'resolved';
        const name = resolved ? o.selected.name : o.input;
        const sub = resolved ? o.selected.disambiguation : null;
        const map = resolved ? maps.find((m) => m.anchorId === o.selected.id) : undefined;
        return (
          <li key={`${o.type}:${o.input}`} className="flex gap-3 py-3">
            <span aria-hidden="true" className="mt-0.5 grid size-8 shrink-0 place-items-center border-2 border-surface-2 text-muted">
              <Icon className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-semibold">{name}</span>
                <span className="font-mono text-[11px] tracking-[0.1em] text-muted uppercase">{ENTITY_LABEL[o.type]}</span>
              </p>
              {sub ? <p className="text-sm text-muted">{sub}</p> : null}
              <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[13px]">
                {resolved ? (
                  <span className={cx(o.match === 'semantic' ? 'text-amber-text' : 'text-muted')}>
                    {MATCH_TEXT[o.match]}
                    {o.match === 'semantic' ? ` from “${o.input}”` : ''}
                  </span>
                ) : o.status === 'ambiguous' ? (
                  <span className="text-amber-text">Needs your pick</span>
                ) : (
                  <span className="text-danger">Not found in Qloo: skipped</span>
                )}
                {map ? <span className="font-mono text-muted">weight {map.weight.toFixed(1)}</span> : null}
              </p>
              {map?.flags.map((f) => (
                <p key={f} className="mt-1 text-[13px] leading-snug">
                  <span className="font-display font-bold tracking-[0.06em] text-amber-text uppercase">{FLAG_TEXT[f].label}: </span>
                  <span className="text-muted">{FLAG_TEXT[f].detail}</span>
                </p>
              ))}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
