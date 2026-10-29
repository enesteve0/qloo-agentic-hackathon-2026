import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';

const bold = await readFile(join(process.cwd(), 'src/assets/fonts/BarlowCondensed-Bold.ttf'));

/**
 * Stoop's mark for the browser and home-screen icons: an "S" on the green street-sign plate, drawn like
 * the wordmark (white border inside a green rim). Sizes scale from the 32-pixel tab icon; `rounded` gives
 * the tab icon soft corners, while the home-screen icon stays square for the platform's own mask.
 */
export function plateMark(px: number, { rounded = false } = {}) {
  const u = px / 32;
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          padding: 2 * u,
          backgroundColor: '#00804f',
          borderRadius: rounded ? 6 * u : 0,
        }}
      >
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: `${2 * u}px solid #ffffff`,
            borderRadius: 4 * u,
            color: '#ffffff',
            fontFamily: 'Barlow Condensed',
            fontSize: 26 * u,
            fontWeight: 700,
            lineHeight: 1,
          }}
        >
          S
        </div>
      </div>
    ),
    { width: px, height: px, fonts: [{ name: 'Barlow Condensed', data: bold, weight: 700, style: 'normal' }] },
  );
}
