import 'server-only';

/** Rounds to `digits` decimals to keep run-state JSON compact; −0 becomes 0, non-finite passes through. */
export function round(x: number, digits: number): number {
  if (!Number.isFinite(x)) return x;
  const f = 10 ** digits;
  const r = Math.round(x * f) / f;
  return r === 0 ? 0 : r;
}

/** 1234 → "1,234" without depending on the runtime's locale data (narration must be deterministic). */
export function formatInt(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** "1 neighborhood" / "3 neighborhoods". */
export function plural(n: number, word: string): string {
  return `${formatInt(n)} ${word}${n === 1 ? '' : 's'}`;
}
