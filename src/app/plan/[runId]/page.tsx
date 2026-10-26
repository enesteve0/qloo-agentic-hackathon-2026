import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LivePlanner } from '@/components/live/LivePlanner';
import { SyntheticNote } from '@/components/live/SyntheticNote';
import { isRunTab } from '@/components/run/types';
import { Footer } from '@/components/site/Footer';
import { Header } from '@/components/site/Header';
import { csvHref, runExtras } from '@/server/agent/extras';
import { getEnv } from '@/server/env';
import { loadRun, settleStale } from '@/server/store/runs';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ runId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const run = await loadRun((await params).runId);
  return { title: run ? `${run.brief.business} plan` : 'Plan not found', robots: { index: false, follow: false } };
}

/** A saved run: rendered from the stored state, and followed live if it is still running. */
export default async function SavedPlanPage({ params, searchParams }: Params) {
  const [{ runId }, sp] = await Promise.all([params, searchParams]);
  const stored = await loadRun(runId);
  if (!stored) notFound();
  const run = settleStale(stored);
  return (
    <div className="flex min-h-dvh flex-col">
      <Header current="plan" />
      {run.mode === 'mock' ? <SyntheticNote /> : null}
      <main id="main" className="flex-1">
        <LivePlanner
          initial={run}
          initialExtras={run.plan ? runExtras(run, csvHref({ runId })) : null}
          initialTab={isRunTab(sp.view) ? sp.view : null}
          liveAvailable={getEnv().QLOO_MODE === 'live'}
        />
      </main>
      <Footer />
    </div>
  );
}
