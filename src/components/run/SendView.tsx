'use client';

import { ArrowRight, Check, Copy, Download, Mail, Printer } from 'lucide-react';
import { useId, useState } from 'react';
import type { RunState } from '@/shared/types';
import { buttonClass } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { approvalKey, type AdHref } from './WhatView';
import { STATION_LABEL, ntaShort, planNeighborhoods } from './model';
import type { RunTab, SendDraft } from './types';

export interface SendViewProps {
  state: RunState;
  /** Booking email and exports drafted on the server; null while unavailable. */
  draft: SendDraft | null;
  approvals: Record<string, boolean>;
  /** Views the owner has opened in this session (drives the checklist). */
  visited: Partial<Record<RunTab, boolean>>;
  onGoTo: (tab: RunTab) => void;
  /** Print-ready PNG link per approved ad; hidden when null. */
  adHref?: AdHref;
  className?: string;
}

/** Splits `mailto:to@x?subject=…` into its recipient. */
function recipientOf(mailto: string): string {
  const raw = mailto.replace(/^mailto:/i, '').split('?')[0] ?? '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function buildMailto(to: string, subject: string, body: string): string {
  return `mailto:${encodeURIComponent(to).replace(/%40/g, '@').replace(/%2C/gi, ',')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function CheckItem({ done, title, detail, action }: { done: boolean; title: string; detail?: string; action?: React.ReactNode }) {
  return (
    <li className="flex gap-3 py-3">
      <span
        aria-hidden="true"
        className={cx('mt-0.5 grid size-6 shrink-0 place-items-center border-2', done ? 'border-ok bg-ok text-[#0e0f11]' : 'border-border')}
      >
        {done ? <Check className="size-4" strokeWidth={3} /> : null}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">
          <span className="sr-only">{done ? 'Done: ' : 'To do: '}</span>
          {title}
        </p>
        {detail ? <p className="text-sm text-muted">{detail}</p> : null}
        {action ? <div className="mt-1">{action}</div> : null}
      </div>
    </li>
  );
}

const linkBtn = 'inline-flex min-h-8 items-center gap-1 font-display text-sm font-bold tracking-[0.06em] text-link uppercase underline-offset-4 hover:underline';

/**
 * SEND: a pre-flight checklist and the booking email the owner edits and sends from their own email
 * app. Nothing leaves without the owner: the send and copy buttons unlock only after they confirm.
 */
export function SendView({ state, draft, approvals, visited, onGoTo, adHref = null, className }: SendViewProps) {
  const id = useId();
  const [subject, setSubject] = useState(draft?.subject ?? '');
  const [body, setBody] = useState(draft?.body ?? '');
  const [confirmed, setConfirmed] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [sent, setSent] = useState(false);
  const [copied, setCopied] = useState(false);

  const codes = planNeighborhoods(state).filter((c) => state.creative.some((s) => s.nta === c));
  const approvedNtas = codes.filter((c) => approvals[approvalKey(c, 'A')] || approvals[approvalKey(c, 'B')]);
  const approvedCount = Object.values(approvals).filter(Boolean).length;
  const approvedAds = codes.flatMap((c) =>
    (['A', 'B'] as const).filter((v) => approvals[approvalKey(c, v)]).map((v) => ({ nta: c, variant: v })),
  );
  const to = draft ? recipientOf(draft.mailto) : '';
  const mailto = buildMailto(to, subject, body);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${to ? `To: ${to}\n` : ''}Subject: ${subject}\n\n${body}`);
      setCopied(true);
      setSent(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section aria-labelledby="send-title" className={cx('flex flex-col gap-8', className)}>
      <header className="max-w-3xl">
        <p className="font-mono text-xs tracking-[0.14em] text-muted uppercase">07 · Send</p>
        <h2 id="send-title" className="mt-1 font-display text-[40px] leading-[0.95] font-bold uppercase sm:text-[64px] sm:leading-[0.9]">
          Stoop drafts.
          <span className="block text-amber">You send.</span>
        </h2>
        <p className="mt-3 text-lg text-muted">
          The booking package for {state.brief.business}: screen list, approved ads and an email to the seller. Edit anything.
        </p>
      </header>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          <section aria-labelledby={`${id}-check`}>
            <h3 id={`${id}-check`} className="font-display text-sm font-bold tracking-[0.12em] text-muted uppercase">
              Before you send
            </h3>
            <ul className="mt-2 divide-y-2 divide-surface-2 border-y-2 border-surface-2">
              <CheckItem
                done={Boolean(visited.where)}
                title="Review the neighborhoods"
                detail="Where the taste over-indexes, and why."
                action={
                  <button type="button" className={linkBtn} onClick={() => onGoTo('where')}>
                    Open {STATION_LABEL.where} <ArrowRight aria-hidden="true" className="size-4" />
                  </button>
                }
              />
              <CheckItem
                done={codes.length > 0 && approvedNtas.length === codes.length}
                title="Approve an ad for each neighborhood"
                detail={`${approvedNtas.length} of ${codes.length} neighborhoods · ${approvedCount} ad${approvedCount === 1 ? '' : 's'} approved${
                  codes.length && approvedNtas.length < codes.length
                    ? ` · missing ${codes
                        .filter((c) => !approvedNtas.includes(c))
                        .map((c) => ntaShort(state, c))
                        .join(', ')}`
                    : ''
                }`}
                action={
                  <button type="button" className={linkBtn} onClick={() => onGoTo('what')}>
                    Open {STATION_LABEL.what} <ArrowRight aria-hidden="true" className="size-4" />
                  </button>
                }
              />
              <CheckItem
                done={Boolean(visited.plan)}
                title="Check the assumptions"
                detail="Prices and impressions are estimates. Confirm them with the seller."
                action={
                  <button type="button" className={linkBtn} onClick={() => onGoTo('plan')}>
                    Open {STATION_LABEL.plan} <ArrowRight aria-hidden="true" className="size-4" />
                  </button>
                }
              />
              <CheckItem done={downloaded} title="Download the screen list" detail="CSV with addresses and the assumptions in the header." />
              <CheckItem done={sent} title="Send the email yourself" detail="From your own email app, to the seller you choose." />
            </ul>
          </section>

          <section aria-labelledby={`${id}-dl`} className="flex flex-col gap-2">
            <h3 id={`${id}-dl`} className="font-display text-sm font-bold tracking-[0.12em] text-muted uppercase">
              Downloads
            </h3>
            {draft?.csvHref ? (
              <a href={draft.csvHref} download onClick={() => setDownloaded(true)} className={buttonClass('secondary', 'md')}>
                <Download aria-hidden="true" className="size-4" />
                Screen list (CSV)
              </a>
            ) : (
              <p className="text-sm text-muted">The screen list appears when exports are available for this plan.</p>
            )}
            {adHref ? (
              approvedAds.length ? (
                <ul aria-label="Approved ads, print-ready" className="flex flex-col gap-2">
                  {approvedAds.map((a) => (
                    <li key={`${a.nta}:${a.variant}`}>
                      <a href={adHref(a.nta, a.variant)} download className={buttonClass('outline', 'md', 'w-full')}>
                        <Download aria-hidden="true" className="size-4" />
                        <span className="truncate">
                          Ad {a.variant} · {ntaShort(state, a.nta)}
                        </span>
                        <span className="ml-auto font-sans text-xs font-normal tracking-normal normal-case">PNG, 1080×1920</span>
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">Approve ads on WHAT and their print-ready PNGs (1080×1920) appear here.</p>
              )
            ) : null}
            <button type="button" onClick={() => window.print()} className={buttonClass('outline', 'md')}>
              <Printer aria-hidden="true" className="size-4" />
              Print or save as PDF
            </button>
          </section>
        </div>

        <section aria-labelledby={`${id}-mail`} className="flex flex-col gap-4 border-2 border-surface-2 bg-surface p-4 sm:p-6">
          <h3 id={`${id}-mail`} className="font-display text-[28px] leading-none font-bold uppercase">
            Booking email
          </h3>
          {draft ? (
            <>
              <p className="text-sm text-muted">
                To:{' '}
                {to ? <span className="font-mono text-text">{to}</span> : <span className="italic">add the seller’s address in your email app</span>}
              </p>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${id}-subject`} className="font-mono text-xs tracking-[0.14em] text-muted uppercase">
                  Subject
                </label>
                <input
                  id={`${id}-subject`}
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="h-11 w-full border-2 border-border bg-bg px-3 text-base focus:border-amber focus:outline-none"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${id}-body`} className="font-mono text-xs tracking-[0.14em] text-muted uppercase">
                  Message
                </label>
                <textarea
                  id={`${id}-body`}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={16}
                  className="w-full resize-y border-2 border-border bg-bg px-3 py-2 font-mono text-sm leading-relaxed focus:border-amber focus:outline-none"
                />
              </div>
              <label className="flex cursor-pointer items-start gap-3 border-2 border-surface-2 p-3 has-[:checked]:border-ok has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus)]">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className="mt-1 size-5 shrink-0 accent-[var(--ok)]"
                />
                <span>
                  <span className="font-semibold">I checked the screens, the ads and the assumptions.</span>
                  <span className="block text-sm text-muted">Required before the email opens. Nothing is sent until you press send in your own app.</span>
                </span>
              </label>
              <div className="flex flex-wrap gap-3">
                {confirmed ? (
                  <a href={mailto} onClick={() => setSent(true)} className={buttonClass('primary', 'lg')}>
                    <Mail aria-hidden="true" className="size-5" />
                    Open in my email app
                  </a>
                ) : (
                  <button type="button" disabled className={buttonClass('primary', 'lg')}>
                    <Mail aria-hidden="true" className="size-5" />
                    Open in my email app
                  </button>
                )}
                <button type="button" disabled={!confirmed} onClick={copy} className={buttonClass('secondary', 'lg')}>
                  {copied ? <Check aria-hidden="true" className="size-5" /> : <Copy aria-hidden="true" className="size-5" />}
                  {copied ? 'Copied' : 'Copy email'}
                </button>
              </div>
            </>
          ) : (
            <p className="text-muted">The booking email is drafted when the plan is ready.</p>
          )}
        </section>
      </div>

      <p className="border-y-2 border-surface-2 py-5 text-center font-display text-[28px] leading-tight font-bold tracking-[0.04em] uppercase sm:text-[40px]">
        Stoop never sends or buys anything.
      </p>
    </section>
  );
}
