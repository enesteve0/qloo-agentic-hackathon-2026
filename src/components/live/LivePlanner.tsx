'use client';

import { TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { RunScreen } from '@/components/run/RunScreen';
import type { RunTab } from '@/components/run/types';
import { cx } from '@/components/ui/cx';
import type { RunExtras, RunState } from '@/shared/types';
import { BriefForm, type BriefField } from './BriefForm';
import { useLiveRun, type LiveRunError } from './useLiveRun';

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

const FIELD_LABEL: Record<BriefField, string> = {
  business: 'Business name',
  description: 'What you do',
  offer: 'Offer',
  budgetUsd: 'Budget',
  weeks: 'Weeks',
  startDate: 'Start date',
  address: 'Where you are',
};

/** "business: Tell us the business name" (the server's wording) → the form field and a readable line. */
function readProblem(detail: string): { field: BriefField | null; text: string } {
  const m = /^(\w+): (.+)$/.exec(detail);
  const field = m && m[1]! in FIELD_LABEL ? (m[1] as BriefField) : null;
  if (field) return { field, text: `${FIELD_LABEL[field]}: ${m![2]}` };
  return { field: null, text: m?.[1] === 'brief' ? m[2]! : detail };
}

/** Why the brief came back: a refusal, field problems or a failed request. Focused so it is seen and read. */
function BriefProblem({ error }: { error: LiveRunError }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, [error]);
  const refused = Boolean(error.restricted);
  const lines = error.details.map((d) => readProblem(d).text);
  const title = refused ? 'Stoop won’t plan this brief' : lines.length ? 'Please check the brief' : 'The plan didn’t start';
  return (
    <div
      ref={ref}
      role="alert"
      tabIndex={-1}
      className={cx('mt-8 flex scroll-mt-4 gap-3 border-2 border-l-8 bg-surface p-4', refused ? 'border-amber' : 'border-danger')}
    >
      <TriangleAlert aria-hidden="true" className={cx('mt-0.5 size-5 shrink-0', refused ? 'text-amber-text' : 'text-danger')} />
      <div className="min-w-0 flex-1">
        <p className="font-display text-xl leading-tight font-bold tracking-[0.04em] uppercase">{title}</p>
        {refused ? (
          <p className="mt-1 text-muted">
            <span className="text-text">{error.message}</span> Edit the brief, or see{' '}
            <Link href="/how-it-works#fairness" className="underline underline-offset-4">
              what Stoop will not plan, and why
            </Link>
            .
          </p>
        ) : lines.length ? (
          <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-muted marker:text-danger">
            {lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-muted">
            <span className="text-text">{error.message}</span>{' '}
            <Link href="/p/halfnote" className="underline underline-offset-4">
              Open a sample plan
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}

/** The brief form, then the live run screen: one component for /plan/new, saved runs and presets. */
export function LivePlanner({ initial = null, initialExtras = null, initialTab = null, initialSlug = null, liveAvailable }: Props) {
  const { view, error, busy, start, answer } = useLiveRun(initial);
  const state = view.state;
  const extras = view.extras ?? (state && state.id === initial?.id ? initialExtras : null);
  // From a form submit until the run exists, the form stays on screen (and keeps what was typed), so a
  // refused or invalid brief comes back intact.
  const [fromForm, setFromForm] = useState(false);

  // A run that starts on this page opens at the top (the form may have been scrolled to its end).
  const runId = state?.id ?? null;
  const shownRun = useRef(runId);
  useEffect(() => {
    if (!runId || runId === shownRun.current) return;
    shownRun.current = runId;
    window.scrollTo({ top: 0 });
  }, [runId]);

  if (!state && (!busy || fromForm)) {
    const invalid = new Set((error?.details ?? []).map((d) => readProblem(d).field).filter((f): f is BriefField => f !== null));
    return (
      <section className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
        <p className="font-mono text-xs tracking-[0.14em] text-muted uppercase">01 · Brief</p>
        <h1 className="mt-2 font-display text-5xl leading-[0.95] font-bold uppercase sm:text-6xl">Plan a campaign</h1>
        <p className="mt-4 max-w-2xl text-lg text-muted">
          Tell Stoop about the business. In about a minute it finds the New York street screens where your kind of customers
          already are, writes an ad for each neighborhood and drafts the booking. You review everything before anything is sent.
        </p>
        {error ? <BriefProblem error={error} /> : null}
        <div className="mt-8">
          <BriefForm
            busy={busy}
            invalid={invalid}
            onSubmit={(brief, slug) => {
              setFromForm(true);
              void start(brief, slug);
            }}
            initialSlug={initialSlug}
          />
        </div>
      </section>
    );
  }

  const kind = state?.label?.kind;
  // Problems after a run exists (a rejected answer, a lost connection) show above the run, not on a hidden form.
  const notice = error ? (
    <p role="alert" className="border-l-4 border-danger bg-surface p-3">
      {error.message}
    </p>
  ) : undefined;
  const rerun = state
    ? () => {
        setFromForm(false);
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
      linkLocal={extras?.linkLocal ?? null}
      initialTab={initialTab}
      onRunLive={liveAvailable && !busy && (kind === 'recorded' || kind === 'synthetic') ? rerun : undefined}
      onRetry={state?.status === 'error' ? rerun : undefined}
      recordedHref={`/p/${view.fallback?.presetSlug ?? state?.presetSlug ?? 'halfnote'}`}
      notice={notice}
    />
  );
}
