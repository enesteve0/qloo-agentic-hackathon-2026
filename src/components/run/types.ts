import type { Kiosk } from '@/shared/types';

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

/**
 * The client-safe slice of one street screen, picked on the server from kiosks.json
 * (see `placesForRun` in ./places.ts). The full kiosk file never ships to the browser.
 */
export type ScreenPlace = Pick<Kiosk, 'i' | 'siteId' | 'address' | 'cross1' | 'cross2' | 'nta' | 'boro' | 'type'>;

/** Kiosk index (Kiosk.i) → place. */
export type PlaceLookup = Record<number, ScreenPlace>;

/** The booking package for SEND, drafted on the server from the plan. */
export interface SendDraft {
  subject: string;
  body: string;
  /** `mailto:` URL (recipient and optional params); subject and body are re-encoded from the edited text. */
  mailto: string;
  /** Link to the screen list CSV, or null when exports are unavailable. */
  csvHref: string | null;
}

export type DrawerTab = 'log' | 'requests';
