'use client';

import { ArrowRight, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { Footer } from '@/components/site/Footer';
import { Header } from '@/components/site/Header';
import { buttonClass } from '@/components/ui/button';
import { StreetPlate } from '@/components/ui/StreetPlate';

/** An unexpected failure while rendering a page: what happened and two ways on, never a stack trace. */
export default function PageError({ error, retry }: { error: unknown; retry: () => void }) {
  // Server errors arrive with a digest that matches the server log; the message itself stays private.
  const digest = error && typeof error === 'object' && 'digest' in error && typeof error.digest === 'string' ? error.digest : null;
  return (
    <div className="flex min-h-dvh flex-col">
      <Header narrow />
      <main id="main" className="asphalt flex flex-1 flex-col">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-14 sm:px-6 lg:py-20">
          <StreetPlate name="Detour" size="lg" designation={false} as="p" className="self-start" />
          <h1 className="max-w-3xl font-display text-5xl leading-[0.92] font-bold uppercase sm:text-[64px]">This page didn’t load</h1>
          <p className="max-w-2xl text-lg text-muted">
            Stoop hit a problem on its side. Nothing was sent or bought, and saved plans are unaffected. Try again, or open a
            sample plan.
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button type="button" onClick={() => retry()} className={buttonClass('primary', 'lg')}>
              <RotateCcw aria-hidden="true" className="size-5" />
              Try again
            </button>
            <Link href="/p/halfnote" className={buttonClass('secondary', 'lg')}>
              Open a sample plan
              <ArrowRight aria-hidden="true" className="size-5" />
            </Link>
          </div>
          {digest ? <p className="font-mono text-xs text-muted">Reference {digest}</p> : null}
        </div>
      </main>
      <Footer narrow />
    </div>
  );
}
