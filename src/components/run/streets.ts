/**
 * Street-name formatting for sign plates: NYC signs abbreviate the designation (AV, ST, PL, BLVD…).
 * Pure and client-safe.
 */
import type { ScreenPlace } from './types';

const DESIGNATIONS: [RegExp, string][] = [
  [/\bAVENUE\b/g, 'AV'],
  [/\bSTREET\b/g, 'ST'],
  [/\bBOULEVARD\b/g, 'BLVD'],
  [/\bPLACE\b/g, 'PL'],
  [/\bPARKWAY\b/g, 'PKWY'],
  [/\bROAD\b/g, 'RD'],
  [/\bDRIVE\b/g, 'DR'],
  [/\bEXTENSION\b/g, 'EXT'],
  [/\bTERRACE\b/g, 'TER'],
  [/\bHIGHWAY\b/g, 'HWY'],
  [/\bEXPRESSWAY\b/g, 'EXPY'],
  [/\bSQUARE\b/g, 'SQ'],
  [/\bLANE\b/g, 'LN'],
  [/\bCOURT\b/g, 'CT'],
];
const DIRECTIONS: [RegExp, string][] = [
  [/^WEST\s+(?=\d)/, 'W '],
  [/^EAST\s+(?=\d)/, 'E '],
  [/^NORTH\s+(?=\d)/, 'N '],
  [/^SOUTH\s+(?=\d)/, 'S '],
];

const SUFFIXES = new Set(['AV', 'ST', 'BLVD', 'PL', 'PKWY', 'RD', 'DR', 'TER', 'HWY', 'EXPY', 'SQ', 'LN', 'CT']);

/** "WEST 125 STREET" → "W 125 ST"; "ST. NICHOLAS AVENUE" → "ST NICHOLAS AV"; "53rd Street" → "53RD ST". */
export function abbreviateStreet(name: string): string {
  let s = name.toUpperCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
  for (const [re, short] of DIRECTIONS) s = s.replace(re, short);
  for (const [re, short] of DESIGNATIONS) s = s.replace(re, short);
  return s;
}

/** "505 NOSTRAND AVENUE" → "NOSTRAND AVENUE"; "52-19 QUEENS BOULEVARD" → "QUEENS BOULEVARD". */
export function streetOfAddress(address: string): string {
  return address.replace(/^\s*[\d-]+[A-Z]?\s+/i, '').trim() || address;
}

/** Splits a trailing designation so plates can set it smaller, NYC style: "NOSTRAND AV" → ["NOSTRAND", "AV"]. */
export function splitDesignation(name: string): [main: string, suffix: string | null] {
  const parts = name.split(' ');
  const last = parts[parts.length - 1] ?? '';
  if (parts.length > 1 && SUFFIXES.has(last)) return [parts.slice(0, -1).join(' '), last];
  return [name, null];
}

/** The two plates for a screen: the street it stands on and the nearest cross street. */
export function platesFor(place: Pick<ScreenPlace, 'address' | 'cross1' | 'cross2'>): { street: string; cross: string | null } {
  const street = abbreviateStreet(streetOfAddress(place.address));
  const cross = [place.cross1, place.cross2]
    .filter((c): c is string => Boolean(c && c.trim()))
    .map(abbreviateStreet)
    .find((c) => c !== street);
  return { street, cross: cross ?? null };
}

/** "505 NOSTRAND AVENUE" → "505 Nostrand Av" for tables and lists. */
export function titleStreet(text: string): string {
  return abbreviateStreet(text)
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\b(\d+)(St|Nd|Rd|Th)\b/g, (_, d: string, s: string) => `${d}${s.toLowerCase()}`)
    .replace(/\bJr\b/g, 'Jr');
}
