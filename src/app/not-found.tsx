import { ArrowRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Footer } from '@/components/site/Footer';
import { Header } from '@/components/site/Header';
import { buttonClass } from '@/components/ui/button';
import { StreetPlate } from '@/components/ui/StreetPlate';
import { PRESETS } from '@/content/presets';

export const metadata: Metadata = { title: 'Not found' };

/** Unknown pages, unknown sample plans and saved plans that have expired: a way back, never a dead end. */
export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col">
      <Header narrow />
      <main id="main" className="asphalt flex flex-1 flex-col">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-14 sm:px-6 lg:py-20">
          <StreetPlate name="Dead End" prefix="404" size="lg" designation={false} as="p" className="self-start" />
          <h1 className="max-w-3xl font-display text-5xl leading-[0.92] font-bold uppercase sm:text-[64px]">Nothing on this block</h1>
          <p className="max-w-2xl text-lg text-muted">
            This page doesn’t exist, or the plan behind it has expired. Saved plans are kept for up to 14 days; the sample plans
            are always open.
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Link href="/p/halfnote" className={buttonClass('primary', 'lg')}>
              Open a sample plan
              <ArrowRight aria-hidden="true" className="size-5" />
            </Link>
            <Link href="/plan/new" className={buttonClass('secondary', 'lg')}>
              Plan a campaign
            </Link>
          </div>
          <section aria-labelledby="nf-samples" className="mt-6 border-t-2 border-surface-2 pt-6">
            <h2 id="nf-samples" className="font-display text-sm font-bold tracking-[0.12em] text-muted uppercase">
              All sample plans
            </h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <li key={p.slug}>
                  <Link href={`/p/${p.slug}`} className={buttonClass('outline', 'md')}>
                    {p.brief.business}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </main>
      <Footer narrow />
    </div>
  );
}
