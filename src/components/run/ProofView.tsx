'use client';

import { useState } from 'react';
import type { NtaScore, RunState } from '@/shared/types';
import { Segmented } from '@/components/ui/Segmented';
import { StreetPlate } from '@/components/ui/StreetPlate';
import { cx } from '@/components/ui/cx';
import { evidenceLabels, fmtCompact, fmtMultiplier, fmtPct, ntaMap, ordinal, planNeighborhoods } from './model';

export interface ProofViewProps {
  state: RunState;
  className?: string;
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    // Values line up across the row even when one label wraps.
    <div className="flex flex-col justify-between gap-1">
      <dt className="font-mono text-xs tracking-[0.14em] text-muted uppercase">{label}</dt>
      <dd className={cx('font-display text-[40px] leading-none font-bold tabular-nums', tone === 'bad' && 'text-amber-text')}>{value}</dd>
    </div>
  );
}

/**
 * PROOF: the same brief and budget planned twice by the same AI model, once without Qloo. Both are
 * scored on the run's taste maps, and the circularity of that is said out loud every time.
 */
export function ProofView({ state, className }: ProofViewProps) {
  const proof = state.proof;
  const [side, setSide] = useState<'llm' | 'stoop'>('stoop');
  if (!proof) return null;
  const ntas = ntaMap(state);

  if (!proof.available || !proof.llmOnly) {
    return (
      <section aria-labelledby="proof-title" className={cx('flex flex-col gap-4', className)}>
        <p className="font-mono text-xs tracking-[0.14em] text-muted uppercase">06 · Proof</p>
        <h2 id="proof-title" className="font-display text-[40px] leading-[0.95] font-bold uppercase">
          No side-by-side this time
        </h2>
        <p className="max-w-2xl text-lg text-muted">
          The AI-only comparison could not be computed for this run, so there is nothing honest to show here. The plan and its
          evidence still stand on their own.
        </p>
        <p className="max-w-2xl border-l-2 border-amber pl-3 text-sm text-muted">{proof.note}</p>
      </section>
    );
  }

  // "Same AI model" is only true when a model planned the run; rule fallbacks get their own words.
  const modelWrote = !state.planner?.fallback && state.llm.via.some((v) => v !== 'rules' && v !== 'template');
  const words = modelWrote
    ? {
        kicker: 'LLM only',
        title: 'The AI alone',
        blurb: 'Picked from the brief and general knowledge. No taste data.',
        listLabel: 'Neighborhoods the AI picked alone',
        oursTitle: 'The AI with Qloo',
        oursBlurb: 'Same model, same brief, plus Qloo taste maps and neighborhood evidence.',
        versus: 'Stoop vs AI alone',
        median: 'AI picks',
        missed: 'Missed by the AI alone',
      }
    : {
        kicker: 'Rules only',
        title: 'Busy-area picks',
        blurb: 'The AI writers were busy, so rules picked busy areas for this brief. No taste data.',
        listLabel: 'Neighborhoods picked by rules',
        oursTitle: 'Stoop with Qloo',
        oursBlurb: 'Same brief and budget, plus Qloo taste maps and neighborhood evidence.',
        versus: 'Stoop vs busy-area picks',
        median: 'Busy-area picks',
        missed: 'Missed by the busy-area picks',
      };
  const ourCodes = planNeighborhoods(state).slice(0, 5);
  const ours = (ourCodes.length >= 5 ? ourCodes : [...ourCodes, ...(state.where?.ntas ?? []).map((n) => n.code).filter((c) => !ourCodes.includes(c))]).slice(0, 5);
  const shared = new Set(proof.llmPicks.map((p) => p.nta).filter((c) => ours.includes(c)));
  const ratio = proof.llmOnly.tasteWeightedImpressions > 0 ? proof.ours.tasteWeightedImpressions / proof.llmOnly.tasteWeightedImpressions : null;
  const missed = proof.missedByLlm ? ntas.get(proof.missedByLlm.nta) : undefined;

  const pickRow = (code: string, n: NtaScore | undefined, extra: React.ReactNode) => (
    <li key={code} className="flex items-start gap-3 border-b-2 border-surface-2 py-3 last:border-b-0">
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <StreetPlate name={n?.short ?? code} size="xs" />
          {shared.has(code) ? (
            <span className="border-2 border-text px-1 font-mono text-xs leading-4 tracking-[0.1em] uppercase">in both</span>
          ) : null}
        </span>
        {extra}
      </span>
      <span className="shrink-0 text-right">
        <span className={cx('block font-display text-[28px] leading-none font-bold tabular-nums', n && n.multiplier < 1 && 'text-muted')}>
          {n ? fmtMultiplier(n.multiplier) : '—'}
        </span>
        <span className="font-mono text-xs tracking-[0.1em] text-muted uppercase">
          {n ? (n.multiplier < 1 ? 'below baseline' : `${ordinal(n.fitIndex)} pct`) : 'not scored'}
        </span>
      </span>
    </li>
  );

  const llmColumn = (
    <div className={cx('flex flex-col gap-5 border-2 border-surface-2 p-5', side !== 'llm' && 'max-lg:hidden')}>
      <header>
        <p className="font-display text-sm font-bold tracking-[0.14em] text-muted uppercase">{words.kicker}</p>
        <h3 className="mt-1 font-display text-[28px] leading-none font-bold uppercase">{words.title}</h3>
        <p className="mt-2 text-sm text-muted">{words.blurb}</p>
      </header>
      <dl className="grid grid-cols-2 gap-4 border-y-2 border-surface-2 py-4">
        <Metric label="Taste-weighted impr." value={fmtCompact(proof.llmOnly.tasteWeightedImpressions)} />
        <Metric label="Budget below baseline" value={fmtPct(proof.llmOnly.belowBaselineShare)} tone={proof.llmOnly.belowBaselineShare > 0 ? 'bad' : undefined} />
      </dl>
      <ol aria-label={words.listLabel}>
        {proof.llmPicks.map((p) =>
          pickRow(
            p.nta,
            ntas.get(p.nta),
            <span className="mt-1.5 block text-sm leading-snug text-muted">“{p.reason}”</span>,
          ),
        )}
      </ol>
    </div>
  );

  const stoopColumn = (
    <div className={cx('flex flex-col gap-5 border-2 border-sign p-5', side !== 'stoop' && 'max-lg:hidden')}>
      <header>
        <p className="font-display text-sm font-bold tracking-[0.14em] text-ok uppercase">Stoop</p>
        <h3 className="mt-1 font-display text-[28px] leading-none font-bold uppercase">{words.oursTitle}</h3>
        <p className="mt-2 text-sm text-muted">{words.oursBlurb}</p>
      </header>
      <dl className="grid grid-cols-2 gap-4 border-y-2 border-surface-2 py-4">
        <Metric label="Taste-weighted impr." value={fmtCompact(proof.ours.tasteWeightedImpressions)} />
        <Metric label="Budget below baseline" value={fmtPct(proof.ours.belowBaselineShare)} />
      </dl>
      <ol aria-label="Stoop’s top neighborhoods">
        {ours.map((code) => {
          const n = ntas.get(code);
          const pack = state.evidence.find((e) => e.nta === code);
          return pickRow(
            code,
            n,
            pack?.items.length ? (
              <span className="mt-1.5 block text-sm leading-snug text-muted">{evidenceLabels(pack, 3).join(' · ')}</span>
            ) : n ? (
              <span className="mt-1.5 block text-sm leading-snug text-muted">{n.name === n.short ? n.boro : n.name}</span>
            ) : null,
          );
        })}
      </ol>
    </div>
  );

  return (
    <section aria-labelledby="proof-title" className={cx('flex flex-col gap-6', className)}>
      <header className="max-w-4xl">
        <p className="font-mono text-xs tracking-[0.14em] text-muted uppercase">06 · Proof</p>
        <h2 id="proof-title" className="mt-1 font-display text-[40px] leading-[0.95] font-bold uppercase sm:text-[64px] sm:leading-[0.9]">
          {/* Each sentence wraps as a unit. */}
          {(modelWrote ? ['Same brief.', 'Same budget.', 'Same AI model.'] : ['Same brief.', 'Same budget.']).map((t) => (
            <span key={t} className="inline-block pr-[0.25em]">
              {t}
            </span>
          ))}
          <span className="block text-amber">One of them had Qloo.</span>
        </h2>
      </header>

      <div className="led-panel grid gap-px border-2 border-[#1d1f23] sm:grid-cols-3" role="group" aria-label="The difference">
        <div className="p-4">
          <p className="font-mono text-xs tracking-[0.14em] text-[#c98f38] uppercase">Taste-weighted impressions</p>
          <p className="led-glow mt-1 font-display text-[40px] leading-none font-bold">{ratio ? `${ratio.toFixed(1)}× more` : '—'}</p>
          <p className="mt-1 text-sm text-[#d9c39a]">with Qloo, same spend</p>
        </div>
        <div className="p-4">
          <p className="font-mono text-xs tracking-[0.14em] text-[#c98f38] uppercase">Budget in below-baseline areas</p>
          <p className="led-glow mt-1 font-display text-[40px] leading-none font-bold">
            {fmtPct(proof.ours.belowBaselineShare)} vs {fmtPct(proof.llmOnly.belowBaselineShare)}
          </p>
          <p className="mt-1 text-sm text-[#d9c39a]">{words.versus}</p>
        </div>
        <div className="p-4">
          <p className="font-mono text-xs tracking-[0.14em] text-[#c98f38] uppercase">Neighborhoods in common</p>
          <p className="led-glow mt-1 font-display text-[40px] leading-none font-bold">{proof.overlapAt5} of 5</p>
          <p className="mt-1 text-sm text-[#d9c39a]">
            {proof.medianLlmPercentile !== null ? `${words.median}: median ${ordinal(proof.medianLlmPercentile)} percentile` : 'top-five overlap'}
          </p>
        </div>
      </div>

      <Segmented
        label="Compare"
        block
        className="lg:hidden"
        value={side}
        onChange={setSide}
        options={[
          { value: 'llm', label: words.kicker },
          { value: 'stoop', label: 'Stoop' },
        ]}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        {llmColumn}
        {stoopColumn}
      </div>

      {proof.missedByLlm ? (
        <p className="max-w-3xl text-lg">
          <span className="font-semibold">{words.missed}: </span>
          {missed?.name ?? proof.missedByLlm.nta}
          {missed ? ` (${fmtMultiplier(missed.multiplier)})` : ''}
          {proof.missedByLlm.evidence.length ? <span className="text-muted">: {proof.missedByLlm.evidence.join(' · ')}.</span> : '.'}
        </p>
      ) : null}

      <aside aria-label="Circularity note" className="max-w-3xl border-2 border-amber p-4">
        <p className="font-display text-sm font-bold tracking-[0.12em] text-amber-text uppercase">Read this before you quote it</p>
        <p className="mt-2">{proof.note}</p>
        <p className="mt-2 text-sm text-muted">
          What the taste maps can and cannot tell you:{' '}
          <a href="/how-it-works#limits" className="underline underline-offset-4">
            How it works, limits
          </a>
          .
        </p>
      </aside>
    </section>
  );
}
