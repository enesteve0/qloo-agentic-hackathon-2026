import Link from 'next/link';

/** Hazard-striped note above any plan made from synthetic taste data. */
export function SyntheticNote({ children }: { children?: React.ReactNode }) {
  return (
    <div role="note" className="border-b-2 border-surface-2 bg-surface">
      <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 sm:px-6 lg:px-8">
        <span aria-hidden="true" className="hazard h-5 w-10 shrink-0" />
        <p className="min-w-0 flex-1 text-sm">
          <span className="font-display text-base font-bold tracking-[0.06em] uppercase">Synthetic sample data</span>
          <span className="text-muted"> — {children ?? 'the live agent uses real Qloo data.'} </span>
          <Link href="/how-it-works#labels" className="whitespace-nowrap underline underline-offset-4">
            What the labels mean
          </Link>
        </p>
      </div>
    </div>
  );
}
