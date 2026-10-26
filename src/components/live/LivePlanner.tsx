'use client';

import Link from 'next/link';
import { RunScreen } from '@/components/run/RunScreen';
import type { RunTab } from '@/components/run/types';
import type { RunExtras, RunState } from '@/shared/types';
import { BriefForm } from './BriefForm';
import { useLiveRun } from './useLiveRun';

interface Props {
  /** A saved run or preset to open; without one the page starts at the brief form. */
  initial?: RunState | null;
  initialExtras?: RunExtras | null;
  initialTab?: RunTab | null;
  /** Prefills the brief form with a sample brief. */
  initialSlug?: string | null;
  /** False when the deployment has only synthetic data, where "Run live" would just make another sample. */
  liveAvailable: boolean;
}

/** The brief form, then the live run screen: one component for /plan/new, saved runs and presets. */
export function LivePlanner({ initial = null, initialExtras = null, initialTab = null, initialSlug = null, liveAvailable }: Props) {
  const { view, error, busy, start, answer } = useLiveRun(initial);
  const state = view.state;
  const extras = view.extras ?? (state && state.id === initial?.id ? initialExtras : null);

  if (!state && !busy) {
    return (
      <section className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
        <p className="font-mono text-xs tracking-[0.14em] text-muted uppercase">01 · Brief</p>
        <h1 className="mt-2 font-display text-5xl leading-[0.95] font-bold uppercase sm:text-6xl">Plan a campaign</h1>
        <p className="mt-4 max-w-2xl text-lg text-muted">
          Tell Stoop about the business. In about a minute it finds the New York street screens where your kind of customers
          already are, writes an ad for each neighborhood and drafts the booking. You review everything before anything is sent.
        </p>
        {error && error.details.length === 0 ? (
          <p role="alert" className="mt-6 border-l-4 border-danger bg-surface p-3">
            {error.message}{' '}
            <Link href="/p/halfnote" className="underline underline-offset-4">
              Open a recorded plan
            </Link>
          </p>
        ) : null}
        <div className="mt-8">
          <BriefForm
            busy={busy}
            serverErrors={error?.details ?? []}
            onSubmit={(brief, slug) => {
              window.scrollTo({ top: 0 });
              void start(brief, slug);
            }}
            initialSlug={initialSlug}
          />
        </div>
      </section>
    );
  }

  const kind = state?.label?.kind;
  const rerun = state
    ? () => {
        window.scrollTo({ top: 0 });
        void start(state.brief, state.presetSlug);
      }
    : undefined;
  return (
    <RunScreen
      key={state?.id ?? 'starting'}
      view={view}
      busy={busy}
      onAnswer={answer}
      places={extras?.places}
      send={extras?.send ?? null}
      initialTab={initialTab}
      onRunLive={liveAvailable && !busy && (kind === 'recorded' || kind === 'synthetic') ? rerun : undefined}
      onRetry={state?.status === 'error' ? rerun : undefined}
      recordedHref={`/p/${view.fallback?.presetSlug ?? state?.presetSlug ?? 'halfnote'}`}
    />
  );
}
