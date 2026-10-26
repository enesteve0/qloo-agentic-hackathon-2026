'use client';

import { ArrowRight, Play, RotateCcw, ScrollText, TriangleAlert } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { RunView } from '@/shared/stream';
import type { PlannedScreen, ResolutionChoice, RunState, StageOperation } from '@/shared/types';
import { buttonClass } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { AgentTicker } from './AgentTicker';
import { AnchorList } from './AnchorList';
import { AnchorPicker } from './AnchorPicker';
import { PlanView } from './PlanView';
import { ProofView } from './ProofView';
import { ProvenanceBadge } from './ProvenanceBadge';
import { ProvenanceDrawer } from './ProvenanceDrawer';
import { SendView } from './SendView';
import { StationRail } from './StationRail';
import { WhatView, type AdHref } from './WhatView';
import { WhereView } from './WhereView';
import {
  STATION_BLURB,
  STATION_LABEL,
  badgeForLabel,
  currentStation,
  fmtDateRange,
  fmtUsd,
  stationStatuses,
  tabReady,
} from './model';
import { RUN_TABS, type DrawerTab, type PlaceLookup, type RunTab, type SendDraft } from './types';

export interface RunScreenProps {
  /** The run as folded by `applyPart` (live stream, saved run, recorded preset or synthetic demo). */
  view: RunView;
  /** Answer to the one "which one did you mean?" question. Without it the picker is read-only. */
  onAnswer?: (choices: ResolutionChoice[]) => void | Promise<void>;
  /** A request is in flight (e.g. resuming after an answer). */
  busy?: boolean;
  /** Redo this run with live Qloo and AI calls (shown for recorded, cached and synthetic runs). */
  onRunLive?: () => void;
  /** Retry after an error. */
  onRetry?: () => void;
  /** Street screens picked on the server (`placesForRun`); powers addresses and mockup street plates. */
  places?: PlaceLookup;
  /** Booking email and CSV link for SEND. */
  send?: SendDraft | null;
  /** The six best free LinkLocal screens (server-picked) for PLAN. */
  linkLocal?: PlannedScreen[] | null;
  /** Print-ready PNG link per ad. Defaults to `/api/ad?run=<id>&nta=…&v=…`; null hides the links (unsaved runs). */
  adHref?: AdHref;
  /** View to open first (`?view=`). */
  initialTab?: RunTab | null;
  /** Where "Open a recorded plan" goes from error and limit states. */
  recordedHref?: string;
  /** Optional notice above the canvas. */
  notice?: ReactNode;
  /** PLAN recalculation hooks (no server call implied). */
  onChangeBudget?: (usd: number) => void;
  onChangeWeeks?: (weeks: number) => void;
  recalculating?: boolean;
}

const FALLBACK_TITLE: Record<NonNullable<RunView['fallback']>['reason'], string> = {
  limits: 'Live runs are paused for now',
  qloo_reserve: 'Saving Qloo calls for judging',
  llm_exhausted: 'AI writers are busy',
  busy: 'Lots of people are planning right now',
  qloo_unavailable: 'Qloo isn’t answering',
  error: 'Something went wrong',
};

const NEXT_LABEL: Record<RunTab, string> = {
  where: 'See the map',
  what: 'See the ads',
  plan: 'See the plan',
  proof: 'See the proof',
  send: 'Get the booking email',
};

const PENDING: Record<RunTab, { title: string; lines: string[] }> = {
  where: {
    title: 'Mapping where this taste over-indexes',
    lines: ['Qloo heatmaps for each anchor, against the NYC baseline', 'Then 2,183 street screens scored', 'Then the ranked neighborhoods'],
  },
  what: {
    title: 'Reading each neighborhood’s taste',
    lines: ['Local Qloo evidence for the top neighborhoods', 'Then two ads each, checked against that evidence'],
  },
  plan: { title: 'Fitting the budget', lines: ['The strongest screens per dollar, by rules', 'No AI and no Qloo call in this step'] },
  proof: { title: 'Comparing with an AI that has no Qloo', lines: ['Same brief, same budget, same model', 'Scored on the same taste maps'] },
  send: { title: 'Drafting your booking package', lines: ['Checklist, screen list and an email you send yourself'] },
};

function Pending({ tab, progress }: { tab: RunTab; progress: string | null }) {
  const p = PENDING[tab];
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <div>
        <p className="font-mono text-xs tracking-[0.14em] text-amber-text uppercase">{STATION_LABEL[tab]} · working</p>
        <h2 className="mt-1 font-display text-[40px] leading-[0.95] font-bold uppercase">{p.title}</h2>
        {progress ? <p className="mt-3 text-lg text-muted">{progress}</p> : null}
      </div>
      <ol className="flex flex-col gap-2">
        {p.lines.map((l, k) => (
          <li key={l} className="flex items-center gap-3 text-muted">
            <span className="font-mono text-xs">{String(k + 1).padStart(2, '0')}</span>
            {l}
          </li>
        ))}
      </ol>
      <div aria-hidden="true" className="grid gap-0.5 border-2 border-surface-2 bg-surface-2 xl:grid-cols-[3fr_2fr]">
        <div className="led-panel grid h-[40vh] min-h-64 place-items-center">
          <p className="led-glow font-display text-xl font-bold tracking-[0.1em] uppercase motion-safe:led-pulse">Working</p>
        </div>
        <div className="flex flex-col gap-3 bg-bg p-4">
          {[0, 1, 2, 3].map((k) => (
            <div key={k} className="h-16 bg-surface motion-safe:animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  );
}

function Banner({ tone, title, children, action }: { tone: 'amber' | 'danger'; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div
      className={cx(
        'flex flex-wrap items-start gap-x-4 gap-y-2 border-2 border-l-8 bg-surface p-4',
        tone === 'amber' ? 'border-amber' : 'border-danger',
      )}
    >
      <TriangleAlert aria-hidden="true" className={cx('mt-0.5 size-5 shrink-0', tone === 'amber' ? 'text-amber-text' : 'text-danger')} />
      <div className="min-w-0 flex-1">
        <p className="font-display text-xl leading-tight font-bold tracking-[0.04em] uppercase">{title}</p>
        {children ? <div className="mt-1 text-muted">{children}</div> : null}
      </div>
      {action ? <div className="flex flex-wrap gap-2">{action}</div> : null}
    </div>
  );
}

function BriefPanel({ state }: { state: RunState }) {
  const b = state.brief;
  const range = fmtDateRange(b.startDate, b.weeks);
  const rows: [string, string | null][] = [
    ['Business', b.business],
    ['About', b.description || null],
    ['Offer', b.offer],
    ['Budget', b.budgetUsd ? `${fmtUsd(b.budgetUsd)} · ${b.weeks} week${b.weeks === 1 ? '' : 's'}` : null],
    ['Dates', range],
    ['Address', b.address],
  ];
  return (
    <section id="run-brief" aria-labelledby="run-brief-h" className="scroll-mt-4">
      <h2 id="run-brief-h" className="font-display text-sm font-bold tracking-[0.12em] text-muted uppercase">
        01 · Brief
      </h2>
      <dl className="mt-2 flex flex-col divide-y-2 divide-surface-2 border-y-2 border-surface-2">
        {rows
          .filter((r): r is [string, string] => Boolean(r[1]))
          .map(([k, v]) => (
            <div key={k} className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3 py-2 text-sm">
              <dt className="font-mono text-[10px] leading-5 tracking-[0.12em] text-muted uppercase">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
      </dl>
      <p className="mt-2 text-xs text-muted">The brief and address are never sent to Qloo.</p>
    </section>
  );
}

function TastePanel({ state }: { state: RunState }) {
  return (
    <section id="run-taste" aria-labelledby="run-taste-h" className="scroll-mt-4">
      <h2 id="run-taste-h" className="font-display text-sm font-bold tracking-[0.12em] text-muted uppercase">
        02 · Taste anchors
      </h2>
      {state.planner?.audienceSummary ? <p className="mt-2 text-sm text-muted">{state.planner.audienceSummary}</p> : null}
      {state.resolution ? (
        <AnchorList className="mt-3" outcomes={state.resolution.outcomes} maps={state.where?.anchors} />
      ) : state.planner ? (
        <ul className="mt-3 flex flex-col gap-1 text-sm">
          {state.planner.anchors.map((a) => (
            <li key={a.name}>
              {a.name} <span className="text-muted">· matching in Qloo…</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted">The agent proposes 2–5 anchors from your brief.</p>
      )}
    </section>
  );
}

/**
 * The run view: header with the label badge, the station rail, the agent's LED ticker and trip log
 * beside the canvas (WHERE · WHAT · PLAN · PROOF · SEND via `?view=`), the provenance drawer and every
 * state from PRODUCT §4: streaming, needs input, degraded, empty and error.
 */
export function RunScreen({
  view,
  onAnswer,
  busy = false,
  onRunLive,
  onRetry,
  places,
  send = null,
  linkLocal = null,
  adHref,
  initialTab,
  recordedHref = '/plan/demo',
  notice,
  onChangeBudget,
  onChangeWeeks,
  recalculating,
}: RunScreenProps) {
  const state = view.state;
  const statuses = stationStatuses(state);
  const available = Object.fromEntries(RUN_TABS.map((t) => [t, tabReady(state, t)])) as Record<RunTab, boolean>;
  const [tab, setTab] = useState<RunTab>(initialTab ?? 'where');
  const [visited, setVisited] = useState<Partial<Record<RunTab, boolean>>>({ [initialTab ?? 'where']: true });
  const [whatNta, setWhatNta] = useState<string | null>(null);
  const [approvals, setApprovals] = useState<Record<string, boolean>>({});
  const [drawer, setDrawer] = useState<{ open: boolean; tab: DrawerTab; op: StageOperation | null }>({ open: false, tab: 'log', op: null });

  // One polite announcement per station change (adjusting state during render, per the React docs).
  const station = currentStation(state);
  const [lastStation, setLastStation] = useState(station);
  const [announcement, setAnnouncement] = useState('');
  if (station !== lastStation) {
    setLastStation(station);
    setAnnouncement(`${STATION_LABEL[station]}: ${STATION_BLURB[station]}.`);
  }

  const selectTab = (next: RunTab) => {
    setTab(next);
    setVisited((v) => ({ ...v, [next]: true }));
    const url = new URL(window.location.href);
    url.searchParams.set('view', next);
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  };
  const goTo = (next: RunTab) => {
    selectTab(next);
    document.getElementById('run-canvas')?.scrollIntoView({ block: 'start' });
  };
  const openDrawer = (t: DrawerTab, op: StageOperation | null = null) => setDrawer({ open: true, tab: t, op });

  const badge = badgeForLabel(state?.label ?? null, state?.mode);
  const runId = state?.id ?? null;
  const adLink: AdHref =
    adHref === null || !runId
      ? null
      : (adHref ?? ((nta, v) => `/api/ad?run=${encodeURIComponent(runId)}&nta=${encodeURIComponent(nta)}&v=${v}`));
  const needsInput = state?.status === 'awaiting_input' && (view.needsInput?.length ?? 0) > 0;
  const errored = state?.status === 'error';
  const degraded = (state?.stages ?? []).filter((s) => s.status === 'degraded');
  const range = state ? fmtDateRange(state.brief.startDate, state.brief.weeks) : null;
  const degradedList = degraded.length ? (
    <ul className="mt-1 flex flex-col gap-1">
      {degraded.map((s) => (
        <li key={s.stage}>
          <span className="font-semibold text-text">{s.title}: </span>
          {s.detail ?? 'a labelled fallback was used.'}
        </li>
      ))}
    </ul>
  ) : null;
  const next = RUN_TABS.slice(RUN_TABS.indexOf(tab) + 1).find((t) => available[t]) ?? null;
  const kicker = !state
    ? 'Starting'
    : state.label?.kind === 'recorded'
      ? 'Recorded plan'
      : state.label?.kind === 'synthetic' || state.mode === 'mock'
        ? 'Sample plan'
        : 'Plan';

  let canvas: ReactNode;
  if (needsInput) {
    canvas = <AnchorPicker issues={view.needsInput ?? []} onSubmit={onAnswer ? (c) => void onAnswer(c) : undefined} submitting={busy} />;
  } else if (!state || !available[tab]) {
    canvas =
      errored || (state && state.status !== 'running') ? (
        <div className="flex flex-col gap-4">
          <p className="font-mono text-xs tracking-[0.14em] text-muted uppercase">{STATION_LABEL[tab]}</p>
          <h2 className="font-display text-[40px] leading-[0.95] font-bold uppercase">Nothing here for this run</h2>
          <p className="max-w-xl text-lg text-muted">
            {errored ? 'The run stopped before this station.' : 'This station has no results for this run.'}
          </p>
          <div className="flex flex-wrap gap-3">
            {RUN_TABS.filter((t) => available[t]).map((t) => (
              <button key={t} type="button" onClick={() => selectTab(t)} className={buttonClass('secondary', 'md')}>
                Open {STATION_LABEL[t]}
              </button>
            ))}
            {/* The error banner above already offers a recorded plan. */}
            {errored ? null : (
              <a href={recordedHref} className={buttonClass('outline', 'md')}>
                Open a recorded plan
              </a>
            )}
          </div>
        </div>
      ) : (
        <Pending tab={tab} progress={view.progress} />
      );
  } else if (state) {
    switch (tab) {
      case 'where':
        canvas = (
          <WhereView
            state={state}
            onOpenAds={(code) => {
              setWhatNta(code);
              goTo('what');
            }}
          />
        );
        break;
      case 'what':
        canvas = (
          <WhatView
            state={state}
            places={places}
            selectedNta={whatNta}
            onSelectNta={setWhatNta}
            approvals={approvals}
            onApprove={(key, on) => setApprovals((a) => ({ ...a, [key]: on }))}
            onOpenEvidence={() => openDrawer('requests', 'neighborhood_evidence')}
            adHref={adLink}
          />
        );
        break;
      case 'plan':
        canvas = (
          <PlanView
            state={state}
            places={places}
            linkLocal={linkLocal}
            onChangeBudget={onChangeBudget}
            onChangeWeeks={onChangeWeeks}
            recalculating={recalculating}
          />
        );
        break;
      case 'proof':
        canvas = <ProofView state={state} />;
        break;
      case 'send':
        canvas = (
          <SendView
            key={send ? `${send.subject}` : 'none'}
            state={state}
            draft={send}
            approvals={approvals}
            visited={visited}
            onGoTo={goTo}
            adHref={adLink}
          />
        );
        break;
    }
  }

  return (
    <div className="flex flex-col">
      <header className="asphalt border-b-2 border-surface-2">
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-4 pt-6 pb-4 sm:px-6 lg:px-8">
          <p className="font-mono text-xs tracking-[0.14em] text-muted uppercase">
            {kicker}
            {state ? <span className="normal-case"> · run {state.id}</span> : null}
          </p>
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
            <h1 className="min-w-0 font-display text-[40px] leading-[0.92] font-bold break-words uppercase sm:text-[64px]">
              {state?.brief.business || 'New plan'}
            </h1>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => openDrawer('log')} className={buttonClass('secondary', 'md')}>
                <ScrollText aria-hidden="true" className="size-4" />
                Agent log
              </button>
              {onRunLive ? (
                <button type="button" onClick={onRunLive} disabled={busy} className={buttonClass('primary', 'md')}>
                  <Play aria-hidden="true" className="size-4" />
                  Run live
                </button>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
            {badge ? <ProvenanceBadge kind={badge.kind} detail={badge.detail} /> : null}
            {state && state.brief.budgetUsd ? (
              <span className="font-mono text-text">
                {fmtUsd(state.brief.budgetUsd)} · {state.brief.weeks} week{state.brief.weeks === 1 ? '' : 's'}
                {range ? ` · ${range}` : ''}
              </span>
            ) : null}
            {state?.planner?.business.category ? <span>{state.planner.business.category}</span> : null}
            {state?.where?.config.experimental ? <span className="text-amber-text">Experimental lift method</span> : null}
          </div>
        </div>
        <div className="mx-auto w-full max-w-[1600px] px-4 pb-4 sm:px-6 lg:px-8">
          <StationRail
            statuses={statuses}
            current={needsInput ? null : tab}
            available={available}
            onSelect={selectTab}
            hrefFor={(t) => `?view=${t}`}
            anchorFor={{ brief: '#run-brief', taste: '#run-taste' }}
          />
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-[1600px] gap-8 px-4 py-6 sm:px-6 lg:grid-cols-[300px_minmax(0,1fr)] lg:gap-10 lg:px-8 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div id="run-canvas" className="flex min-w-0 scroll-mt-4 flex-col gap-5 lg:col-start-2 lg:row-start-1">
          <AgentTicker view={view} variant="line" onOpenLog={() => openDrawer('log')} className="-mx-4 sm:-mx-6 lg:hidden" />
          {view.fallback ? (
            <Banner
              tone={view.fallback.reason === 'error' ? 'danger' : 'amber'}
              title={FALLBACK_TITLE[view.fallback.reason]}
              action={
                view.fallback.presetSlug ? (
                  <a href={`/p/${view.fallback.presetSlug}`} className={buttonClass('secondary', 'sm')}>
                    Open the recorded plan
                  </a>
                ) : null
              }
            >
              <p>{view.fallback.message}</p>
              {degradedList}
            </Banner>
          ) : null}
          {errored ? (
            <Banner
              tone="danger"
              title="The run stopped"
              action={
                <>
                  {onRetry ? (
                    <button type="button" onClick={onRetry} className={buttonClass('secondary', 'sm')}>
                      <RotateCcw aria-hidden="true" className="size-4" />
                      Retry
                    </button>
                  ) : null}
                  <a href={recordedHref} className={buttonClass('outline', 'sm')}>
                    Open a recorded plan
                  </a>
                </>
              }
            >
              <p>{state?.error ?? 'Something went wrong while planning.'} Your brief is saved.</p>
            </Banner>
          ) : null}
          {degraded.length && !view.fallback ? (
            <Banner tone="amber" title="Some steps fell back">
              {degradedList}
              <p className="mt-1">Everything else in this plan still holds.</p>
            </Banner>
          ) : null}
          {notice}
          <div key={needsInput ? 'question' : tab} className="motion-safe:fade-in">
            {canvas}
          </div>
        </div>

        <aside
          aria-label="Agent, brief and taste anchors"
          className="flex min-w-0 flex-col gap-8 lg:sticky lg:top-4 lg:col-start-1 lg:row-start-1 lg:max-h-[calc(100dvh-2rem)] lg:self-start lg:overflow-y-auto lg:pr-2"
        >
          <AgentTicker view={view} onOpenLog={() => openDrawer('log')} className="hidden lg:flex" />
          {state ? <BriefPanel state={state} /> : null}
          {state ? <TastePanel state={state} /> : null}
        </aside>
      </div>

      {next && !needsInput ? (
        <div className="sticky-cta sticky bottom-0 z-20 border-t-2 border-surface-2 bg-bg px-4 py-3 lg:hidden">
          <button type="button" onClick={() => goTo(next)} className={buttonClass('primary', 'lg', 'w-full justify-between')}>
            <span className="truncate">{NEXT_LABEL[next]}</span>
            <ArrowRight aria-hidden="true" className="size-5" />
          </button>
        </div>
      ) : null}

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <ProvenanceDrawer
        open={drawer.open}
        onClose={() => setDrawer((d) => ({ ...d, open: false }))}
        view={view}
        tab={drawer.tab}
        onTabChange={(t) => setDrawer((d) => ({ ...d, tab: t }))}
        focusOperation={drawer.op}
      />
    </div>
  );
}
