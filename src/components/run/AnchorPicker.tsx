'use client';

import { ArrowRight, Ban } from 'lucide-react';
import { useId, useState } from 'react';
import type { ResolutionChoice, ResolutionIssue } from '@/shared/types';
import { buttonClass } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { ENTITY_ICON } from './AnchorList';
import { ENTITY_LABEL } from './model';

const DROP = '__drop__';

export interface AnchorPickerProps {
  issues: ResolutionIssue[];
  /** Receives one choice per issue; `entityId: null` drops that anchor. Without it the picker is read-only. */
  onSubmit?: (choices: ResolutionChoice[]) => void;
  submitting?: boolean;
  className?: string;
}

/**
 * "Quick check: which one did you mean?" One question screen per run, enforced by the server. Each
 * ambiguous anchor is a fieldset of radio cards with the best match preselected, plus a drop option.
 */
export function AnchorPicker({ issues, onSubmit, submitting = false, className }: AnchorPickerProps) {
  const uid = useId();
  const [picked, setPicked] = useState<Record<string, string>>(() =>
    Object.fromEntries(issues.map((i) => [i.input, i.candidates[0]?.id ?? DROP])),
  );

  const submit = () => {
    onSubmit?.(issues.map((i) => ({ input: i.input, entityId: picked[i.input] === DROP ? null : (picked[i.input] ?? null) })));
  };

  return (
    <form
      className={cx('flex flex-col gap-8', className)}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex flex-col gap-2">
        <p className="font-mono text-xs tracking-[0.14em] text-amber-text uppercase">Taste · one question</p>
        <h2 className="font-display text-[40px] leading-[0.95] font-bold uppercase">Quick check: which one did you mean?</h2>
        <p className="max-w-2xl text-muted">
          Your answer changes the taste map, so the agent asks once and then finishes the plan on its own. Pick the closest
          match, or drop the anchor.
        </p>
      </div>

      {issues.map((issue, n) => {
        const Icon = ENTITY_ICON[issue.type];
        const name = `${uid}-issue-${n}`;
        const value = picked[issue.input] ?? DROP;
        return (
          <fieldset key={issue.input} className="flex flex-col gap-3">
            <legend className="mb-3 w-full">
              <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-display text-[28px] leading-none font-bold">{issue.question}</span>
                <span className="font-mono text-xs tracking-[0.1em] text-muted uppercase">
                  You wrote “{issue.input}” · {ENTITY_LABEL[issue.type]}
                </span>
              </span>
            </legend>
            {issue.kind === 'not_found' ? (
              <p className="text-muted">Qloo had no match for this name. Dropping it keeps the other anchors.</p>
            ) : null}
            <div className="grid gap-2 sm:grid-cols-2">
              {issue.candidates.map((c, k) => (
                <label
                  key={c.id}
                  className={cx(
                    'group relative flex cursor-pointer gap-3 border-2 bg-surface p-4 transition-colors duration-[120ms] ease-sign',
                    'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus)]',
                    value === c.id ? 'border-amber' : 'border-surface-2 hover:border-border',
                  )}
                >
                  <input
                    type="radio"
                    name={name}
                    value={c.id}
                    checked={value === c.id}
                    onChange={() => setPicked((p) => ({ ...p, [issue.input]: c.id }))}
                    className="peer sr-only"
                  />
                  <span
                    aria-hidden="true"
                    className="mt-1 grid size-5 shrink-0 place-items-center border-2 border-border peer-checked:border-amber peer-checked:bg-amber"
                  >
                    <span className="hidden size-2 bg-[#0e0f11] group-has-[:checked]:block" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-display text-xl leading-tight font-bold uppercase">{c.name}</span>
                      {k === 0 ? (
                        <span className="border-2 border-amber px-1.5 font-display text-xs leading-4 font-bold tracking-[0.08em] text-amber-text uppercase">
                          Best match
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-1 flex items-center gap-1.5 text-sm text-muted">
                      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
                      {c.disambiguation ?? ENTITY_LABEL[c.type]}
                    </span>
                  </span>
                </label>
              ))}
              <label
                className={cx(
                  'group relative flex cursor-pointer items-center gap-3 border-2 border-dashed p-4 transition-colors duration-[120ms] ease-sign',
                  'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus)]',
                  value === DROP ? 'border-amber' : 'border-surface-2 hover:border-border',
                )}
              >
                <input
                  type="radio"
                  name={name}
                  value={DROP}
                  checked={value === DROP}
                  onChange={() => setPicked((p) => ({ ...p, [issue.input]: DROP }))}
                  className="peer sr-only"
                />
                <span
                  aria-hidden="true"
                  className="grid size-5 shrink-0 place-items-center border-2 border-border peer-checked:border-amber peer-checked:bg-amber"
                >
                  <span className="hidden size-2 bg-[#0e0f11] group-has-[:checked]:block" />
                </span>
                <Ban aria-hidden="true" className="size-4 shrink-0 text-muted" />
                <span className="font-semibold">None of these: drop it</span>
              </label>
            </div>
          </fieldset>
        );
      })}

      <div className="flex flex-wrap items-center gap-4 border-t-2 border-surface-2 pt-6">
        <button type="submit" disabled={!onSubmit || submitting} className={buttonClass('primary', 'lg')}>
          {submitting ? 'Continuing…' : 'Use these and continue'}
          <ArrowRight aria-hidden="true" className="size-5" />
        </button>
        <p className="text-sm text-muted">
          {onSubmit ? 'No other questions this run.' : 'Sample only: answers are not sent anywhere.'}
        </p>
      </div>
    </form>
  );
}
