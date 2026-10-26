import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LivePlanner } from '@/components/live/LivePlanner';
import { SyntheticNote } from '@/components/live/SyntheticNote';
import { isRunTab } from '@/components/run/types';
import { Footer } from '@/components/site/Footer';
import { Header } from '@/components/site/Header';
import { presetBySlug } from '@/content/presets';
import { csvHref, runExtras } from '@/server/agent/extras';
import { presetRun } from '@/server/agent/presets';
import { getEnv } from '@/server/env';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const preset = presetBySlug((await params).slug);
  return {
    title: preset ? `${preset.brief.business}: sample plan` : 'Sample plan not found',
    description: preset ? `${preset.title}. A Stoop plan: street screens, ads, budget and proof.` : undefined,
    robots: { index: false, follow: false },
  };
}

/** A sample plan: the recorded live run of a preset brief, or a labelled synthetic run before recording. */
export default async function PresetPage({ params, searchParams }: Params) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  if (!presetBySlug(slug)) notFound();
  const run = await presetRun(slug);
  if (!run) notFound();
  const live = getEnv().QLOO_MODE === 'live';
  return (
    <div className="flex min-h-dvh flex-col">
      <Header current="plan" />
      {run.label?.kind === 'synthetic' ? (
        <SyntheticNote>{live ? 'press Run live to plan this brief with real Qloo data.' : 'the live agent uses real Qloo data.'}</SyntheticNote>
      ) : null}
      <main id="main" className="flex-1">
        <LivePlanner
          initial={run}
          initialExtras={runExtras(run, csvHref({ presetSlug: slug }))}
          initialTab={isRunTab(sp.view) ? sp.view : null}
          liveAvailable={live}
        />
      </main>
      <Footer />
    </div>
  );
}
