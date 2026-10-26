import type { AdVariant } from '@/shared/types';
import { cx } from '@/components/ui/cx';
import { platesFor, splitDesignation } from './streets';
import type { ScreenPlace } from './types';

export type MockupTheme = 'night' | 'sign' | 'paper';

export const MOCKUP_THEMES: { value: MockupTheme; label: string }[] = [
  { value: 'night', label: 'Night' },
  { value: 'sign', label: 'Sign' },
  { value: 'paper', label: 'Paper' },
];

export const MOCKUP_CAPTION = 'Illustrative mockup. Not affiliated with LinkNYC, Intersection or CityBridge.';

// Every text color here keeps ≥ 7:1 contrast on its screen background (PRODUCT §5).
const THEME: Record<MockupTheme, { screen: string; headline: string; hook: string; body: string; rule: string; cta: string; meta: string }> = {
  night: {
    screen: 'bg-[#0b0c0e] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)]',
    headline: 'text-[#f2f0ea]',
    hook: 'text-[#ffb547]',
    body: 'text-[#d6d3cc]',
    rule: 'border-[#2f3238]',
    cta: 'border-[#ffb547] text-[#ffb547]',
    meta: 'text-[#c9c6bf]',
  },
  sign: {
    screen: 'bg-[#005e3a] shadow-[inset_0_0_0_0.9cqw_#005e3a,inset_0_0_0_1.3cqw_#ffffff]',
    headline: 'text-white',
    hook: 'text-white',
    body: 'text-white',
    rule: 'border-white/70',
    cta: 'border-white text-white',
    meta: 'text-white',
  },
  paper: {
    screen: 'bg-[#f4f2ed]',
    headline: 'text-[#121315]',
    hook: 'text-[#004d30]',
    body: 'text-[#2a2c30]',
    rule: 'border-[#121315]',
    cta: 'border-[#121315] text-[#121315]',
    meta: 'text-[#2a2c30]',
  },
};

export interface ScreenMockupProps {
  ad: Pick<AdVariant, 'headline' | 'body' | 'cta'>;
  business: string;
  offer?: string | null;
  address?: string | null;
  /** Taste-hook labels (the evidence the copy leans on). */
  hook?: string[];
  /** The street screen this ad would run on; its real cross streets go on the plates. */
  place?: Pick<ScreenPlace, 'address' | 'cross1' | 'cross2'> | null;
  /** Plate text when no screen is known yet (e.g. the neighborhood's short name). */
  fallbackPlate?: string | null;
  theme?: MockupTheme;
  /** Prefix for the accessible description, e.g. "Variant A for Bed-Stuy". */
  label?: string;
  showCaption?: boolean;
  className?: string;
}

function Plate({ name, size }: { name: string; size: 'main' | 'cross' }) {
  const [main, suffix] = splitDesignation(name);
  return (
    <span
      className={cx(
        'sign-plate sign-plate-rim inline-flex max-w-full items-baseline gap-[0.3em] leading-none whitespace-nowrap',
        size === 'main' ? 'px-[2.6cqw] py-[1.5cqw] text-[5.6cqw]' : 'px-[2.2cqw] py-[1.2cqw] text-[4.4cqw]',
      )}
    >
      <span className="truncate">{main}</span>
      {suffix ? <span className="text-[0.7em]">{suffix}</span> : null}
    </span>
  );
}

/** Accessible description: the ad copy plus "illustrative mockup" (PRODUCT §7). */
export function mockupAlt(ad: Pick<AdVariant, 'headline' | 'body' | 'cta'>, business: string, label?: string): string {
  const body = /[.!?]$/.test(ad.body.trim()) ? ad.body.trim() : `${ad.body.trim()}.`;
  return `${label ? `${label}: ` : ''}${ad.headline}. ${body} ${ad.cta}. ${business}. Illustrative mockup.`;
}

/**
 * A 9:16 portrait street screen in a dark bezel on a generic plinth (deliberately not the real kiosk
 * silhouette), under green street plates with the real cross streets. Headline zone is the top 45%.
 * Everything scales with the component's width (container query units).
 */
export function ScreenMockup({
  ad,
  business,
  offer,
  address,
  hook = [],
  place,
  fallbackPlate,
  theme = 'night',
  label,
  showCaption = true,
  className,
}: ScreenMockupProps) {
  const t = THEME[theme];
  const plates = place ? platesFor(place) : null;
  const plateMain = plates?.street ?? fallbackPlate?.toUpperCase() ?? null;
  return (
    <figure className={cx('flex w-full flex-col items-center', className)}>
      <div role="img" aria-label={mockupAlt(ad, business, label)} className="@container w-full">
        <div aria-hidden="true" className="flex flex-col items-center select-none">
          {plateMain ? (
            <div className="flex w-[84%] flex-col items-center">
              <Plate name={plateMain} size="main" />
              {plates?.cross ? (
                <span className="-mt-[0.4cqw] ml-[14cqw]">
                  <Plate name={plates.cross} size="cross" />
                </span>
              ) : null}
              <span className="h-[3.2cqw] w-[2cqw] bg-[#2a2d33]" />
            </div>
          ) : null}

          <div className="w-[84%] rounded-[2.2cqw] border-2 border-[#2a2d33] bg-[#050506] p-[2.4cqw] shadow-[0_3cqw_8cqw_-3cqw_rgba(0,0,0,0.85)]">
            <div className={cx('relative flex aspect-[9/16] w-full flex-col overflow-hidden px-[6.2cqw] pt-[7cqw] pb-[5.5cqw]', t.screen)}>
              <div className="flex h-[45%] shrink-0 flex-col justify-end pb-[2cqw]">
                <p className={cx('line-clamp-3 font-display text-[10.4cqw] leading-[0.9] font-bold tracking-[0.01em] uppercase', t.headline)}>
                  {ad.headline}
                </p>
              </div>
              {hook.length ? (
                <p className={cx('border-t-[0.5cqw] pt-[2cqw] font-mono text-[3.1cqw] leading-tight tracking-[0.12em] uppercase', t.rule, t.hook)}>
                  {hook.slice(0, 3).join(' · ')}
                </p>
              ) : null}
              <p className={cx('mt-[3cqw] font-sans text-[4.8cqw] leading-[1.28]', t.body)}>{ad.body}</p>
              <div className={cx('mt-auto flex flex-col gap-[1.6cqw] border-t-[0.5cqw] pt-[3cqw]', t.rule)}>
                <p className={cx('font-display text-[6.2cqw] leading-none font-bold tracking-[0.02em] uppercase', t.headline)}>{business}</p>
                {offer ? <p className={cx('font-sans text-[3.6cqw] leading-snug font-semibold', t.meta)}>{offer}</p> : null}
                <div className="flex items-end justify-between gap-[2cqw]">
                  {address ? <p className={cx('min-w-0 font-mono text-[3.1cqw] leading-tight', t.meta)}>{address}</p> : <span />}
                  <span
                    className={cx(
                      'shrink-0 border-[0.5cqw] px-[2cqw] py-[1.2cqw] font-display text-[3.9cqw] leading-none font-bold tracking-[0.04em] whitespace-nowrap uppercase',
                      t.cta,
                    )}
                  >
                    {ad.cta} →
                  </span>
                </div>
              </div>
            </div>
          </div>

          <span className="h-[2.4cqw] w-[48%] bg-[#1d2024]" />
          <span className="h-[3.4cqw] w-[60%] bg-[linear-gradient(#25282d,#141619)] [clip-path:polygon(6%_0,94%_0,100%_100%,0_100%)]" />
          <span className="h-0.5 w-full bg-[linear-gradient(90deg,transparent,#2a2d33_20%,#2a2d33_80%,transparent)]" />
        </div>
      </div>
      {showCaption ? <figcaption className="mt-2 max-w-[34ch] text-center text-xs leading-snug text-muted">{MOCKUP_CAPTION}</figcaption> : null}
    </figure>
  );
}
