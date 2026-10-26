import type { Metadata } from 'next';
import { LivePlanner } from '@/components/live/LivePlanner';
import { Footer } from '@/components/site/Footer';
import { Header } from '@/components/site/Header';
import { presetBySlug } from '@/content/presets';
import { getEnv } from '@/server/env';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Plan a campaign', robots: { index: false, follow: false } };

/** A new plan from a brief (`?preset=<slug>` prefills a sample brief). */
export default async function NewPlanPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const slug = typeof sp.preset === 'string' && presetBySlug(sp.preset) ? sp.preset : null;
  const mode = getEnv().QLOO_MODE;
  return (
    <div className="flex min-h-dvh flex-col">
      <Header current="plan" />
      <main id="main" className="flex-1">
        <LivePlanner initialSlug={slug} liveAvailable={mode === 'live'} />
      </main>
      <Footer />
    </div>
  );
}
