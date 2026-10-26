'use client';

import type { ReactNode } from 'react';
import { cx } from './cx';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

export interface SegmentedProps<T extends string> {
  /** Accessible name of the group. */
  label: string;
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  /** Stretch the buttons to fill the row (mobile toggles). */
  block?: boolean;
}

/** A row of toggle buttons (aria-pressed) for switching a local view. */
export function Segmented<T extends string>({ label, options, value, onChange, className, block }: SegmentedProps<T>) {
  return (
    <div role="group" aria-label={label} className={cx('inline-flex border-2 border-border bg-bg', block && 'flex w-full', className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={cx(
              'inline-flex min-h-9 items-center justify-center gap-1.5 px-3 font-display text-sm font-bold tracking-[0.06em] uppercase transition-colors duration-[120ms] ease-sign',
              block && 'flex-1',
              on ? 'bg-text text-bg' : 'text-muted hover:bg-surface-2 hover:text-text',
            )}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
