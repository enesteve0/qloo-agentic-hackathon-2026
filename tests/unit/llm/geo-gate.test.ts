import { describe, expect, it } from 'vitest';
import { GEMINI_BLOCKED_COUNTRIES, isGeminiAllowed, normalizeCountry, parseCountryList } from '@/server/llm/geo-gate';

const DEFAULT_ALLOW = 'US,CA,TR,MX,BR,AU,NZ,JP,KR,IN,SG,ZA,AE';

describe('Gemini geo gate', () => {
  it('allows listed countries outside the EEA/CH/UK', () => {
    expect(isGeminiAllowed('US', DEFAULT_ALLOW)).toBe(true);
    expect(isGeminiAllowed('TR', DEFAULT_ALLOW)).toBe(true);
    expect(isGeminiAllowed(' us ', DEFAULT_ALLOW)).toBe(true);
  });

  it('blocks unknown, missing and placeholder countries', () => {
    for (const country of [null, undefined, '', 'XX', 'T1', 'A1', 'USA', '1']) {
      expect(isGeminiAllowed(country, DEFAULT_ALLOW)).toBe(false);
    }
  });

  it('blocks GB, DE, CH and other blocked regions even when the allow-list names them', () => {
    const allowAll = 'US,GB,UK,DE,CH,NO,IS,LI,FR,RE,GF,JE,IM,GI,AX';
    for (const country of ['GB', 'UK', 'DE', 'CH', 'NO', 'IS', 'LI', 'FR', 'RE', 'GF', 'JE', 'IM', 'GI', 'AX']) {
      expect(isGeminiAllowed(country, allowAll)).toBe(false);
    }
    expect(isGeminiAllowed('US', allowAll)).toBe(true);
  });

  it('blocks countries missing from the allow-list', () => {
    expect(isGeminiAllowed('CN', DEFAULT_ALLOW)).toBe(false);
    expect(isGeminiAllowed('US', '')).toBe(false);
  });

  it('covers all 27 EU members plus EFTA, the UK and the listed territories', () => {
    expect(GEMINI_BLOCKED_COUNTRIES.size).toBeGreaterThanOrEqual(27 + 5 + 11);
    for (const code of ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE']) {
      expect(GEMINI_BLOCKED_COUNTRIES.has(code)).toBe(true);
    }
    for (const code of ['GF', 'RE', 'GP', 'MQ', 'YT', 'MF', 'AX', 'GI', 'GG', 'JE', 'IM']) {
      expect(GEMINI_BLOCKED_COUNTRIES.has(code)).toBe(true);
    }
  });

  it('parses allow-lists and normalizes codes', () => {
    expect([...parseCountryList(' us, tr;ca  xx ')]).toEqual(['US', 'TR', 'CA']);
    expect(normalizeCountry('gb')).toBe('GB');
    expect(normalizeCountry('ZZ')).toBeNull();
  });
});
