import { ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { cx } from '@/components/ui/cx';

export const GITHUB_URL = 'https://github.com/enesteve0/qloo-agentic-hackathon-2026';

export type SiteSection = 'home' | 'how-it-works' | 'judges' | 'status' | 'plan' | 'validation';

export const SITE_NAV: { href: string; label: string; section?: SiteSection; external?: boolean }[] = [
  { href: '/how-it-works', label: 'How it works', section: 'how-it-works' },
  { href: '/judges', label: 'Judges', section: 'judges' },
  { href: '/status', label: 'Status', section: 'status' },
  { href: GITHUB_URL, label: 'GitHub', external: true },
];

export function NavLinks({ current, className }: { current?: SiteSection; className?: string }) {
  return (
    <ul className={cx('flex flex-wrap items-center', className)}>
      {SITE_NAV.map((item) => (
        <li key={item.href}>
          {item.external ? (
            <a
              href={item.href}
              rel="noreferrer"
              target="_blank"
              className="inline-flex min-h-10 items-center gap-1 px-2 font-display text-base font-bold tracking-[0.06em] text-text! uppercase hover:text-amber! sm:px-3"
            >
              {item.label}
              <ArrowUpRight aria-hidden="true" className="size-4" />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : (
            <Link
              href={item.href}
              aria-current={item.section === current ? 'page' : undefined}
              className="inline-flex min-h-10 items-center px-2 font-display text-base font-bold tracking-[0.06em] text-text! uppercase hover:text-amber! aria-[current=page]:text-amber! aria-[current=page]:underline aria-[current=page]:decoration-2 aria-[current=page]:underline-offset-[6px] sm:px-3"
            >
              {item.label}
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Page width of the site chrome: `narrow` lines it up with the 6xl content column of the site pages. */
export const chromeWidth = (narrow?: boolean) => (narrow ? 'max-w-6xl px-4 sm:px-6' : 'max-w-[1600px] px-4 sm:px-6 lg:px-8');

/** Site header: the street-sign wordmark and the main navigation. */
export function Header({ current, narrow }: { current?: SiteSection; narrow?: boolean }) {
  return (
    <header className="border-b-2 border-surface-2 bg-bg">
      <div className={cx('mx-auto flex w-full flex-wrap items-center justify-between gap-x-6 gap-y-1 py-3', chromeWidth(narrow))}>
        <Link
          href="/"
          aria-label="Stoop home"
          aria-current={current === 'home' ? 'page' : undefined}
          className="sign-plate sign-plate-rim m-0.5 px-2.5 py-1 text-2xl leading-none text-sign-text no-underline"
        >
          Stoop
        </Link>
        <nav aria-label="Site" className="-mx-2 sm:mx-0">
          <NavLinks current={current} />
        </nav>
      </div>
    </header>
  );
}
