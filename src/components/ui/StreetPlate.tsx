import { splitDesignation } from '@/components/run/streets';
import { cx } from './cx';

export type PlateSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const SIZES: Record<PlateSize, string> = {
  xs: 'px-1.5 py-[3px] text-[13px]',
  sm: 'px-2 py-1 text-base',
  md: 'px-2.5 py-1.5 text-xl',
  lg: 'px-3 py-2 text-[28px]',
  xl: 'px-4 py-2.5 text-[40px]',
};

export interface StreetPlateProps {
  /** Street or neighborhood name; rendered uppercase. */
  name: string;
  size?: PlateSize;
  /** Set a trailing designation (AV, ST, PL…) smaller, the way NYC street signs do. */
  designation?: boolean;
  /** Small leading text, e.g. a rank. */
  prefix?: string;
  as?: 'span' | 'p' | 'div';
  className?: string;
}

/** An NYC street-name plate: sign green, white inset rule, condensed caps. */
export function StreetPlate({ name, size = 'md', designation = true, prefix, as: Tag = 'span', className }: StreetPlateProps) {
  const [main, suffix] = designation ? splitDesignation(name.toUpperCase()) : [name, null];
  return (
    <Tag className={cx('sign-plate sign-plate-rim inline-flex max-w-full items-baseline gap-[0.28em] leading-none', SIZES[size], className)}>
      {prefix ? <span className="font-mono text-[0.62em] font-normal tracking-normal">{prefix}</span> : null}
      <span className="min-w-0 truncate">{main}</span>
      {suffix ? <span className="text-[0.7em]">{suffix}</span> : null}
    </Tag>
  );
}
