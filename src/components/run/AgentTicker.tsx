'use client';

import { ScrollText } from 'lucide-react';
import type { RunView } from '@/shared/stream';
import type { StageId, StageInfo, StageStatus } from '@/shared/types';
import { cx } from '@/components/ui/cx';
import { STAGE_ORDER, STAGE_STATION, STATION_LABEL, fmtMs, tickerHeadline } from './model';

export interface AgentTickerProps {
  view: RunView;
  /** `panel`: LED sign plus the trip log (desktop column). `line`: one status line (mobile). */
  variant?: 'panel' | 'line';
  onOpenLog?: () => void;
  className?: string;
}

const STAGE_STATUS_TEXT: Record<StageStatus, string> = {
  pending: 'Next',
  running: 'Now',
  done: 'Done',
  skipped: 'Skipped',
  needs_input: 'Needs you',
  degraded: 'Fell back',
  error: 'Stopped',
};

function StopMarker({ status }: { status: StageStatus }) {
  const base = 'relative z-10 mt-[3px] size-3 shrink-0';
  if (status === 'done' || status === 'skipped') return <span aria-hidden="true" className={cx(base, 'bg-text')} />;
  if (status === 'running') return <span aria-hidden="true" className={cx(base, 'bg-amber motion-safe:led-pulse')} />;
  if (status === 'needs_input' || status === 'degraded') return <span aria-hidden="true" className={cx(base, 'bg-amber')} />;
  if (status === 'error') return <span aria-hidden="true" className={cx(base, 'bg-danger')} />;
  return <span aria-hidden="true" className={cx(base, 'border-2 border-border bg-bg')} />;
}

function counts(view: RunView): string | null {
  const s = view.state;
  if (!s) return null;
  const q = s.qlooCalls.fresh + s.qlooCalls.cached;
  const synthetic = s.label?.kind === 'synthetic' || s.mode === 'mock';
  const parts = [`${q} ${synthetic ? 'synthetic ' : ''}Qloo call${q === 1 ? '' : 's'}`];
  if (s.qlooCalls.cached) parts.push(`${s.qlooCalls.cached} cached`);
  if (s.llm.attempts) parts.push(`${s.llm.attempts} AI call${s.llm.attempts === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

/**
 * The agent's countdown-clock sign: what it is doing now, in amber LED caps, plus the trip log of
 * stages, decisions and model attempts. Purely visual updates; RunScreen owns the single polite
 * live region that announces station changes.
 */
export function AgentTicker({ view, variant = 'panel', onOpenLog, className }: AgentTickerProps) {
  const state = view.state;
  const head = tickerHeadline(state, view.progress);
  const working = state?.status === 'running';

  if (variant === 'line') {
    return (
      <div className={cx('led-panel flex min-h-12 items-center gap-3 border-y-2 border-[#1d1f23] px-4', className)}>
        <span
          aria-hidden="true"
          className={cx('size-2.5 shrink-0', head.tone === 'danger' ? 'bg-danger' : 'bg-amber', working && 'motion-safe:led-pulse')}
        />
        <p
          key={head.text}
          className={cx(
            'led-glow min-w-0 flex-1 truncate font-display text-base font-bold tracking-[0.08em] text-[#ffb547] uppercase motion-safe:ticker-roll',
            head.tone === 'danger' && 'text-[#ff6b5e]',
          )}
        >
          {head.text}
        </p>
        {onOpenLog ? (
          <button
            type="button"
            onClick={onOpenLog}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 border-2 border-[#6b7078] px-2 font-display text-sm font-bold tracking-[0.06em] text-[#f2f0ea] uppercase hover:border-[#ffb547]"
          >
            <ScrollText aria-hidden="true" className="size-4" />
            Log
          </button>
        ) : null}
      </div>
    );
  }

  const byStage = new Map<StageId, StageInfo>((state?.stages ?? []).map((s) => [s.stage, s]));
  const decisions = state?.decisions ?? [];
  const attempts = view.attempts;

  return (
    <section aria-label="Agent" className={cx('flex flex-col', className)}>
      <div className="led-panel overflow-hidden border-2 border-[#1d1f23] p-4">
        <p className="flex items-center gap-2 font-mono text-[11px] tracking-[0.14em] text-[#d9a24a] uppercase">
          <span
            aria-hidden="true"
            className={cx('size-2 shrink-0', head.tone === 'danger' ? 'bg-[#ff6b5e]' : 'bg-[#ffb547]', working && 'motion-safe:led-pulse')}
          />
          Agent · {working ? 'working' : state?.status === 'awaiting_input' ? 'waiting for you' : state?.status === 'error' ? 'stopped' : 'done'}
        </p>
        <p
          key={head.text}
          className={cx(
            'led-glow mt-3 font-display text-[28px] leading-[1.04] font-bold tracking-[0.05em] text-[#ffb547] uppercase motion-safe:ticker-roll',
            head.tone === 'danger' && 'text-[#ff6b5e]',
          )}
        >
          {head.text}
        </p>
        {counts(view) ? (
          <p className="mt-3 border-t border-[#2b2418] pt-2 font-mono text-[11px] leading-relaxed tracking-[0.08em] text-[#d9a24a] uppercase">
            {counts(view)}
          </p>
        ) : null}
      </div>

      <div className="mt-6 flex items-center justify-between gap-3">
        <h2 className="font-display text-sm font-bold tracking-[0.12em] text-muted uppercase">Trip log</h2>
        {onOpenLog ? (
          <button
            type="button"
            onClick={onOpenLog}
            className="inline-flex min-h-8 items-center gap-1.5 font-display text-sm font-bold tracking-[0.06em] text-link uppercase underline-offset-4 hover:underline"
          >
            <ScrollText aria-hidden="true" className="size-4" />
            Full agent log
          </button>
        ) : null}
      </div>

      <ol className="relative mt-3 flex flex-col gap-4 before:absolute before:top-2 before:bottom-2 before:left-[5px] before:w-0.5 before:bg-surface-2">
        {STAGE_ORDER.map((id) => {
          const stage = byStage.get(id);
          const status: StageStatus = stage?.status ?? 'pending';
          const lines = decisions.filter((d) => d.stage === id).map((d) => d.text);
          const tries = attempts.filter((a) => (a.kind === 'planner' ? 'plan' : 'creative') === id);
          return (
            <li key={id} className={cx('flex gap-3', status === 'pending' && 'text-muted')}>
              <StopMarker status={status} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-[15px] leading-snug font-semibold">
                    <span className="sr-only">{`${STAGE_STATUS_TEXT[status]}: `}</span>
                    {stage?.title ?? defaultTitle(id)}
                  </p>
                  <span className="shrink-0 font-mono text-[11px] text-muted">
                    {status === 'done' || status === 'degraded' ? fmtMs(stage?.ms ?? null) : STAGE_STATUS_TEXT[status]}
                  </span>
                </div>
                <p className="font-mono text-[10px] tracking-[0.14em] text-muted uppercase">{STATION_LABEL[STAGE_STATION[id]]}</p>
                {stage?.detail && status !== 'pending' ? (
                  <p className={cx('mt-1 text-sm leading-snug', status === 'error' ? 'text-danger' : status === 'degraded' ? 'text-amber-text' : 'text-muted')}>
                    {stage.detail}
                  </p>
                ) : null}
                {lines.length ? (
                  <ul className="mt-1.5 flex flex-col gap-1.5">
                    {lines.map((t, k) => (
                      <li key={k} className="border-l-2 border-surface-2 pl-2.5 text-sm leading-snug text-text/90">
                        {t}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {tries.length ? (
                  <ul className="mt-1.5 flex flex-col gap-1">
                    {tries.map((a, k) => (
                      <li key={k} className="font-mono text-[11px] text-muted">
                        {a.slot} · {a.ok ? 'ok' : `failed${a.reason ? `: ${a.reason}` : ''}`} · {fmtMs(a.ms)}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function defaultTitle(id: StageId): string {
  const titles: Record<StageId, string> = {
    intake: 'Reading the brief',
    plan: 'Choosing taste anchors',
    resolve: 'Matching anchors in Qloo',
    where: 'Mapping where this taste over-indexes',
    evidence: 'Reading each neighborhood’s taste',
    creative: 'Writing the ads',
    optimize: 'Fitting the budget',
    proof: 'Comparing with an AI that has no Qloo',
    finalize: 'Plan ready',
  };
  return titles[id];
}
