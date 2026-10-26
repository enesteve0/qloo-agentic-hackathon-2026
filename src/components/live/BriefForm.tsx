'use client';

import { useId, useState, type FormEvent } from 'react';
import { PRESETS } from '@/content/presets';
import type { Brief } from '@/shared/types';

interface Props {
  busy: boolean;
  /** Field problems reported by the server (already in plain language). */
  serverErrors: string[];
  onSubmit: (brief: Brief, presetSlug: string | null) => void;
  initialSlug?: string | null;
}

interface Draft {
  business: string;
  description: string;
  offer: string;
  budgetUsd: string;
  weeks: string;
  startDate: string;
  address: string;
}

const EMPTY: Draft = { business: '', description: '', offer: '', budgetUsd: '2000', weeks: '3', startDate: '', address: '' };

const fromBrief = (b: Brief): Draft => ({
  business: b.business,
  description: b.description,
  offer: b.offer ?? '',
  budgetUsd: String(b.budgetUsd),
  weeks: String(b.weeks),
  startDate: b.startDate ?? '',
  address: b.address ?? '',
});

const input =
  'w-full rounded-[3px] border-2 border-border bg-surface px-3 py-2 text-base text-text placeholder:text-muted/70 focus:border-amber focus:outline-none';
const label = 'font-display text-lg font-bold tracking-wide uppercase';
const hint = 'text-sm text-muted';

/** The brief: six questions a small-business owner can answer in a minute. Nothing here goes to Qloo. */
export function BriefForm({ busy, serverErrors, onSubmit, initialSlug = null }: Props) {
  const id = useId();
  const initial = initialSlug ? PRESETS.find((p) => p.slug === initialSlug) : undefined;
  const [draft, setDraft] = useState<Draft>(initial ? fromBrief(initial.brief) : EMPTY);
  const [slug, setSlug] = useState<string | null>(initial?.slug ?? null);
  const set = (key: keyof Draft) => (value: string) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setSlug(null); // an edited sample is a new brief
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    onSubmit(
      {
        business: draft.business.trim(),
        description: draft.description.trim(),
        offer: draft.offer.trim() || null,
        budgetUsd: Number(draft.budgetUsd),
        weeks: Number(draft.weeks),
        startDate: draft.startDate || null,
        address: draft.address.trim() || null,
      },
      slug,
    );
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-6" aria-describedby={`${id}-privacy`} noValidate={false}>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm text-muted">Fill in a sample brief</legend>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.slug}
              type="button"
              onClick={() => {
                setDraft(fromBrief(p.brief));
                setSlug(p.slug);
              }}
              aria-pressed={slug === p.slug}
              className="min-h-9 rounded-[3px] border-2 border-surface-2 px-3 py-1 text-left text-sm hover:border-amber aria-pressed:border-amber aria-pressed:text-amber"
            >
              {p.title}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-business`} className={label}>
          Business name
        </label>
        <input
          id={`${id}-business`}
          className={input}
          required
          minLength={2}
          maxLength={80}
          autoComplete="organization"
          value={draft.business}
          onChange={(e) => set('business')(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-description`} className={label}>
          What you do
        </label>
        <p id={`${id}-description-hint`} className={hint}>
          A sentence or two: what you sell, the vibe, who already loves it.
        </p>
        <textarea
          id={`${id}-description`}
          aria-describedby={`${id}-description-hint`}
          className={`${input} min-h-28`}
          required
          minLength={12}
          maxLength={600}
          value={draft.description}
          onChange={(e) => set('description')(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-offer`} className={label}>
          Offer <span className="font-sans text-sm font-normal tracking-normal text-muted normal-case">(optional)</span>
        </label>
        <input
          id={`${id}-offer`}
          className={input}
          maxLength={120}
          placeholder="Free first set on Tuesdays"
          value={draft.offer}
          onChange={(e) => set('offer')(e.target.value)}
        />
      </div>

      <div className="grid gap-6 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-budget`} className={label}>
            Budget (USD)
          </label>
          <input
            id={`${id}-budget`}
            className={input}
            type="number"
            inputMode="numeric"
            required
            min={100}
            max={100000}
            step={50}
            value={draft.budgetUsd}
            onChange={(e) => set('budgetUsd')(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-weeks`} className={label}>
            Weeks
          </label>
          <select id={`${id}-weeks`} className={input} value={draft.weeks} onChange={(e) => set('weeks')(e.target.value)}>
            {Array.from({ length: 8 }, (_, i) => String(i + 1)).map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-start`} className={label}>
            Start <span className="font-sans text-sm font-normal tracking-normal text-muted normal-case">(optional)</span>
          </label>
          <input
            id={`${id}-start`}
            className={input}
            type="date"
            value={draft.startDate}
            onChange={(e) => set('startDate')(e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-address`} className={label}>
          Where you are <span className="font-sans text-sm font-normal tracking-normal text-muted normal-case">(optional)</span>
        </label>
        <p id={`${id}-address-hint`} className={hint}>
          Cross streets are enough. Used only on your plan, never sent to Qloo.
        </p>
        <input
          id={`${id}-address`}
          aria-describedby={`${id}-address-hint`}
          className={input}
          maxLength={120}
          autoComplete="street-address"
          placeholder="Nostrand Av & Fulton St, Brooklyn"
          value={draft.address}
          onChange={(e) => set('address')(e.target.value)}
        />
      </div>

      {serverErrors.length > 0 && (
        <div role="alert" className="border-l-4 border-danger bg-surface p-3 text-sm">
          <p className="font-bold">Please check the brief:</p>
          <ul className="mt-1 list-disc pl-5">
            {serverErrors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-3 border-t-2 border-surface-2 pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p id={`${id}-privacy`} className={`${hint} max-w-md`}>
          Stoop sends Qloo taste anchors and neighborhood shapes, never your brief or anything about people. Emails,
          phone numbers and links are removed before any AI reads it.
        </p>
        <button
          type="submit"
          disabled={busy}
          className="sign-plate min-h-12 px-5 py-2 text-xl hover:brightness-110 disabled:cursor-wait disabled:opacity-60"
        >
          {busy ? 'Planning…' : 'Plan my campaign'}
        </button>
      </div>
    </form>
  );
}
