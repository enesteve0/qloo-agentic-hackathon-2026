'use client';

import { Check, Copy, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { RunView } from '@/shared/stream';
import type { StageEnvelope, StageOperation } from '@/shared/types';
import { Segmented } from '@/components/ui/Segmented';
import { cx } from '@/components/ui/cx';
import { AgentTicker } from './AgentTicker';
import { ProvenanceBadge } from './ProvenanceBadge';
import { OPERATION_LABEL, badgeForLabel, fmtMs } from './model';
import type { DrawerTab } from './types';

export interface ProvenanceDrawerProps {
  open: boolean;
  onClose: () => void;
  view: RunView;
  tab: DrawerTab;
  onTabChange: (tab: DrawerTab) => void;
  /** Scroll to this envelope when the drawer opens on the requests tab. */
  focusOperation?: StageOperation | null;
}

/** Everything a reviewer needs to reproduce the run's Qloo usage; envelopes are already redacted on the server. */
export function redactedTrace(view: RunView): string {
  const s = view.state;
  return JSON.stringify(
    {
      run: s ? { id: s.id, mode: s.mode, status: s.status, label: s.label, createdAt: s.createdAt, qlooCalls: s.qlooCalls, llm: s.llm } : null,
      stages: s?.stages ?? [],
      decisions: s?.decisions ?? [],
      envelopes: s?.envelopes ?? [],
    },
    null,
    2,
  );
}

function Envelope({ env, highlight }: { env: StageEnvelope; highlight: boolean }) {
  return (
    <article
      id={`env-${env.operation}`}
      aria-labelledby={`env-${env.operation}-h`}
      className={cx('flex flex-col gap-3 border-2 bg-surface p-4', highlight ? 'border-amber' : 'border-surface-2')}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={`env-${env.operation}-h`} className="font-display text-xl leading-none font-bold tracking-[0.04em] uppercase">
          {OPERATION_LABEL[env.operation]}
        </h3>
        <span className="font-mono text-xs text-muted">
          {env.status} · {env.provenance.requests.length} request{env.provenance.requests.length === 1 ? '' : 's'} · {fmtMs(env.execution.duration_ms)}
        </span>
      </header>
      <p className="text-sm">{env.interpretation}</p>
      <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
        <dt className="font-mono tracking-[0.08em] text-muted uppercase">Source</dt>
        <dd>{env.provenance.source}</dd>
        <dt className="font-mono tracking-[0.08em] text-muted uppercase">Transport</dt>
        <dd className="font-mono">
          {env.execution.transport} · {env.execution.correlation_id}
        </dd>
        <dt className="font-mono tracking-[0.08em] text-muted uppercase">Job</dt>
        <dd>{env.query_intent.job}</dd>
        {env.query_intent.assumptions.length ? (
          <>
            <dt className="font-mono tracking-[0.08em] text-muted uppercase">Assumes</dt>
            <dd>{env.query_intent.assumptions.join('; ')}</dd>
          </>
        ) : null}
        <dt className="font-mono tracking-[0.08em] text-muted uppercase">Supports</dt>
        <dd>{env.what_this_supports}</dd>
      </dl>
      {env.warnings.length ? (
        <ul className="flex flex-col gap-1 text-sm text-amber-text">
          {env.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
      <ol className="flex flex-col divide-y-2 divide-surface-2 border-t-2 border-surface-2">
        {env.provenance.requests.map((r, k) => (
          <li key={k} className="flex flex-col gap-1 py-2">
            <p className="flex flex-wrap items-baseline gap-x-2 font-mono text-xs">
              <span className="font-semibold">{r.method}</span>
              <span>{r.path}</span>
              <span className={cx('ml-auto', r.status === 200 ? 'text-ok' : 'text-danger')}>{r.status ?? 'no response'}</span>
              <span className={cx('border px-1', r.cache === 'hit' ? 'border-link text-link' : 'border-surface-2 text-muted')}>
                cache {r.cache}
              </span>
              <span className="text-muted">{fmtMs(r.ms)}</span>
            </p>
            <p className="font-mono text-[11px] leading-relaxed break-all text-muted">{r.query}</p>
            <p className="font-mono text-xs tracking-[0.1em] text-muted uppercase">
              {r.purpose} · attempt {r.attempt}
            </p>
          </li>
        ))}
      </ol>
    </article>
  );
}

/**
 * The agent log and redacted Qloo request trace, in a modal dialog: a side drawer on wide screens and
 * a bottom sheet on phones. Escape, the close button and a backdrop click all close it.
 */
export function ProvenanceDrawer({ open, onClose, view, tab, onTabChange, focusOperation }: ProvenanceDrawerProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState(false);
  const envelopes = view.state?.envelopes ?? [];
  const requestCount = envelopes.reduce((a, e) => a + e.provenance.requests.length, 0);
  const badge = badgeForLabel(view.state?.label ?? null, view.state?.mode);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      // Start on the close button rather than the first control (a label whose tip would cover the tabs).
      closeRef.current?.focus();
    }
    if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => {
    if (!open || tab !== 'requests' || !focusOperation) return;
    const el = ref.current?.querySelector(`#env-${focusOperation}`);
    el?.scrollIntoView({ block: 'start' });
  }, [open, tab, focusOperation]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(redactedTrace(view));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby="drawer-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className={cx(
        'fixed m-0 max-h-none max-w-none border-border bg-bg p-0 text-text backdrop:bg-[rgba(5,6,8,0.72)]',
        'inset-x-0 top-auto bottom-0 h-[88dvh] w-full border-t-2 open:motion-safe:sheet-up',
        'sm:inset-y-0 sm:right-0 sm:left-auto sm:h-dvh sm:w-[min(40rem,100vw)] sm:border-t-0 sm:border-l-2 sm:open:motion-safe:drawer-in',
      )}
    >
      <div className="flex h-full flex-col">
        <header className="flex flex-col gap-3 border-b-2 border-surface-2 p-4">
          <div aria-hidden="true" className="mx-auto h-1 w-10 bg-surface-2 sm:hidden" />
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <h2 id="drawer-title" className="font-display text-[28px] leading-none font-bold uppercase">
                Agent log
              </h2>
              {badge ? <ProvenanceBadge kind={badge.kind} detail={badge.detail} /> : null}
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Close the agent log"
              className="grid size-10 shrink-0 place-items-center border-2 border-surface-2 hover:border-text"
            >
              <X aria-hidden="true" className="size-5" />
            </button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Segmented
              label="Log section"
              value={tab}
              onChange={onTabChange}
              options={[
                { value: 'log', label: 'Steps' },
                { value: 'requests', label: `Qloo requests · ${requestCount}` },
              ]}
            />
            <button
              type="button"
              onClick={copy}
              className="inline-flex h-9 items-center gap-2 border-2 border-text px-3 font-display text-sm font-bold tracking-[0.06em] uppercase hover:bg-surface-2"
            >
              {copied ? <Check aria-hidden="true" className="size-4" /> : <Copy aria-hidden="true" className="size-4" />}
              {copied ? 'Copied' : 'Copy redacted trace'}
            </button>
          </div>
        </header>
        {/* Focusable, so the log scrolls from the keyboard even when it holds no links or buttons. */}
        <div
          tabIndex={0}
          role="region"
          aria-label={tab === 'log' ? 'Agent steps' : 'Qloo requests'}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 focus-visible:-outline-offset-2!"
        >
          {tab === 'log' ? (
            <AgentTicker view={view} />
          ) : envelopes.length ? (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted">
                Every Qloo request this run made, with keys removed and neighborhood polygons replaced by labels such as POLYGON(NTA
                BK0301).
              </p>
              {envelopes.map((env) => (
                <Envelope key={env.operation} env={env} highlight={env.operation === focusOperation} />
              ))}
            </div>
          ) : (
            <p className="text-muted">No Qloo requests yet. They appear here as the agent makes them.</p>
          )}
        </div>
      </div>
    </dialog>
  );
}
