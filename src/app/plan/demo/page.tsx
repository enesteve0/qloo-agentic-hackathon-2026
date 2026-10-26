import type { Metadata } from 'next';
import Link from 'next/link';
import { isRunTab } from '@/components/run/types';
import { Footer } from '@/components/site/Footer';
import { Header } from '@/components/site/Header';
import { runExtras } from '@/server/agent/extras';
import { DemoRun } from './DemoRun';
import { demoState, isDemoState } from './variants';

export const metadata: Metadata = {
  title: 'Sample plan: Halfnote Supper Club',
  description: 'A synthetic sample plan for a fictional Bed-Stuy jazz supper club: screens, ads, budget and proof.',
  robots: { index: false, follow: false },
};

/**
 * The design canvas and e2e target until recorded live runs exist: the synthetic Halfnote run rendered
 * through the same RunScreen as live runs. `?view=` picks the station; `?state=` shows a design state
 * (running, needs-input, degraded, empty, error).
 */
export default async function DemoPlanPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const kind = isDemoState(sp.state) ? sp.state : 'done';
  const { view, state } = demoState(kind);
  // The same server-side extras as live runs: street places, the booking draft and the free LinkLocal picks.
  const extras = runExtras(state, '/plan/demo/screens.csv');
  const initialTab = isRunTab(sp.view) ? sp.view : kind === 'empty' ? 'plan' : 'where';

  return (
    <div className="flex min-h-dvh flex-col">
      <Header current="plan" />
      <div role="note" className="border-b-2 border-surface-2 bg-surface">
        <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 sm:px-6 lg:px-8">
          <span aria-hidden="true" className="hazard h-5 w-10 shrink-0" />
          <p className="min-w-0 flex-1 text-sm">
            <span className="font-display text-base font-bold tracking-[0.06em] uppercase">Synthetic demo data</span>
            <span className="text-muted"> — the live agent uses real Qloo data. </span>
            <Link href="/how-it-works#labels" className="whitespace-nowrap underline underline-offset-4">
              What the labels mean
            </Link>
          </p>
          {kind !== 'done' ? (
            <p className="font-mono text-xs text-muted">
              Design state: {kind} ·{' '}
              <Link href="/plan/demo" className="underline underline-offset-4">
                back to the finished plan
              </Link>
            </p>
          ) : null}
        </div>
      </div>
      <main id="main" className="flex-1">
        <DemoRun view={view} places={extras.places} send={extras.send} linkLocal={extras.linkLocal} initialTab={initialTab} />
      </main>
      <Footer />
    </div>
  );
}
