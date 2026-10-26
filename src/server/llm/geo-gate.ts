import 'server-only';

// The Gemini API free tier may not serve end users in the EEA, Switzerland or the UK, so the Gemini
// slot is used only for countries we positively know are outside them. Unknown is always blocked.
const EEA_27 = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE',
  'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
];
const EFTA_UK_CH = ['IS', 'LI', 'NO', 'CH', 'GB'];
// EU outermost regions and dependencies that geo-IP databases report under their own codes.
const TERRITORIES = ['GF', 'RE', 'GP', 'MQ', 'YT', 'MF', 'AX', 'GI', 'GG', 'JE', 'IM'];
// Non-ISO aliases some sources use for the UK, Greece and the EU itself.
const ALIASES = ['UK', 'EL', 'EU'];
// Placeholder codes for "unknown", Tor, anonymous proxies and satellite providers.
const UNKNOWN = new Set(['XX', 'ZZ', 'T1', 'A1', 'A2', 'O1']);

export const GEMINI_BLOCKED_COUNTRIES: ReadonlySet<string> = new Set([...EEA_27, ...EFTA_UK_CH, ...TERRITORIES, ...ALIASES]);

/** Upper-cased ISO 3166-1 alpha-2 code, or null when the value is missing or a placeholder. */
export function normalizeCountry(value: string | null | undefined): string | null {
  if (!value) return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) && !UNKNOWN.has(code) ? code : null;
}

/** Parses a comma/space separated allow-list such as `GEMINI_ALLOWED_COUNTRIES`. */
export function parseCountryList(list: string | readonly string[]): Set<string> {
  const items = typeof list === 'string' ? list.split(/[\s,;]+/) : list;
  const out = new Set<string>();
  for (const item of items) {
    const code = normalizeCountry(item);
    if (code) out.add(code);
  }
  return out;
}

/**
 * True only when the request country is known, outside the EEA/CH/UK block list (even if someone
 * lists it) and present in the configured allow-list.
 */
export function isGeminiAllowed(country: string | null | undefined, allowList: string | readonly string[]): boolean {
  const code = normalizeCountry(country);
  if (!code || GEMINI_BLOCKED_COUNTRIES.has(code)) return false;
  return parseCountryList(allowList).has(code);
}
