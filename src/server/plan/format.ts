import 'server-only';

/** "$2,000", "$37.50": whole dollars without cents, otherwise two decimals. Locale-independent. */
export function formatUsd(amount: number): string {
  const cents = Math.round(amount * 100);
  const abs = Math.abs(cents);
  const dollars = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const rest = abs % 100;
  return `${cents < 0 ? '-' : ''}$${dollars}${rest ? `.${String(rest).padStart(2, '0')}` : ''}`;
}

/** "1 week", "3 weeks", "1.5 weeks". */
export function formatWeeks(weeks: number): string {
  const n = Math.round(weeks * 100) / 100;
  return `${n} week${n === 1 ? '' : 's'}`;
}
