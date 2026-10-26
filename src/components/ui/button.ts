import { cx } from './cx';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'sign';
export type ButtonSize = 'sm' | 'md' | 'lg';

const BASE =
  'inline-flex shrink-0 items-center justify-center gap-2 border-2 font-display font-bold uppercase tracking-[0.04em] whitespace-nowrap transition-colors duration-[120ms] ease-sign select-none disabled:cursor-not-allowed disabled:opacity-45 aria-disabled:cursor-not-allowed aria-disabled:opacity-45';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'border-amber bg-amber text-[#0e0f11] hover:border-text hover:bg-text',
  secondary: 'border-text bg-transparent text-text hover:bg-surface-2',
  ghost: 'border-transparent bg-transparent text-text hover:border-surface-2 hover:bg-surface',
  sign: 'border-sign bg-sign text-sign-text hover:border-text',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-base',
  lg: 'h-12 px-5 text-lg',
};

/** Class list for buttons and button-styled links: hard edges, 2px rules, sign lettering. */
export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', extra?: string): string {
  return cx(BASE, VARIANTS[variant], SIZES[size], extra);
}
