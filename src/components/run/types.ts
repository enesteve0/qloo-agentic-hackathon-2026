/** Canvas views addressable with `?view=`. */
export const RUN_TABS = ['where', 'what', 'plan', 'proof', 'send'] as const;
export type RunTab = (typeof RUN_TABS)[number];

export function isRunTab(x: unknown): x is RunTab {
  return typeof x === 'string' && (RUN_TABS as readonly string[]).includes(x);
}

/** The seven stations of PRODUCT §2. */
export const STATIONS = ['brief', 'taste', 'where', 'what', 'plan', 'proof', 'send'] as const;
export type StationId = (typeof STATIONS)[number];
export type StationStatus = 'pending' | 'active' | 'done' | 'needs_input' | 'degraded' | 'error';

// Street places and the booking draft travel in the run stream, so they live in the shared contract.
export type { PlaceLookup, ScreenPlace, SendDraft } from '@/shared/types';

export type DrawerTab = 'log' | 'requests';
